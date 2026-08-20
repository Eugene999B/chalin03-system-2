const crypto = require("node:crypto");

const { pool } = require("../config/db");
const {
  actionRoute,
  hashPayload,
  normalizeRequestRow,
  positiveInteger,
} = require("../services/operationalApprovalService");

function cleanText(value) {
  return String(value ?? "").trim();
}

function requestUserId(req) {
  return positiveInteger(req.user?.id || req.user?.user_id || req.userId);
}

function timingSafeHexEqual(left, right) {
  const leftBuffer = Buffer.from(cleanText(left), "hex");
  const rightBuffer = Buffer.from(cleanText(right), "hex");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function routeMatches(req, request) {
  const route = actionRoute(request);
  if (!route || route.method !== req.method.toUpperCase()) return false;

  const requestPath = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/$/, "");
  const expectedPath = route.path.replace(/\/$/, "");
  return requestPath === expectedPath;
}

async function operationalApprovalExecutionMiddleware(req, res, next) {
  const executionToken = cleanText(req.get("x-chalin-approval-execution"));
  if (!executionToken) return next();

  const requestId = positiveInteger(req.get("x-chalin-approval-request-id"));
  if (!requestId) {
    return res.status(400).json({
      status: "error",
      code: "APPROVAL_REQUEST_ID_REQUIRED",
      message: "A valid protected approval request ID is required.",
    });
  }

  const originalAdmin = { ...(req.user || {}) };
  const originalAdminId = requestUserId(req);
  const suppliedAdminPassword = String(req.body?.__approval_admin_password || "");
  const suppliedAdminUsername = cleanText(req.body?.__approval_admin_username);

  try {
    const [rows] = await pool.query(
      `SELECT aur.*,
              requester.id AS requester_id,
              requester.full_name AS requester_full_name,
              requester.username AS requester_username,
              requester.is_active AS requester_is_active,
              b.code AS branch_code,
              b.name AS branch_name,
              b.location AS branch_location
       FROM audit_unlock_requests aur
       INNER JOIN users requester ON requester.id = aur.requested_by
       LEFT JOIN branches b ON b.id = aur.branch_id
       WHERE aur.id = ?
       LIMIT 1`,
      [requestId]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        code: "APPROVAL_REQUEST_NOT_FOUND",
        message: "Protected approval request was not found.",
      });
    }

    const request = normalizeRequestRow(rows[0]);
    const tokenHash = crypto.createHash("sha256").update(executionToken).digest("hex");

    if (
      request.execution_status !== "executing" ||
      Number(request.reviewed_by || 0) !== Number(originalAdminId || 0) ||
      !timingSafeHexEqual(tokenHash, request.execution_token_hash)
    ) {
      return res.status(403).json({
        status: "error",
        code: "APPROVAL_EXECUTION_TOKEN_INVALID",
        message: "This protected approval execution token is invalid or no longer active.",
      });
    }

    if (!routeMatches(req, request)) {
      return res.status(409).json({
        status: "error",
        code: "APPROVAL_EXECUTION_ROUTE_MISMATCH",
        message: "The approved request does not match this protected action endpoint.",
      });
    }

    if (Number(request.requester_is_active || 0) !== 1) {
      return res.status(409).json({
        status: "error",
        code: "APPROVAL_REQUESTER_INACTIVE",
        message: "The employee who requested this action is no longer active.",
      });
    }

    if (hashPayload(request.approval_payload) !== request.approval_payload_hash) {
      return res.status(409).json({
        status: "error",
        code: "APPROVAL_PAYLOAD_INTEGRITY_FAILED",
        message: "The approval request payload failed its integrity check.",
      });
    }

    if (!suppliedAdminUsername || !suppliedAdminPassword) {
      return res.status(400).json({
        status: "error",
        code: "APPROVER_CREDENTIAL_FORWARDING_FAILED",
        message: "The protected action could not receive the administrator approval credentials.",
      });
    }

    // The original financial routes already enforce independent second-person
    // approval. We execute them as the original requester, while forwarding the
    // reviewing administrator's credentials only in memory for this one call.
    req.user = {
      ...originalAdmin,
      id: request.requester_id,
      user_id: request.requester_id,
      full_name: request.requester_full_name,
      username: request.requester_username,
      role: "admin",
      branch_id: request.branch_id,
      default_branch_id: request.branch_id,
      branch_code: request.branch_code,
      branch_name: request.branch_name,
      branch_location: request.branch_location,
      selected_branch: {
        id: request.branch_id,
        branch_id: request.branch_id,
        code: request.branch_code,
        branch_code: request.branch_code,
        name: request.branch_name,
        branch_name: request.branch_name,
        location: request.branch_location,
        branch_location: request.branch_location,
      },
    };

    req.approvalExecution = {
      request_id: request.id,
      request_code: request.request_code,
      approval_kind: request.approval_kind,
      requested_by: request.requested_by,
      approved_by: originalAdminId,
    };

    req.body = {
      ...(request.approval_payload || {}),
      approver_username: suppliedAdminUsername,
      approver_password: suppliedAdminPassword,
    };

    return next();
  } catch (error) {
    console.error("Operational approval execution middleware error:", error);
    return res.status(500).json({
      status: "error",
      code: "APPROVAL_EXECUTION_PREPARATION_FAILED",
      message: "The approved action could not be prepared safely.",
    });
  }
}

module.exports = { operationalApprovalExecutionMiddleware };
