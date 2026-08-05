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
const {
  listNavigationItems,
  rowSnapshot,
} = require("./contentStudioNavigationService");

async function archiveNavigationItemSafely({ itemId, reason, user, req }) {
  const id = positiveInteger(itemId);
  if (!id) {
    throw new ContentStudioError("Invalid navigation item ID.", {
      code: "INVALID_NAVIGATION_ITEM_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [itemRows] = await connection.query(
      `SELECT *
       FROM public_navigation_items
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [id]
    );
    const item = itemRows[0];
    if (!item) {
      throw new ContentStudioError("Navigation item not found.", {
        code: "NAVIGATION_ITEM_NOT_FOUND",
        statusCode: 404,
      });
    }

    const [childRows] = await connection.query(
      `SELECT id, navigation_key, label, publication_status
       FROM public_navigation_items
       WHERE parent_id = ?
         AND publication_status <> 'archived'
       ORDER BY sort_order, id
       LIMIT 25
       FOR UPDATE`,
      [id]
    );

    if (childRows.length > 0) {
      throw new ContentStudioError(
        "Move or archive this menu item's children before archiving the parent.",
        {
          code: "NAVIGATION_ACTIVE_CHILDREN_BLOCK_ARCHIVE",
          statusCode: 409,
          details: childRows.map((child) => ({
            id: child.id,
            key: child.navigation_key,
            label: child.label,
            status: child.publication_status,
          })),
        }
      );
    }

    await connection.query(
      `UPDATE public_navigation_items
       SET publication_status = 'archived',
           expires_at = COALESCE(expires_at, UTC_TIMESTAMP()),
           updated_by = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await connection.query(
      `UPDATE public_content_versions
       SET version_status = CASE
             WHEN version_status = 'published' THEN 'archived'
             ELSE version_status
           END
       WHERE entity_type = 'navigation_item'
         AND entity_id = ?`,
      [id]
    );

    const cleanReason = cleanText(reason, 500) || null;
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: id,
      actionKey: "navigation_item_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        ...rowSnapshot(item),
        publication_status: item.publication_status,
      },
      after: { publication_status: "archived" },
      metadata: { reason: cleanReason },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_NAVIGATION_ITEM_ARCHIVED",
      details: `CHALIN ONE navigation item ${item.navigation_key} archived`,
      entityType: "public_navigation_item",
      entityId: id,
      actionType: "archive",
      metadata: { reason: cleanReason },
    });

    await connection.commit();
    return listNavigationItems();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  archiveNavigationItemSafely,
};
