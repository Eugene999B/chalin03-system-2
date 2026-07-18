const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { validateSession } = require("../services/accountSessionService");
const { resolveEffectivePermissions } = require("../services/permissionOverrideService");

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

  const [rows] = await pool.query(
    `SELECT
       id,
       ${hasActive ? "is_active" : "TRUE AS is_active"},
       ${hasTokenVersion ? "token_version" : "0 AS token_version"}
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
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

    const sessionState = await validateSession({
      userId: decoded.id,
      sessionId: decoded.session_id,
    });

    if (!sessionState.ok) {
      return res.status(sessionState.statusCode || 401).json({
        status: "error",
        code: sessionState.code || "SESSION_REVOKED",
        message:
          sessionState.message ||
          "Your secure session is no longer active. Please login again.",
        request_id: req.requestId || null,
      });
    }

    req.user = {
      ...decoded,
      token_version: currentTokenVersion,
      session_id: sessionState.session.session_id,
    };
    req.user.effective_permissions = await resolveEffectivePermissions(req.user);

    next();
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
  requireAuth,
};
