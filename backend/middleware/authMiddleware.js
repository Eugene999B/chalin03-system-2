const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { validateSession } = require("../services/accountSessionService");
const { resolveEffectivePermissions } = require("../services/permissionOverrideService");
const {
  validateUserCategoryAccess,
} = require("../services/categoryIsolationService");
const {
  CONTENT_STUDIO_WORKSPACE_CODE,
  contentStudioPathAllowedForSession,
  hydrateContentStudioSession,
} = require("../services/contentStudioAccessService");
const {
  requireSparePartsBranchContext,
} = require("./sparePartsBranchContextMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const tableColumnCache = new Map();

async function hasColumn(tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;

  if (tableColumnCache.has(cacheKey)) {
    return tableColumnCache.get(cacheKey);
  }

  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName]
    );
    const exists = rows.length > 0;
    tableColumnCache.set(cacheKey, exists);
    return exists;
  } catch {
    tableColumnCache.set(cacheKey, false);
    return false;
  }
}

async function loadUserSecurityState(userId) {
  const hasTokenVersion = await hasColumn("users", "token_version");
  const hasActive = await hasColumn("users", "is_active");
  const hasPrimaryWorkspace = await hasColumn("users", "primary_workspace_code");
  const hasCategoryStatus = await hasColumn("users", "category_assignment_status");
  const hasCategoryConflict = await hasColumn("users", "category_conflict_reason");

  const [rows] = await pool.query(
    `SELECT
       id,
       username,
       role,
       ${hasActive ? "is_active" : "TRUE AS is_active"},
       ${hasTokenVersion ? "token_version" : "0 AS token_version"},
       ${hasPrimaryWorkspace ? "primary_workspace_code" : "NULL AS primary_workspace_code"},
       ${hasCategoryStatus ? "category_assignment_status" : "'assigned' AS category_assignment_status"},
       ${hasCategoryConflict ? "category_conflict_reason" : "NULL AS category_conflict_reason"}
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
}

function requiresExportStoreContext(req, user) {
  return (
    String(user?.workspace_code || "").trim().toLowerCase() === "spare_parts" &&
    String(req.baseUrl || "") === "/api/exports"
  );
}

async function validateActiveServerSession(decoded) {
  return validateSession({
    userId: decoded.id,
    sessionId: decoded.session_id,
  });
}

function sendSessionFailure(res, req, sessionState) {
  return res.status(sessionState.statusCode || 401).json({
    status: "error",
    code: sessionState.code || "SESSION_REVOKED",
    message:
      sessionState.message ||
      "Your secure session is no longer active. Please login again.",
    request_id: req.requestId || null,
  });
}

function trustedMatchedRequestPath(req) {
  const baseUrl = String(req.baseUrl || "");
  const path = String(req.path || "");
  return `${baseUrl}${path}` || "/";
}

async function attachContentStudioUser({ req, res, next, decoded, state, currentTokenVersion }) {
  const trustedPath = trustedMatchedRequestPath(req);
  if (!contentStudioPathAllowedForSession(trustedPath)) {
    return res.status(403).json({
      status: "error",
      code: "CONTENT_STUDIO_SESSION_BOUNDARY",
      message:
        "This Content Studio session cannot access operational business APIs. Sign in through the appropriate Staff workspace for operational work.",
      request_id: req.requestId || null,
    });
  }

  const sessionState = await validateActiveServerSession(decoded);
  if (!sessionState.ok) return sendSessionFailure(res, req, sessionState);

  const currentIdentity = {
    ...decoded,
    ...state,
    id: state.id,
    username: state.username,
    role: state.role,
    workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
    token_version: currentTokenVersion,
    session_id: sessionState.session.session_id,
    is_original_system_administrator: isOriginalSystemAdministrator({
      ...decoded,
      ...state,
    }),
  };

  const hydrated = await hydrateContentStudioSession(currentIdentity);
  if (!hydrated.ok) {
    return res.status(403).json({
      status: "error",
      code: hydrated.code || "CONTENT_STUDIO_ACCESS_DENIED",
      message: hydrated.message || "Content Studio access is denied.",
      request_id: req.requestId || null,
    });
  }

  req.user = {
    ...hydrated.user,
    primary_workspace_code: state.primary_workspace_code || null,
    category_assignment_status: state.category_assignment_status || null,
    category_conflict_reason: state.category_conflict_reason || null,
    token_version: currentTokenVersion,
    session_id: sessionState.session.session_id,
  };

  return next();
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
        message: "Access denied. No token provided.",
        request_id: req.requestId || null,
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(503).json({
        status: "error",
        code: "JWT_SECRET_MISSING",
        message: "Authentication is not configured.",
        request_id: req.requestId || null,
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const state = await loadUserSecurityState(decoded.id);

    if (!state) {
      return res.status(401).json({
        status: "error",
        code: "TOKEN_REVOKED",
        message: "Invalid or expired token.",
        request_id: req.requestId || null,
      });
    }

    if (!Boolean(Number(state.is_active))) {
      return res.status(403).json({
        status: "error",
        code: "ACCOUNT_DISABLED",
        message: "This account has been disabled. Please contact the administrator.",
        request_id: req.requestId || null,
      });
    }

    const tokenVersion = Number(decoded.token_version || 0);
    const currentTokenVersion = Number(state.token_version || 0);

    if (tokenVersion !== currentTokenVersion) {
      return res.status(401).json({
        status: "error",
        code: "TOKEN_REVOKED",
        message: "Invalid or expired token.",
        request_id: req.requestId || null,
      });
    }

    if (
      String(decoded.workspace_code || "").trim().toLowerCase() ===
      CONTENT_STUDIO_WORKSPACE_CODE
    ) {
      return attachContentStudioUser({
        req,
        res,
        next,
        decoded,
        state,
        currentTokenVersion,
      });
    }

    const categoryAccess = await validateUserCategoryAccess({
      user: { ...decoded, ...state },
      workspaceCode: decoded.workspace_code,
    });

    if (!categoryAccess.ok) {
      return res.status(categoryAccess.statusCode || 403).json({
        status: "error",
        code: categoryAccess.code || "CATEGORY_ACCESS_DENIED",
        message: categoryAccess.message,
        request_id: req.requestId || null,
      });
    }

    const sessionState = await validateActiveServerSession(decoded);
    if (!sessionState.ok) return sendSessionFailure(res, req, sessionState);

    req.user = {
      ...decoded,
      // Security-sensitive identity and permission fields always come from
      // current server-side state after JWT verification, never from stale
      // token claims alone.
      id: state.id,
      username: state.username,
      role: state.role,
      workspace_code: categoryAccess.workspaceCode,
      workspace_role: categoryAccess.workspaceRole || state.role,
      primary_workspace_code: state.primary_workspace_code || null,
      category_assignment_status: state.category_assignment_status || null,
      category_conflict_reason: state.category_conflict_reason || null,
      is_original_system_administrator: isOriginalSystemAdministrator({ ...decoded, ...state }),
      token_version: currentTokenVersion,
      session_id: sessionState.session.session_id,
    };
    req.user.effective_permissions = await resolveEffectivePermissions(req.user);

    if (requiresExportStoreContext(req, req.user)) {
      return requireSparePartsBranchContext(req, res, next);
    }

    return next();
  } catch {
    return res.status(401).json({
      status: "error",
      code: "INVALID_TOKEN",
      message: "Invalid or expired token.",
      request_id: req.requestId || null,
    });
  }
}

module.exports = {
  attachContentStudioUser,
  loadUserSecurityState,
  requireAuth,
  requiresExportStoreContext,
  trustedMatchedRequestPath,
};
