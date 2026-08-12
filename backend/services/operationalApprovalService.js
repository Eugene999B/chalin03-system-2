const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");

const OPERATIONAL_KINDS = new Set([
  "return_refund",
  "sale_edit",
  "sale_void",
]);
const DEFAULT_EXPIRY_HOURS = 72;

function cleanText(value, maxLength = 5000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function money(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Number(number.toFixed(2));
}

function getBranchId(req) {
  return positiveInteger(
    req.user?.branch_id || req.user?.default_branch_id || req.user?.selected_branch?.id
  );
}

function getUserId(req) {
  return positiveInteger(req.user?.id || req.user?.user_id || req.userId);
}

function getRole(req) {
  return cleanText(req.user?.role, 40).toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = stableValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function randomCode(prefix = "APR") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
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

function actionRoute(request) {
  const entityId = positiveInteger(request.entity_id);
  if (request.approval_kind === "return_refund") {
    return { method: "POST", path: "/api/returns" };
  }
  if (request.approval_kind === "sale_edit" && entityId) {
    return { method: "PUT", path: `/api/sales/${entityId}` };
  }
  if (request.approval_kind === "sale_void" && entityId) {
    return { method: "PATCH", path: `/api/sales/${entityId}/void` };
  }
  return null;
}

async function ensureOperationalColumns(connection = pool) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS ready
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'audit_unlock_requests'
       AND COLUMN_NAME IN (
         'approval_kind', 'approval_payload_json', 'approval_payload_hash',
         'execution_status', 'execution_token_hash', 'expires_at'
       )`
  );

  if (Number(rows?.[0]?.ready || 0) !== 6) {
    const error = new Error(
      "The Operational Approval Centre database migration is not ready."
    );
    error.statusCode = 503;
    error.code = "OPERATIONAL_APPROVAL_SCHEMA_NOT_READY";
    throw error;
  }
}

async function createNotification(connection, request) {
  try {
    const notificationKey = `approval.${request.id}.${request.approval_kind}`;
    const [result] = await connection.query(
      `INSERT INTO notifications (
         notification_key, workspace_code, branch_id,
         target_role, category, notification_type, severity,
         title, message, action_path, source_type, source_reference,
         status, auto_generated, occurred_at, metadata_json, created_by
       ) VALUES (?, 'spare_parts', ?, 'admin', 'approval', 'approval_request',
         'high', ?, ?, '/audit-unlock-requests', 'approval_request', ?,
         'active', TRUE, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         message = VALUES(message),
         status = 'active',
         occurred_at = NOW(),
         metadata_json = VALUES(metadata_json),
         updated_at = NOW()`,
      [
        notificationKey,
        request.branch_id,
        `Approval request ${request.request_code}`,
        request.notification_message,
        request.request_code,
        JSON.stringify({
          approval_request_id: request.id,
          approval_kind: request.approval_kind,
          amount: request.approval_amount,
        }),
        request.requested_by,
      ]
    );

    const notificationId = result.insertId || null;
    if (notificationId) {
      await connection.query(
        `UPDATE audit_unlock_requests
         SET notification_id = ?
         WHERE id = ?`,
        [notificationId, request.id]
      );
    }
    return notificationId;
  } catch (error) {
    console.warn("Operational approval notification skipped:", error.message);
    return null;
  }
}

async function auditApprovalEvent({
  req,
  connection,
  action,
  request,
  outcome = "success",
  details,
  severity = "high",
  userId,
}) {
  try {
    await writeAuditEvent({
      req,
      connection,
      userId: userId || getUserId(req),
      branchId: request?.branch_id || getBranchId(req),
      action,
      details:
        details ||
        `${action}: ${request?.request_code || request?.id || "approval request"}`,
      workspaceCode: "spare_parts",
      entityType: "operational_approval_request",
      entityId: request?.id || null,
      actionType: action,
      outcome,
      severity,
      metadata: {
        request_code: request?.request_code || null,
        approval_kind: request?.approval_kind || null,
        entity_type: request?.entity_type || null,
        entity_id: request?.entity_id || null,
        execution_status: request?.execution_status || null,
      },
    });
  } catch (error) {
    console.warn("Operational approval audit event skipped:", error.message);
  }
}

function normalizeReturnReservation(row) {
  const payload = parseJson(row?.approval_payload_json, {});
  return {
    id: positiveInteger(row?.id),
    request_code: requestCodeFromRow(row),
    status: cleanText(row?.status, 30).toLowerCase(),
    execution_status: cleanText(row?.execution_status, 30).toLowerCase(),
    product_id: positiveInteger(payload?.product_id),
    quantity: positiveInteger(payload?.quantity),
    sale_id: positiveInteger(payload?.sale_id || row?.entity_id),
    refund_amount: money(payload?.refund_amount),
  };
}

async function listActiveReturnReservations(
  connection = pool,
  { branchId, saleId, excludeRequestId = null, forUpdate = false } = {}
) {
  const cleanBranchId = positiveInteger(branchId);
  const cleanSaleId = positiveInteger(saleId);
  if (!cleanBranchId || !cleanSaleId) return [];

  const params = [cleanBranchId, cleanSaleId];
  let excludeSql = "";
  const cleanExcludeId = positiveInteger(excludeRequestId);
  if (cleanExcludeId) {
    excludeSql = " AND id <> ?";
    params.push(cleanExcludeId);
  }

  const [rows] = await connection.query(
    `SELECT id, requested_action, status, execution_status, expires_at,
            entity_id, approval_payload_json
     FROM audit_unlock_requests
     WHERE branch_id = ?
       AND approval_kind = 'return_refund'
       AND entity_type = 'sale'
       AND entity_id = ?
       AND status IN ('pending', 'approved')
       AND execution_status IN ('pending', 'executing', 'failed')
       AND (
         execution_status = 'executing'
         OR expires_at IS NULL
         OR expires_at > NOW()
       )${excludeSql}
     ORDER BY id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    params
  );

  return rows
    .map(normalizeReturnReservation)
    .filter((reservation) => reservation.id && reservation.product_id && reservation.quantity);
}

async function createOperationalRequest({
  req,
  connection = pool,
  branchId,
  approvalKind,
  entityType,
  entityId,
  requestArea,
  periodLabel,
  requestedAction,
  reason,
  amount = 0,
  payload,
  notificationMessage,
}) {
  await ensureOperationalColumns(connection);

  if (!OPERATIONAL_KINDS.has(approvalKind)) {
    throw new Error("Unsupported operational approval type.");
  }

  const requestedBy = getUserId(req);
  if (!requestedBy) throw new Error("The requesting user could not be identified.");

  const payloadJson = stableStringify(payload);
  const payloadHash = hashPayload(payload);

  const [existingRows] = await connection.query(
    `SELECT *
     FROM audit_unlock_requests
     WHERE branch_id = ?
       AND requested_by = ?
       AND approval_kind = ?
       AND approval_payload_hash = ?
       AND status = 'pending'
       AND execution_status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY id DESC
     LIMIT 1`,
    [branchId, requestedBy, approvalKind, payloadHash]
  );

  if (existingRows.length > 0) {
    return { request: normalizeRequestRow(existingRows[0]), duplicate: true };
  }

  const requestCode = randomCode("APR");
  const [result] = await connection.query(
    `INSERT INTO audit_unlock_requests (
       branch_id, audit_signoff_id, period_label, period_start, period_end,
       request_area, requested_action, reason, status, requested_by,
       approval_kind, entity_type, entity_id, approval_amount,
       approval_payload_json, approval_payload_hash, expires_at,
       execution_status
     ) VALUES (?, NULL, ?, NULL, NULL, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?,
       DATE_ADD(NOW(), INTERVAL ? HOUR), 'pending')`,
    [
      branchId,
      cleanText(periodLabel, 255) || "Operational approval request",
      requestArea,
      cleanText(requestedAction, 1000),
      cleanText(reason, 12000),
      requestedBy,
      approvalKind,
      entityType,
      entityId || null,
      money(amount),
      payloadJson,
      payloadHash,
      DEFAULT_EXPIRY_HOURS,
    ]
  );

  const request = {
    id: result.insertId,
    request_code: requestCode,
    branch_id: branchId,
    requested_by: requestedBy,
    approval_kind: approvalKind,
    entity_type: entityType,
    entity_id: entityId || null,
    approval_amount: money(amount),
    approval_payload_hash: payloadHash,
    execution_status: "pending",
    status: "pending",
    notification_message:
      cleanText(notificationMessage, 1200) || cleanText(requestedAction, 1200),
  };

  // request_code is stored in requested_action prefix for legacy-table compatibility.
  await connection.query(
    `UPDATE audit_unlock_requests
     SET requested_action = CONCAT('[', ?, '] ', requested_action)
     WHERE id = ?`,
    [requestCode, request.id]
  );

  await createNotification(connection, request);
  await auditApprovalEvent({
    req,
    connection,
    action: "CREATE_OPERATIONAL_APPROVAL_REQUEST",
    request,
    details: `${requestCode}: ${approvalKind} requested by user ${requestedBy}.`,
  });

  return { request, duplicate: false };
}

function requestCodeFromRow(row) {
  const match = /^\[([^\]]+)\]/.exec(String(row?.requested_action || ""));
  return match?.[1] || `APR-${row?.id || "UNKNOWN"}`;
}

