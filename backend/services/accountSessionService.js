const crypto = require("crypto");

const { pool } = require("../config/db");
const { parseDeviceEvidence } = require("./sessionDeviceService");
const {
  expiryResponse,
  getEffectiveSessionExpiry,
  getSessionPolicy,
} = require("./sessionExpiryPolicy");

const configuredSessionLimit = Number(
  process.env.MAX_ACTIVE_SESSIONS_PER_USER || 5
);
const MAX_ACTIVE_SESSIONS_PER_USER = Number.isInteger(configuredSessionLimit)
  ? Math.max(2, Math.min(configuredSessionLimit, 10))
  : 5;

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function requestIp(req) {
  return cleanText(
    String(
      req?.headers?.["x-forwarded-for"] ||
        req?.headers?.["cf-connecting-ip"] ||
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

function requestNetworkCountry(req) {
  return cleanText(
    req?.headers?.["cf-ipcountry"] ||
      req?.headers?.["x-vercel-ip-country"] ||
      req?.headers?.["x-country-code"] ||
      "",
    8
  );
}

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

async function insertLegacySession({
  connection,
  sessionId,
  userId,
  workspaceCode,
  branchId,
  req,
}) {
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
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(),
       LEAST(
         DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR),
         DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
       )
     )`,
    [
      sessionId,
      userId,
      workspaceCode || null,
      branchId || null,
      requestIp(req) || null,
      requestUserAgent(req) || null,
    ]
  );
}

async function insertRichSession({
  connection,
  sessionId,
  userId,
  workspaceCode,
  branchId,
  req,
  loginMethod,
  parsedEvidence,
}) {
  await connection.query(
    `INSERT INTO auth_sessions (
       session_id,
       user_id,
       workspace_code,
       login_method,
       branch_id,
       ip_address,
       user_agent,
       device_type,
       device_label,
       device_model,
       device_platform,
       architecture,
       os_name,
       os_version,
       browser_name,
       browser_version,
       client_timezone,
       client_language,
       screen_width,
       screen_height,
       pixel_ratio,
       touch_points,
       pwa_mode,
       location_permission,
       location_source,
       latitude,
       longitude,
       location_accuracy_m,
       location_recorded_at,
       network_country,
       created_at,
       last_seen_at,
       expires_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(),
       LEAST(
         DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR),
         DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
       )
     )`,
    [
      sessionId,
      userId,
      workspaceCode || null,
      String(loginMethod || "username").slice(0, 20),
      branchId || null,
      requestIp(req) || null,
      requestUserAgent(req) || null,
      parsedEvidence.device_type,
      parsedEvidence.device_label,
      parsedEvidence.device_model,
      parsedEvidence.device_platform,
      parsedEvidence.architecture,
      parsedEvidence.os_name,
      parsedEvidence.os_version,
      parsedEvidence.browser_name,
      parsedEvidence.browser_version,
      parsedEvidence.client_timezone,
      parsedEvidence.client_language,
      parsedEvidence.screen_width,
      parsedEvidence.screen_height,
      parsedEvidence.pixel_ratio,
      parsedEvidence.touch_points,
      parsedEvidence.pwa_mode ? 1 : 0,
      parsedEvidence.location_permission,
      parsedEvidence.location_source,
      parsedEvidence.latitude,
      parsedEvidence.longitude,
      parsedEvidence.location_accuracy_m,
      parsedEvidence.location_recorded_at,
      parsedEvidence.network_country,
    ]
  );
}

async function retireExcessActiveSessions({ connection, userId, sessionId }) {
  const [activeSessions] = await connection.query(
    `SELECT id, session_id
     FROM auth_sessions
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [userId]
  );

  const excessSessions = activeSessions.slice(MAX_ACTIVE_SESSIONS_PER_USER);

  if (excessSessions.length === 0) {
    return 0;
  }

  const excessIds = excessSessions.map((session) => Number(session.id));
  const placeholders = excessIds.map(() => "?").join(", ");
  const [result] = await connection.query(
    `UPDATE auth_sessions
     SET revoked_at = UTC_TIMESTAMP(),
         revocation_reason = 'session_limit_exceeded',
         replaced_by_session_id = ?
     WHERE id IN (${placeholders})
       AND revoked_at IS NULL`,
    [sessionId, ...excessIds]
  );

  return Number(result.affectedRows || 0);
}

async function createSession({
  userId,
  req,
  workspaceCode = null,
  branchId = null,
  loginMethod = "username",
  deviceEvidence = {},
}) {
  const connection = await pool.getConnection();
  const sessionId = createSessionId();
  const sessionPolicy = getSessionPolicy(new Date());
  const parsedEvidence = parseDeviceEvidence({
    userAgent: requestUserAgent(req),
    evidence: deviceEvidence || {},
    networkCountry: requestNetworkCountry(req),
  });

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

    try {
      await insertRichSession({
        connection,
        sessionId,
        userId,
        workspaceCode,
        branchId,
        req,
        loginMethod,
        parsedEvidence,
      });
    } catch (error) {
      if (error.code !== "ER_BAD_FIELD_ERROR") {
        throw error;
      }

      await insertLegacySession({
        connection,
        sessionId,
        userId,
        workspaceCode,
        branchId,
        req,
      });
    }

    const retiredSessionCount = await retireExcessActiveSessions({
      connection,
      userId,
      sessionId,
    });

    await connection.commit();

    return {
      sessionId,
      replacedSessionCount: retiredSessionCount,
      activeSessionLimit: MAX_ACTIVE_SESSIONS_PER_USER,
      expiresAt: sessionPolicy.expiresAt.toISOString(),
      expiresInSeconds: Math.max(
        0,
        Math.floor((sessionPolicy.expiresAt.getTime() - Date.now()) / 1000)
      ),
      expiryReason: sessionPolicy.reason,
      device: parsedEvidence,
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
         created_at,
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

      if (session.revocation_reason === "session_limit_exceeded") {
        return {
          ok: false,
          statusCode: 401,
          code: "SESSION_LIMIT_EXCEEDED",
          message:
            "This older device session ended because the account reached its active-device limit.",
        };
      }

      return {
        ok: false,
        statusCode: 401,
        code: "SESSION_REVOKED",
        message: "Your session has ended. Please login again.",
      };
    }

    const effectiveExpiry = getEffectiveSessionExpiry({
      createdAt: session.created_at,
      storedExpiresAt: session.expires_at,
    });

    if (effectiveExpiry.expiresAt.getTime() <= Date.now()) {
      const response = expiryResponse(effectiveExpiry);

      await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
             revocation_reason = COALESCE(revocation_reason, ?)
         WHERE id = ?`,
        [response.revocationReason, session.id]
      );

      return {
        ok: false,
        statusCode: 401,
        code: response.code,
        message: response.message,
        expires_at: effectiveExpiry.expiresAt.toISOString(),
      };
    }

    await pool.query(
      `UPDATE auth_sessions
       SET last_seen_at = UTC_TIMESTAMP()
       WHERE id = ?
         AND revoked_at IS NULL
         AND last_seen_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)`,
      [session.id]
    );

    return {
      ok: true,
      session: {
        ...session,
        expires_at: effectiveExpiry.expiresAt,
        expiry_reason: effectiveExpiry.reason,
      },
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
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
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
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
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
