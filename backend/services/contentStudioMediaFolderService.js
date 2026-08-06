"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");

const MAX_FOLDER_DEPTH = 20;

function normalizeFolderKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

async function listMediaFolders() {
  try {
    const [rows] = await pool.query(
      `SELECT f.*, parent.folder_key AS parent_key,
              (SELECT COUNT(*) FROM public_media_assets a
               WHERE a.folder_id = f.id AND a.is_active = 1) AS active_asset_count,
              (SELECT COUNT(*) FROM public_media_folders child
               WHERE child.parent_id = f.id AND child.is_active = 1) AS active_child_count
       FROM public_media_folders f
       LEFT JOIN public_media_folders parent ON parent.id = f.parent_id
       WHERE f.is_active = 1
       ORDER BY f.sort_order, f.name, f.id`
    );
    return rows.map((row) => ({
      ...row,
      active_asset_count: Number(row.active_asset_count || 0),
      active_child_count: Number(row.active_child_count || 0),
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function loadFolderForUpdate(connection, folderId) {
  const [rows] = await connection.query(
    `SELECT * FROM public_media_folders
     WHERE id = ? LIMIT 1 FOR UPDATE`,
    [folderId]
  );
  if (!rows[0] || !Number(rows[0].is_active)) {
    throw new ContentStudioError("Media folder not found.", {
      code: "PUBLIC_MEDIA_FOLDER_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function assertParent(connection, folderId, parentId) {
  if (!parentId) return;
  if (folderId && Number(folderId) === Number(parentId)) {
    throw new ContentStudioError("A media folder cannot be its own parent.", {
      code: "PUBLIC_MEDIA_FOLDER_SELF_PARENT",
      statusCode: 409,
    });
  }

  let current = Number(parentId);
  const visited = new Set();
  for (let depth = 0; depth < MAX_FOLDER_DEPTH && current; depth += 1) {
    if (folderId && current === Number(folderId)) {
      throw new ContentStudioError(
        "This parent selection would create a circular media folder hierarchy.",
        { code: "PUBLIC_MEDIA_FOLDER_CYCLE", statusCode: 409 }
      );
    }
    if (visited.has(current)) {
      throw new ContentStudioError(
        "The existing media folder hierarchy already contains a cycle.",
        { code: "PUBLIC_MEDIA_FOLDER_CYCLE", statusCode: 409 }
      );
    }
    visited.add(current);
    const [rows] = await connection.query(
      `SELECT parent_id, is_active
       FROM public_media_folders
       WHERE id = ? LIMIT 1`,
      [current]
    );
    if (!rows[0] || !Number(rows[0].is_active)) {
      throw new ContentStudioError("The selected parent folder is unavailable.", {
        code: "PUBLIC_MEDIA_FOLDER_PARENT_NOT_FOUND",
        statusCode: 409,
      });
    }
    current = positiveInteger(rows[0].parent_id);
  }
  if (current) {
    throw new ContentStudioError(
      `Media folders may not exceed ${MAX_FOLDER_DEPTH} levels.`,
      { code: "PUBLIC_MEDIA_FOLDER_DEPTH_EXCEEDED", statusCode: 409 }
    );
  }
}

async function createMediaFolder({ input = {}, user, req }) {
  const folderKey = normalizeFolderKey(input.folder_key ?? input.key);
  const name = cleanText(input.name, 150);
  const parentId = positiveInteger(input.parent_id);
  if (!folderKey || !name) {
    throw new ContentStudioError("Folder key and name are required.", {
      code: "INVALID_PUBLIC_MEDIA_FOLDER",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertParent(connection, null, parentId);
    const [result] = await connection.query(
      `INSERT INTO public_media_folders (
         parent_id, folder_key, name, description, sort_order,
         is_active, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        parentId,
        folderKey,
        name,
        cleanText(input.description, 500) || null,
        Number.isInteger(Number(input.sort_order)) ? Number(input.sort_order) : 0,
        user?.id || null,
        user?.id || null,
      ]
    );
    const folderId = Number(result.insertId);
    await insertContentAudit(connection, {
      entityType: "media_folder",
      entityId: folderId,
      actionKey: "media_folder_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { folder_key: folderKey, name, parent_id: parentId },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_MEDIA_FOLDER_CREATED",
      details: `CHALIN ONE media folder ${folderKey} created`,
      entityType: "public_media_folder",
      entityId: folderId,
      actionType: "PUBLIC_MEDIA_FOLDER_CREATED",
      metadata: { folder_key: folderKey },
    });
    await connection.commit();
    return listMediaFolders();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError("A media folder with this key already exists.", {
        code: "PUBLIC_MEDIA_FOLDER_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function updateMediaFolder({ folderId, input = {}, user, req }) {
  const id = positiveInteger(folderId);
  if (!id) {
    throw new ContentStudioError("Invalid media folder ID.", {
      code: "INVALID_PUBLIC_MEDIA_FOLDER_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const folder = await loadFolderForUpdate(connection, id);
    const parentId =
      input.parent_id === null || input.parent_id === ""
        ? null
        : positiveInteger(input.parent_id ?? folder.parent_id);
    await assertParent(connection, id, parentId);
    const folderKey = input.folder_key || input.key
      ? normalizeFolderKey(input.folder_key ?? input.key)
      : folder.folder_key;
    const name = cleanText(input.name, 150) || folder.name;
    if (!folderKey) {
      throw new ContentStudioError("Folder key is invalid.", {
        code: "INVALID_PUBLIC_MEDIA_FOLDER",
        statusCode: 400,
      });
    }

    await connection.query(
      `UPDATE public_media_folders
       SET parent_id = ?, folder_key = ?, name = ?, description = ?,
           sort_order = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        parentId,
        folderKey,
        name,
        input.description === undefined
          ? folder.description
          : cleanText(input.description, 500) || null,
        Number.isInteger(Number(input.sort_order))
          ? Number(input.sort_order)
          : folder.sort_order,
        user?.id || null,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: "media_folder",
      entityId: id,
      actionKey: "media_folder_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        parent_id: folder.parent_id,
        folder_key: folder.folder_key,
        name: folder.name,
      },
      after: { parent_id: parentId, folder_key: folderKey, name },
    });
    await connection.commit();
    return listMediaFolders();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError("A media folder with this key already exists.", {
        code: "PUBLIC_MEDIA_FOLDER_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveMediaFolder({ folderId, reason, user, req }) {
  const id = positiveInteger(folderId);
  if (!id) {
    throw new ContentStudioError("Invalid media folder ID.", {
      code: "INVALID_PUBLIC_MEDIA_FOLDER_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const folder = await loadFolderForUpdate(connection, id);
    const [[childCount], [assetCount]] = await Promise.all([
      connection.query(
        `SELECT COUNT(*) AS total FROM public_media_folders
         WHERE parent_id = ? AND is_active = 1`,
        [id]
      ),
      connection.query(
        `SELECT COUNT(*) AS total FROM public_media_assets
         WHERE folder_id = ? AND is_active = 1`,
        [id]
      ),
    ]);
    if (Number(childCount[0]?.total || 0) > 0) {
      throw new ContentStudioError(
        "Move or archive the child folders before archiving this folder.",
        { code: "PUBLIC_MEDIA_FOLDER_HAS_CHILDREN", statusCode: 409 }
      );
    }
    if (Number(assetCount[0]?.total || 0) > 0) {
      throw new ContentStudioError(
        "Move or archive all media assets before archiving this folder.",
        { code: "PUBLIC_MEDIA_FOLDER_NOT_EMPTY", statusCode: 409 }
      );
    }

    await connection.query(
      `UPDATE public_media_folders
       SET is_active = 0, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "media_folder",
      entityId: id,
      actionKey: "media_folder_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { is_active: true, folder_key: folder.folder_key },
      after: { is_active: false },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await connection.commit();
    return listMediaFolders();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  MAX_FOLDER_DEPTH,
  archiveMediaFolder,
  assertParent,
  createMediaFolder,
  listMediaFolders,
  normalizeFolderKey,
  updateMediaFolder,
};