function normalizeRequestRow(row) {
  const payload = parseJson(row.approval_payload_json, {});
  return {
    ...row,
    request_code: requestCodeFromRow(row),
    approval_payload: payload,
    approval_amount: money(row.approval_amount),
  };
}

async function userCanAccessBranch(connection, user, branchId) {
  if (!user || !branchId) return false;
  if (Number(user.can_access_all_branches || 0) === 1) return true;
  if (Number(user.default_branch_id || user.branch_id || 0) === Number(branchId)) {
    return true;
  }

  const [rows] = await connection.query(
    `SELECT 1
     FROM user_branch_access
     WHERE user_id = ? AND branch_id = ? AND can_access = 1
     LIMIT 1`,
    [user.id, branchId]
  );
  return rows.length > 0;
}

async function verifyAdminReviewer(connection, req, password, branchId) {
  const reviewerId = getUserId(req);
  if (!reviewerId || getRole(req) !== "admin") {
    const error = new Error("Only an active administrator can approve this request.");
    error.statusCode = 403;
    error.code = "ADMIN_APPROVAL_REQUIRED";
    throw error;
  }

  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, password_hash, is_active,
            default_branch_id, can_access_all_branches
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [reviewerId]
  );
  const reviewer = rows[0];

  if (!reviewer || Number(reviewer.is_active) !== 1 || reviewer.role !== "admin") {
    const error = new Error("The administrator account is inactive or unavailable.");
    error.statusCode = 403;
    throw error;
  }

  if (!(await userCanAccessBranch(connection, reviewer, branchId))) {
    const error = new Error("This administrator is not authorized for the request's store.");
    error.statusCode = 403;
    throw error;
  }

  if (!password || !(await bcrypt.compare(String(password), reviewer.password_hash))) {
    const error = new Error("Administrator password is incorrect.");
    error.statusCode = 401;
    error.code = "ADMIN_PASSWORD_INVALID";
    throw error;
  }

  return reviewer;
}

