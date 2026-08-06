"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  assertJsonSize,
  booleanValue,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");

const NAVIGATION_LOCATIONS = Object.freeze([
  "header",
  "footer",
  "mobile",
  "utility",
]);
const VERSION_STATUSES = Object.freeze([
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
  "archived",
]);
const MAX_NAVIGATION_ITEMS = 500;
const MAX_PARENT_DEPTH = 4;

function normalizeNavigationKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeNavigationLocation(value) {
  const location = cleanText(value, 30).toLowerCase();
  return NAVIGATION_LOCATIONS.includes(location) ? location : null;
}

function normalizeNavigationUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return null;

  if (/^\/(?!\/)[^\s]*$/.test(raw)) return raw;
  if (/^(mailto:|tel:)/i.test(raw)) return /\s/.test(raw) ? null : raw;

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeNavigationSnapshot(input = {}, fallback = {}) {
  const navigationKey = normalizeNavigationKey(
    input.navigation_key ?? input.key ?? fallback.navigation_key
  );
  const location = normalizeNavigationLocation(
    input.navigation_location ?? input.location ?? fallback.navigation_location
  );
  const label = cleanText(input.label ?? fallback.label, 180);
  const pageId = positiveInteger(input.page_id ?? fallback.page_id);
  const parentId = positiveInteger(input.parent_id ?? fallback.parent_id);
  const rawUrl = input.url !== undefined ? input.url : fallback.url;
  const url = normalizeNavigationUrl(rawUrl);

  if (!navigationKey || !location || !label) {
    throw new ContentStudioError(
      "Navigation key, location and label are required.",
      { code: "INVALID_NAVIGATION_ITEM", statusCode: 400 }
    );
  }
  if (rawUrl && !url) {
    throw new ContentStudioError(
      "Navigation URLs must be safe relative, HTTP, HTTPS, email or telephone links.",
      { code: "INVALID_NAVIGATION_URL", statusCode: 400 }
    );
  }
  if (!url && !pageId) {
    throw new ContentStudioError(
      "Choose a website page or enter a navigation URL.",
      { code: "NAVIGATION_TARGET_REQUIRED", statusCode: 400 }
    );
  }

  const rawSortOrder = input.sort_order ?? fallback.sort_order;
  return {
    navigation_key: navigationKey,
    parent_id: parentId,
    page_id: pageId,
    navigation_location: location,
    label,
    url,
    icon_key: cleanText(input.icon_key ?? fallback.icon_key, 100) || null,
    sort_order: Number.isInteger(Number(rawSortOrder)) ? Number(rawSortOrder) : 0,
    opens_new_tab: booleanValue(
      input.opens_new_tab,
      booleanValue(fallback.opens_new_tab, false)
    ),
  };
}

function rowSnapshot(row) {
  return sanitizeNavigationSnapshot({}, row);
}

async function assertReferencedRecords(connection, snapshot, itemId = null) {
  if (snapshot.page_id) {
    const [rows] = await connection.query(
      "SELECT id FROM public_pages WHERE id = ? LIMIT 1",
      [snapshot.page_id]
    );
    if (!rows[0]) {
      throw new ContentStudioError("The selected website page does not exist.", {
        code: "NAVIGATION_PAGE_NOT_FOUND",
        statusCode: 409,
      });
    }
  }

  if (snapshot.parent_id) {
    if (itemId && Number(snapshot.parent_id) === Number(itemId)) {
      throw new ContentStudioError("A navigation item cannot be its own parent.", {
        code: "NAVIGATION_SELF_PARENT_BLOCKED",
        statusCode: 409,
      });
    }
    const [rows] = await connection.query(
      "SELECT id FROM public_navigation_items WHERE id = ? LIMIT 1",
      [snapshot.parent_id]
    );
    if (!rows[0]) {
      throw new ContentStudioError("The selected parent menu item does not exist.", {
        code: "NAVIGATION_PARENT_NOT_FOUND",
        statusCode: 409,
      });
    }
  }
}

