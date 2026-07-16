const crypto = require("crypto");

const { pool } = require("../config/db");

const SESSION_TTL_DAYS = Math.max(
  Number(process.env.AUTH_SESSION_TTL_DAYS || 7),
  1
);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function requestIp(req) {
  return cleanText(
    String(
      req?.headers?.["x-forwarded-for"] ||
        req?.ip ||
        req?.socket?.remoteAddress ||
        ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(req?.headers?.["user-agent"], 255);
}

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession({
  userId,
  req,
  workspaceCode = null,
  branchId = null,
}) {
  const connection = await pool.getConnection();
  const sessionId = createSessionId();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT id
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (users.length === 0) {
      const error = new Error("User account was not found.");
      error.code = "SESSION_USER_NOT_FOUND";
      throw error;
    }

    const [revokeResult] = await connection.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW(),
           revocation_reason = 'replaced_by_new_login',
           replaced_by_session_id = ?
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [sessionId, userId]
    );

    await connection.query(
      `INSERT INTO auth_sessions (
         session_id,
         user_id,
         workspace_code,
         branch_id,
         ip_address,
         user_agent,
         created_at,
         last_seen_at,
         expires_at
       )
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(),
         DATE_ADD(NOW(), INTERVAL ? DAY)
       )`,
      [
        sessionId,
        userId,
        workspaceCode || null,
        branchId || null,
        requestIp(req) || null,
        requestUserAgent(req) || null,
        SESSION_TTL_DAYS,
      ]
    );

    await connection.commit();

    return {
      sessionId,
      replacedSessionCount: Number(revokeResult.affectedRows || 0),
      expiresInDays: SESSION_TTL_DAYS,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failure after the original error.
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function validateSession({ userId, sessionId }) {
  if (!userId || !sessionId) {
    return {
      ok: false,
      statusCode: 401,
      code: "SESSION_REQUIRED",
      message: "Your secure session is missing. Please login again.",
    };
  }

  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         session_id,
         user_id,
         expires_at,
         revoked_at,
         revocation_reason
       FROM auth_sessions
       WHERE session_id = ?
         AND user_id = ?
       LIMIT 1`,
      [sessionId, userId]
    );

    if (rows.length === 0) {
      return {
        ok: false,
        statusCode: 401,
        code: "SESSION_REVOKED",
        message: "Your session is no longer active. Please login again.",
      };
    }

    const session = rows[0];

    if (session.revoked_at) {
      if (session.revocation_reason === "replaced_by_new_login") {
        return {
          ok: false,
          statusCode: 401,
          code: "SESSION_REPLACED",
          message: "Your account was signed in on another device.",
        };
      }

      return {
        ok: false,
        statusCode: 401,
        code: "SESSION_REVOKED",
        message: "Your session has ended. Please login again.",
      };
    }

    const expiresAt = new Date(session.expires_at);

    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, NOW()),
             revocation_reason = COALESCE(
               revocation_reason,
               'expired'
             )
         WHERE id = ?`,
        [session.id]
      );

      return {
        ok: false,
        statusCode: 401,
        code: "SESSION_EXPIRED",
        message: "Your session expired. Please login again.",
      };
    }

    await pool.query(
      `UPDATE auth_sessions
       SET last_seen_at = NOW()
       WHERE id = ?
         AND revoked_at IS NULL
         AND last_seen_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [session.id]
    );

    return {
      ok: true,
      session,
    };
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      return {
        ok: false,
        statusCode: 503,
        code: "SESSION_STORE_UNAVAILABLE",
        message:
          "Secure session storage is not ready. Please contact the System Administrator.",
      };
    }

    throw error;
  }
}

async function revokeSession({
  userId,
  sessionId,
  reason = "logout",
}) {
  if (!userId || !sessionId) {
    return 0;
  }

  const [result] = await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE user_id = ?
       AND session_id = ?`,
    [cleanText(reason, 80) || "logout", userId, sessionId]
  );

  return Number(result.affectedRows || 0);
}

async function revokeAllUserSessions(
  userId,
  reason = "security_revoke"
) {
  if (!userId) {
    return 0;
  }

  const [result] = await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [cleanText(reason, 80) || "security_revoke", userId]
  );

  return Number(result.affectedRows || 0);
}

module.exports = {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  validateSession,
};