async function lockOperationalRequest(connection, id) {
  const [rows] = await connection.query(
    `SELECT aur.*,
            requester.full_name AS requested_by_name,
            requester.username AS requested_by_username,
            requester.role AS requested_by_role,
            requester.is_active AS requester_is_active,
            b.code AS branch_code,
            b.name AS branch_name,
            b.location AS branch_location
     FROM audit_unlock_requests aur
     LEFT JOIN users requester ON requester.id = aur.requested_by
     LEFT JOIN branches b ON b.id = aur.branch_id
     WHERE aur.id = ?
     LIMIT 1
     FOR UPDATE`,
    [id]
  );
  return rows[0] ? normalizeRequestRow(rows[0]) : null;
}

async function listOperationalRequests(req, { status = "", search = "" } = {}) {
  await ensureOperationalColumns(pool);
  const role = getRole(req);
  const userId = getUserId(req);
  const branchId = getBranchId(req);
  const canSeeAll = role === "admin" && Number(req.user?.can_access_all_branches || 0) === 1;

  const params = [];
  let where = "WHERE aur.approval_kind IS NOT NULL";

  if (!canSeeAll) {
    where += " AND aur.branch_id = ?";
    params.push(branchId);
  }
  if (role !== "admin") {
    where += " AND aur.requested_by = ?";
    params.push(userId);
  }
  if (status) {
    where += " AND aur.status = ?";
    params.push(status);
  }
  if (search) {
    const like = `%${search}%`;
    where += ` AND (
      aur.requested_action LIKE ? OR aur.reason LIKE ? OR aur.approval_kind LIKE ?
      OR requester.full_name LIKE ? OR requester.username LIKE ?
      OR b.code LIKE ? OR b.name LIKE ?
    )`;
    params.push(like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query(
    `SELECT aur.*,
            requester.full_name AS requested_by_name,
            requester.username AS requested_by_username,
            reviewer.full_name AS reviewed_by_name,
            reviewer.username AS reviewed_by_username,
            b.code AS branch_code,
            b.name AS branch_name,
            b.location AS branch_location
     FROM audit_unlock_requests aur
     LEFT JOIN users requester ON requester.id = aur.requested_by
     LEFT JOIN users reviewer ON reviewer.id = aur.reviewed_by
     LEFT JOIN branches b ON b.id = aur.branch_id
     ${where}
     ORDER BY
       CASE aur.execution_status
         WHEN 'pending' THEN 1
         WHEN 'failed' THEN 2
         WHEN 'executing' THEN 3
         WHEN 'executed' THEN 4
         ELSE 5
       END,
       aur.created_at DESC
     LIMIT 300`,
    params
  );

  return rows.map(normalizeRequestRow);
}

async function claimOperationalRequest({ req, requestId, password, reviewNote }) {
  const connection = await pool.getConnection();
  try {
    await ensureOperationalColumns(connection);
    await connection.beginTransaction();

    const request = await lockOperationalRequest(connection, requestId);
    if (!request || !OPERATIONAL_KINDS.has(request.approval_kind)) {
      const error = new Error("Operational approval request not found.");
      error.statusCode = 404;
      throw error;
    }

    const selfApproval =
      Number(request.requested_by) === Number(getUserId(req));
    const adminReturnSelfApproval =
      selfApproval &&
      getRole(req) === "admin" &&
      request.approval_kind === "return_refund";

    if (selfApproval && !adminReturnSelfApproval) {
      const error = new Error("The requester cannot approve their own action.");
      error.statusCode = 403;
      error.code = "SELF_APPROVAL_FORBIDDEN";
      throw error;
    }

    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      const error = new Error("This request has expired. The manager must submit it again.");
      error.statusCode = 409;
      throw error;
    }

    if (!["pending", "approved"].includes(request.status)) {
      const error = new Error("This request has already been reviewed.");
      error.statusCode = 409;
      throw error;
    }

    if (!["pending", "failed"].includes(request.execution_status)) {
      const error = new Error(
        request.execution_status === "executed"
          ? "This approved action has already been executed."
          : "This request is already being executed."
      );
      error.statusCode = 409;
      throw error;
    }

    const reviewer = await verifyAdminReviewer(
      connection,
      req,
      password,
      request.branch_id
    );

    const executionToken = crypto.randomBytes(32).toString("hex");
    const executionTokenHash = crypto
      .createHash("sha256")
      .update(executionToken)
      .digest("hex");

    await connection.query(
      `UPDATE audit_unlock_requests
       SET status = 'approved',
           reviewed_by = ?,
           reviewed_at = NOW(),
           review_notes = ?,
           execution_status = 'executing',
           execution_token_hash = ?,
           execution_error = NULL
       WHERE id = ?`,
      [reviewer.id, cleanText(reviewNote, 5000), executionTokenHash, request.id]
    );

    await auditApprovalEvent({
      req,
      connection,
      action: "APPROVE_OPERATIONAL_REQUEST",
      request: { ...request, execution_status: "executing" },
      details: `${request.request_code} approved by ${reviewer.username}${
        adminReturnSelfApproval ? " (administrator self-approved return/refund)" : ""
      }; protected action execution started.`,
      userId: reviewer.id,
    });

    await connection.commit();
    return { request, reviewer, executionToken };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function rejectOperationalRequest({ req, requestId, password, reviewNote }) {
  const connection = await pool.getConnection();
  try {
    await ensureOperationalColumns(connection);
    await connection.beginTransaction();
    const request = await lockOperationalRequest(connection, requestId);

    if (!request || !OPERATIONAL_KINDS.has(request.approval_kind)) {
      const error = new Error("Operational approval request not found.");
      error.statusCode = 404;
      throw error;
    }
    const selfReview =
      Number(request.requested_by) === Number(getUserId(req));
    const adminReturnSelfRejection =
      selfReview &&
      getRole(req) === "admin" &&
      request.approval_kind === "return_refund";

    if (selfReview && !adminReturnSelfRejection) {
      const error = new Error("The requester cannot review their own action.");
      error.statusCode = 403;
      throw error;
    }
    if (!["pending", "approved"].includes(request.status) || request.execution_status === "executed") {
      const error = new Error("This request can no longer be rejected.");
      error.statusCode = 409;
      throw error;
    }
    if (!cleanText(reviewNote, 5000)) {
      const error = new Error("A rejection reason is required.");
      error.statusCode = 400;
      throw error;
    }

    const reviewer = await verifyAdminReviewer(
      connection,
      req,
      password,
      request.branch_id
    );

    await connection.query(
      `UPDATE audit_unlock_requests
       SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(),
           review_notes = ?, execution_status = 'rejected',
           execution_token_hash = NULL, execution_error = NULL
       WHERE id = ?`,
      [reviewer.id, cleanText(reviewNote, 5000), request.id]
    );

    if (request.notification_id) {
      await connection.query(
        `UPDATE notifications
         SET status = 'resolved', resolved_at = NOW(), resolved_by = ?,
             resolution_note = ?
         WHERE id = ?`,
        [reviewer.id, `Rejected: ${cleanText(reviewNote, 500)}`, request.notification_id]
      ).catch(() => {});
    }

    await auditApprovalEvent({
      req,
      connection,
      action: "REJECT_OPERATIONAL_REQUEST",
      request: { ...request, execution_status: "rejected" },
      details: `${request.request_code} rejected by ${reviewer.username}${
        adminReturnSelfRejection ? " (administrator closed their own return/refund request)" : ""
      }: ${cleanText(reviewNote, 500)}`,
      userId: reviewer.id,
    });

    await connection.commit();
    return { request, reviewer };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function finishOperationalExecution({ requestId, success, result, errorMessage }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const request = await lockOperationalRequest(connection, requestId);
    if (!request) throw new Error("Operational request disappeared during execution.");

    // Return/refund execution may finalize itself inside the same transaction
    // that changes stock and money. If so, never downgrade that durable success
    // merely because the internal HTTP response was interrupted afterward.
    if (request.execution_status === "executed") {
      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()),
               resolved_by = COALESCE(resolved_by, ?),
               resolution_note = 'Approved action executed successfully.'
           WHERE id = ?`,
          [request.reviewed_by || null, request.notification_id]
        ).catch(() => {});
      }
      await connection.commit();
      return request;
    }

    if (request.execution_status !== "executing") {
      await connection.commit();
      return request;
    }

    const finalStatus = success ? "executed" : "failed";
    if (success) {
      await connection.query(
        `UPDATE audit_unlock_requests
         SET execution_status = 'executed', executed_at = NOW(),
             execution_result_json = ?, execution_error = NULL,
             execution_token_hash = NULL
         WHERE id = ? AND execution_status = 'executing'`,
        [JSON.stringify(result || {}), requestId]
      );

      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = NOW(), resolved_by = ?,
               resolution_note = 'Approved action executed successfully.'
           WHERE id = ?`,
          [request.reviewed_by || null, request.notification_id]
        ).catch(() => {});
      }
    } else {
      await connection.query(
        `UPDATE audit_unlock_requests
         SET execution_status = 'failed', execution_error = ?,
             execution_token_hash = NULL
         WHERE id = ? AND execution_status = 'executing'`,
        [cleanText(errorMessage, 12000), requestId]
      );
    }

    await writeAuditEvent({
      connection,
      userId: request.reviewed_by || request.requested_by || null,
      branchId: request.branch_id || null,
      action: success
        ? "EXECUTE_OPERATIONAL_APPROVAL_REQUEST"
        : "FAIL_OPERATIONAL_APPROVAL_EXECUTION",
      details: success
        ? `${request.request_code} protected action executed successfully.`
        : `${request.request_code} protected action execution failed: ${cleanText(errorMessage, 1000)}`,
      workspaceCode: "spare_parts",
      entityType: "operational_approval_request",
      entityId: request.id,
      actionType: success ? "execution_success" : "execution_failure",
      outcome: success ? "success" : "failure",
      severity: success ? "high" : "critical",
      metadata: {
        request_code: request.request_code,
        approval_kind: request.approval_kind,
        execution_status: finalStatus,
      },
    });

    await connection.commit();
    return normalizeRequestRow({
      ...request,
      execution_status: finalStatus,
      execution_error: success ? null : cleanText(errorMessage, 12000),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  OPERATIONAL_KINDS,
  actionRoute,
  auditApprovalEvent,
  claimOperationalRequest,
  cleanText,
  createOperationalRequest,
  ensureOperationalColumns,
  finishOperationalExecution,
  getBranchId,
  getRole,
  getUserId,
  hashPayload,
  listOperationalRequests,
  listActiveReturnReservations,
  lockOperationalRequest,
  money,
  normalizeRequestRow,
  parseJson,
  positiveInteger,
  rejectOperationalRequest,
  stableStringify,
  userCanAccessBranch,
};