async function assertNoNavigationCycle(connection, itemId, parentId) {
  if (!itemId || !parentId) return true;

  let currentId = Number(parentId);
  const visited = new Set();
  for (let depth = 0; depth < MAX_PARENT_DEPTH && currentId; depth += 1) {
    if (currentId === Number(itemId)) {
      throw new ContentStudioError(
        "This parent selection would create a circular navigation menu.",
        { code: "NAVIGATION_CYCLE_BLOCKED", statusCode: 409 }
      );
    }
    if (visited.has(currentId)) {
      throw new ContentStudioError(
        "The existing navigation hierarchy already contains a cycle.",
        { code: "NAVIGATION_CYCLE_DETECTED", statusCode: 409 }
      );
    }
    visited.add(currentId);
    const [rows] = await connection.query(
      "SELECT parent_id FROM public_navigation_items WHERE id = ? LIMIT 1",
      [currentId]
    );
    currentId = positiveInteger(rows[0]?.parent_id);
  }

  if (currentId) {
    throw new ContentStudioError(
      `Navigation nesting may not exceed ${MAX_PARENT_DEPTH} levels.`,
      { code: "NAVIGATION_DEPTH_EXCEEDED", statusCode: 409 }
    );
  }
  return true;
}

async function loadItemForUpdate(connection, itemId) {
  const [rows] = await connection.query(
    "SELECT * FROM public_navigation_items WHERE id = ? LIMIT 1 FOR UPDATE",
    [itemId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Navigation item not found.", {
      code: "NAVIGATION_ITEM_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadLatestVersion(connection, itemId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_content_versions
     WHERE entity_type = 'navigation_item' AND entity_id = ?
     ORDER BY version_number DESC, id DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [itemId]
  );
  return rows[0] || null;
}

async function loadVersionForUpdate(connection, itemId, versionId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_content_versions
     WHERE id = ? AND entity_type = 'navigation_item' AND entity_id = ?
     LIMIT 1 FOR UPDATE`,
    [versionId, itemId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Navigation version not found.", {
      code: "NAVIGATION_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function insertVersion(
  connection,
  itemId,
  versionNumber,
  snapshot,
  summary,
  userId
) {
  const [result] = await connection.query(
    `INSERT INTO public_content_versions (
       entity_type, entity_id, version_number, version_status,
       snapshot_json, change_summary, created_by
     ) VALUES ('navigation_item', ?, ?, 'draft', ?, ?, ?)`,
    [
      itemId,
      versionNumber,
      assertJsonSize(snapshot, "Navigation snapshot"),
      cleanText(summary, 500) || `Navigation draft version ${versionNumber}`,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function platformAudit(connection, req, action, itemId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE navigation ${action}`,
    entityType: "public_navigation_item",
    entityId: itemId,
    actionType: action,
    metadata,
  });
}

async function listNavigationItems() {
  try {
    const [rows] = await pool.query(
      `SELECT n.*, parent.navigation_key AS parent_key, p.slug AS page_slug,
              latest.id AS latest_version_id,
              latest.version_number AS latest_version_number,
              latest.version_status AS latest_version_status,
              latest.snapshot_json AS latest_snapshot_json,
              latest.change_summary AS latest_change_summary
       FROM public_navigation_items n
       LEFT JOIN public_navigation_items parent ON parent.id = n.parent_id
       LEFT JOIN public_pages p ON p.id = n.page_id
       LEFT JOIN public_content_versions latest
         ON latest.id = (
           SELECT cv.id FROM public_content_versions cv
           WHERE cv.entity_type = 'navigation_item' AND cv.entity_id = n.id
           ORDER BY cv.version_number DESC, cv.id DESC LIMIT 1
         )
       ORDER BY n.navigation_location, n.sort_order, n.id
       LIMIT ${MAX_NAVIGATION_ITEMS}`
    );
    return rows.map((row) => ({
      ...row,
      opens_new_tab: booleanValue(row.opens_new_tab),
      latest_snapshot: parseJson(row.latest_snapshot_json, null),
      latest_snapshot_json: undefined,
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function createNavigationDraft({ input, user, req }) {
  const snapshot = sanitizeNavigationSnapshot(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertReferencedRecords(connection, snapshot);
    const [result] = await connection.query(
      `INSERT INTO public_navigation_items (
         navigation_key, parent_id, page_id, navigation_location, label, url,
         icon_key, sort_order, opens_new_tab, publication_status,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        snapshot.navigation_key,
        snapshot.parent_id,
        snapshot.page_id,
        snapshot.navigation_location,
        snapshot.label,
        snapshot.url,
        snapshot.icon_key,
        snapshot.sort_order,
        snapshot.opens_new_tab ? 1 : 0,
        user?.id || null,
        user?.id || null,
      ]
    );
    const itemId = Number(result.insertId);
    await assertNoNavigationCycle(connection, itemId, snapshot.parent_id);
    const versionId = await insertVersion(
      connection,
      itemId,
      1,
      snapshot,
      input.change_summary || "Initial navigation draft",
      user?.id
    );
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: itemId,
      actionKey: "navigation_item_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { ...snapshot, version_id: versionId, version_number: 1 },
    });
    await platformAudit(connection, req, "PUBLIC_NAVIGATION_ITEM_CREATED", itemId, {
      version_id: versionId,
      navigation_key: snapshot.navigation_key,
    });
    await connection.commit();
    return listNavigationItems();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError("A navigation item with this key already exists.", {
        code: "NAVIGATION_ITEM_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function createNavigationVersion({ itemId, input = {}, user, req }) {
  const id = positiveInteger(itemId);
  if (!id) throw new ContentStudioError("Invalid navigation item ID.", { code: "INVALID_NAVIGATION_ITEM_ID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await loadItemForUpdate(connection, id);
    const latest = await loadLatestVersion(connection, id, true);
    const base = latest ? parseJson(latest.snapshot_json, rowSnapshot(item)) : rowSnapshot(item);
    const snapshot = sanitizeNavigationSnapshot(input, base);
    await assertReferencedRecords(connection, snapshot, id);
    await assertNoNavigationCycle(connection, id, snapshot.parent_id);
    const nextVersion = Number(latest?.version_number || 0) + 1;
    const versionId = await insertVersion(connection, id, nextVersion, snapshot, input.change_summary, user?.id);
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: id,
      actionKey: "navigation_version_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: latest ? { version_id: latest.id, version_number: latest.version_number } : rowSnapshot(item),
      after: { ...snapshot, version_id: versionId, version_number: nextVersion },
    });
    await platformAudit(connection, req, "PUBLIC_NAVIGATION_VERSION_CREATED", id, {
      version_id: versionId,
      version_number: nextVersion,
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

async function updateNavigationDraft({ itemId, versionId, input = {}, user, req }) {
  const id = positiveInteger(itemId);
  const draftId = positiveInteger(versionId);
  if (!id || !draftId) throw new ContentStudioError("Invalid navigation item or version ID.", { code: "INVALID_NAVIGATION_VERSION_ID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadItemForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft navigation version may be edited.", { code: "NAVIGATION_VERSION_NOT_EDITABLE", statusCode: 409 });
    }
    const before = parseJson(version.snapshot_json, {});
    const snapshot = sanitizeNavigationSnapshot(input, before);
    await assertReferencedRecords(connection, snapshot, id);
    await assertNoNavigationCycle(connection, id, snapshot.parent_id);
    await connection.query(
      "UPDATE public_content_versions SET snapshot_json = ?, change_summary = ? WHERE id = ?",
      [assertJsonSize(snapshot, "Navigation snapshot"), cleanText(input.change_summary, 500) || version.change_summary, draftId]
    );
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: id,
      actionKey: "navigation_draft_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before,
      after: snapshot,
    });
    await platformAudit(connection, req, "PUBLIC_NAVIGATION_DRAFT_UPDATED", id, { version_id: draftId });
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

async function submitNavigationVersion({ itemId, versionId, assignedTo, note, user, req }) {
  const id = positiveInteger(itemId);
  const draftId = positiveInteger(versionId);
  if (!id || !draftId) throw new ContentStudioError("Invalid navigation item or version ID.", { code: "INVALID_NAVIGATION_VERSION_ID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await loadItemForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft navigation version may be submitted.", { code: "NAVIGATION_VERSION_NOT_DRAFT", statusCode: 409 });
    }
    const [pending] = await connection.query(
      `SELECT id FROM public_content_approvals
       WHERE entity_type = 'navigation_item' AND entity_id = ?
         AND content_version_id = ? AND approval_status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [id, draftId]
    );
    if (pending[0]) {
      throw new ContentStudioError("This navigation version already has a pending review request.", { code: "NAVIGATION_REVIEW_ALREADY_PENDING", statusCode: 409 });
    }
    const [result] = await connection.query(
      `INSERT INTO public_content_approvals (
         entity_type, entity_id, content_version_id, request_type,
         approval_status, requested_by, assigned_to, request_note
       ) VALUES ('navigation_item', ?, ?, 'review', 'pending', ?, ?, ?)`,
      [id, draftId, user?.id || null, positiveInteger(assignedTo), cleanText(note, 2000) || null]
    );
    const approvalId = Number(result.insertId);
    await connection.query("UPDATE public_content_versions SET version_status = 'in_review' WHERE id = ?", [draftId]);
    await connection.query(
      `UPDATE public_navigation_items
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE 'in_review'
           END,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: id,
      actionKey: "navigation_review_requested",
      actorUserId: user?.id,
      approvalId,
      requestId: req?.requestId,
      after: { version_id: draftId, version_number: version.version_number, approval_id: approvalId, assigned_to: positiveInteger(assignedTo), previous_status: item.publication_status },
    });
    await platformAudit(connection, req, "PUBLIC_NAVIGATION_REVIEW_REQUESTED", id, { version_id: draftId, approval_id: approvalId });
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

async function decideNavigationApproval({ approvalId, decision, note, user, req }) {
  const id = positiveInteger(approvalId);
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  if (!id || !["approved", "rejected"].includes(normalizedDecision)) {
    throw new ContentStudioError("Choose Approve or Reject for a valid request.", { code: "INVALID_APPROVAL_DECISION", statusCode: 400 });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM public_content_approvals WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
    const approval = rows[0];
    if (!approval || approval.entity_type !== "navigation_item") {
      throw new ContentStudioError("Navigation approval request not found.", { code: "CONTENT_APPROVAL_NOT_FOUND", statusCode: 404 });
    }
    if (approval.approval_status !== "pending") {
      throw new ContentStudioError("This approval request has already been decided.", { code: "CONTENT_APPROVAL_ALREADY_DECIDED", statusCode: 409 });
    }
    if (Number(approval.requested_by) === Number(user?.id)) {
      throw new ContentStudioError("The person who submitted a navigation change cannot approve it.", { code: "CONTENT_SELF_APPROVAL_BLOCKED", statusCode: 409 });
    }
    if (approval.assigned_to && Number(approval.assigned_to) !== Number(user?.id)) {
      throw new ContentStudioError("This approval request is assigned to another reviewer.", { code: "CONTENT_APPROVAL_ASSIGNED_ELSEWHERE", statusCode: 403 });
    }
    const versionId = positiveInteger(approval.content_version_id);
    if (!versionId) {
      throw new ContentStudioError("Approval version link is incomplete.", { code: "CONTENT_APPROVAL_STATE_MISMATCH", statusCode: 409 });
    }
    const item = await loadItemForUpdate(connection, approval.entity_id);
    const version = await loadVersionForUpdate(connection, approval.entity_id, versionId);
    if (version.version_status !== "in_review") {
      throw new ContentStudioError("The linked navigation version is no longer awaiting review.", { code: "CONTENT_APPROVAL_STATE_MISMATCH", statusCode: 409 });
    }
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = ?, decided_by = ?, decision_note = ?, decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [normalizedDecision, user?.id || null, cleanText(note, 2000) || null, id]
    );
    const nextVersionStatus = normalizedDecision === "approved" ? "approved" : "draft";
    await connection.query("UPDATE public_content_versions SET version_status = ? WHERE id = ?", [nextVersionStatus, versionId]);
    await connection.query(
      `UPDATE public_navigation_items
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE ?
           END,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [nextVersionStatus, user?.id || null, approval.entity_id]
    );
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: approval.entity_id,
      actionKey: normalizedDecision === "approved" ? "navigation_review_approved" : "navigation_review_rejected",
      actorUserId: user?.id,
      approvalId: id,
      requestId: req?.requestId,
      before: { version_status: version.version_status, publication_status: item.publication_status },
      after: { version_status: nextVersionStatus, approval_status: normalizedDecision, decision_note: cleanText(note, 2000) || null },
    });
    await platformAudit(connection, req, normalizedDecision === "approved" ? "PUBLIC_NAVIGATION_REVIEW_APPROVED" : "PUBLIC_NAVIGATION_REVIEW_REJECTED", approval.entity_id, { version_id: versionId, approval_id: id });
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

async function publishNavigationVersion({ itemId, versionId, user, req }) {
  const id = positiveInteger(itemId);
  const approvedVersionId = positiveInteger(versionId);
  if (!id || !approvedVersionId) throw new ContentStudioError("Invalid navigation item or version ID.", { code: "INVALID_NAVIGATION_VERSION_ID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const item = await loadItemForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, approvedVersionId);
    if (version.version_status !== "approved") {
      throw new ContentStudioError("Only an approved navigation version may be published.", { code: "NAVIGATION_VERSION_NOT_APPROVED", statusCode: 409 });
    }
    const [approvalRows] = await connection.query(
      `SELECT * FROM public_content_approvals
       WHERE entity_type = 'navigation_item' AND entity_id = ?
         AND content_version_id = ? AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC
       LIMIT 1 FOR UPDATE`,
      [id, approvedVersionId]
    );
    const approval = approvalRows[0];
    if (!approval) {
      throw new ContentStudioError("Publishing requires an approved human review record.", { code: "APPROVED_REVIEW_REQUIRED", statusCode: 409 });
    }
    const snapshot = sanitizeNavigationSnapshot(parseJson(version.snapshot_json, {}));
    await assertReferencedRecords(connection, snapshot, id);
    await assertNoNavigationCycle(connection, id, snapshot.parent_id);
    await connection.query(
      `UPDATE public_navigation_items
       SET navigation_key = ?, parent_id = ?, page_id = ?, navigation_location = ?,
           label = ?, url = ?, icon_key = ?, sort_order = ?, opens_new_tab = ?,
           publication_status = 'published', publish_at = UTC_TIMESTAMP(), expires_at = NULL,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [snapshot.navigation_key, snapshot.parent_id, snapshot.page_id, snapshot.navigation_location, snapshot.label, snapshot.url, snapshot.icon_key, snapshot.sort_order, snapshot.opens_new_tab ? 1 : 0, user?.id || null, id]
    );
    await connection.query(
      `UPDATE public_content_versions SET version_status = 'superseded'
       WHERE entity_type = 'navigation_item' AND entity_id = ? AND id <> ? AND version_status = 'published'`,
      [id, approvedVersionId]
    );
    await connection.query("UPDATE public_content_versions SET version_status = 'published' WHERE id = ?", [approvedVersionId]);
    await connection.query("UPDATE public_content_approvals SET executed_at = UTC_TIMESTAMP() WHERE id = ?", [approval.id]);
    await insertContentAudit(connection, {
      entityType: "navigation_item",
      entityId: id,
      actionKey: "navigation_item_published",
      actorUserId: user?.id,
      approvalId: approval.id,
      requestId: req?.requestId,
      before: rowSnapshot(item),
      after: snapshot,
    });
    await platformAudit(connection, req, "PUBLIC_NAVIGATION_ITEM_PUBLISHED", id, { version_id: approvedVersionId, approval_id: approval.id });
    await connection.commit();
    return listNavigationItems();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError("Another navigation item already uses this key.", { code: "NAVIGATION_ITEM_DUPLICATE", statusCode: 409 });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveNavigationItem(args) {
  const { archiveNavigationItemSafely } = require("./contentStudioNavigationArchiveService");
  return archiveNavigationItemSafely(args);
}

module.exports = {
  MAX_NAVIGATION_ITEMS,
  MAX_PARENT_DEPTH,
  NAVIGATION_LOCATIONS,
  VERSION_STATUSES,
  archiveNavigationItem,
  assertNoNavigationCycle,
  assertReferencedRecords,
  createNavigationDraft,
  createNavigationVersion,
  decideNavigationApproval,
  listNavigationItems,
  normalizeNavigationKey,
  normalizeNavigationLocation,
  normalizeNavigationUrl,
  parseJson,
  publishNavigationVersion,
  rowSnapshot,
  sanitizeNavigationSnapshot,
  submitNavigationVersion,
  updateNavigationDraft,
};
