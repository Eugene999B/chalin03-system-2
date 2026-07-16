const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendSmsAlertToPhone,
} = require("../services/smsAlertService");
const {
  buildOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} = require("../services/ownerMfaService");

const router = express.Router();

const SYSTEM_ADMIN_ID = Number(
  process.env.SYSTEM_ADMIN_USER_ID || 1
);

const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
)
  .trim()
  .toLowerCase();

const OWNER_SESSION_MINUTES = Math.max(
  Math.min(
    Number(
      process.env.OWNER_RECOVERY_SESSION_MINUTES || 15
    ),
    30
  ),
  5
);

const OWNER_MAX_FAILURES = Math.max(
  Math.min(
    Number(
      process.env.OWNER_RECOVERY_MAX_FAILED_ATTEMPTS || 5
    ),
    10
  ),
  3
);

const MFA_ENROLLMENT_MINUTES = 15;

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(
      handler(req, res, next)
    ).catch(next);
}

function cleanText(value, maxLength = 255) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function booleanValue(value) {
  return (
    value === true ||
    Number(value || 0) === 1
  );
}

function requestIp(req) {
  return cleanText(
    String(
      req.headers["x-forwarded-for"] ||
        req.ip ||
        req.socket?.remoteAddress ||
        ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(
    req.headers["user-agent"],
    500
  );
}

function randomToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function mysqlDateTime(value = new Date()) {
  return value
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize(value[key]),
        ])
    );
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function canonicalJson(value) {
  return JSON.stringify(
    canonicalize(value)
  );
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Password must be at least 8 characters.";
  }

  if (
    !/[a-z]/.test(text) ||
    !/[A-Z]/.test(text)
  ) {
    return "Password must contain uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Password must contain a number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Password must contain a symbol.";
  }

  return "";
}

function encryptionKeyReady() {
  return (
    String(
      process.env.OWNER_MFA_ENCRYPTION_KEY || ""
    ).trim().length >= 32
  );
}

async function appendLedger({
  req = null,
  actorUserId = null,
  targetUserId = null,
  actorType = "user",
  actionCode,
  outcome = "success",
  severity = "critical",
  entityType = null,
  entityId = null,
  payload = {},
}) {
  const connection =
    await pool.getConnection();

  let lockAcquired = false;

  try {
    const [lockRows] =
      await connection.query(
        "SELECT GET_LOCK(?, 10) AS acquired",
        ["chalin03_privileged_ledger"]
      );

    if (
      Number(
        lockRows[0]?.acquired || 0
      ) !== 1
    ) {
      const error = new Error(
        "Privileged ledger is busy. Retry the protected action."
      );

      error.statusCode = 503;
      throw error;
    }

    lockAcquired = true;

    await connection.beginTransaction();

    const [previousRows] =
      await connection.query(
        `SELECT event_hash
         FROM privileged_action_ledger
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`
      );

    const previousHash =
      previousRows[0]?.event_hash ||
      null;

    const occurredAt =
      mysqlDateTime();

    const cleanPayload =
      canonicalize(payload);

    const hashPayload =
      canonicalJson({
        action_code: actionCode,
        actor_type: actorType,
        actor_user_id:
          actorUserId || null,
        target_user_id:
          targetUserId || null,
        outcome,
        severity,
        entity_type: entityType,
        entity_id:
          entityId === null
            ? null
            : String(entityId),
        occurred_at: occurredAt,
        payload: cleanPayload,
      });

    const eventHash = sha256(
      `${previousHash || ""}\n${hashPayload}`
    );

    await connection.query(
      `INSERT INTO privileged_action_ledger (
         actor_user_id,
         target_user_id,
         actor_type,
         action_code,
         outcome,
         severity,
         entity_type,
         entity_id,
         request_id,
         ip_address,
         user_agent,
         payload_json,
         hash_payload,
         previous_event_hash,
         event_hash,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId || null,
        targetUserId || null,
        actorType,
        cleanText(actionCode, 150),
        cleanText(outcome, 40),
        cleanText(severity, 40),
        cleanText(entityType, 80) ||
          null,
        entityId === null
          ? null
          : cleanText(entityId, 100),
        req?.requestId || null,
        req
          ? requestIp(req) || null
          : null,
        req
          ? requestUserAgent(req) ||
            null
          : null,
        canonicalJson(cleanPayload),
        hashPayload,
        previousHash,
        eventHash,
        occurredAt,
      ]
    );

    await connection.commit();

    return eventHash;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          ["chalin03_privileged_ledger"]
        );
      } catch (error) {
        console.warn(
          "Owner-security ledger release warning:",
          error.message
        );
      }
    }

    connection.release();
  }
}

async function protectedActionRecord(req) {
  const rawToken = cleanText(
    req.headers[
      "x-protected-action-token"
    ],
    200
  );

  if (!rawToken) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
       id,
       user_id,
       purpose,
       expires_at
     FROM protected_action_sessions
     WHERE token_hash = ?
       AND user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [
      sha256(rawToken),
      req.user.id,
    ]
  );

  if (!rows.length) {
    return null;
  }

  await pool.query(
    `UPDATE protected_action_sessions
     SET last_used_at = NOW()
     WHERE id = ?`,
    [rows[0].id]
  );

  return rows[0];
}

function requireProtectedAction(
  req,
  res,
  next
) {
  protectedActionRecord(req)
    .then((record) => {
      if (!record) {
        return res
          .status(403)
          .json({
            status: "error",
            code:
              "PROTECTED_ACTION_REQUIRED",
            message:
              "Unlock protected actions with your current password before continuing.",
          });
      }

      req.protectedAction =
        record;

      return next();
    })
    .catch(next);
}

async function requireOriginalAdmin(
  req,
  res,
  next
) {
  const [rows] = await pool.query(
    `SELECT id, username, role
     FROM users
     WHERE id = ?
       AND username = ?
       AND LOWER(role) = 'admin'
     LIMIT 1`,
    [
      SYSTEM_ADMIN_ID,
      SYSTEM_ADMIN_USERNAME,
    ]
  );

  if (
    !rows.length ||
    Number(req.user?.id) !==
      SYSTEM_ADMIN_ID
  ) {
    return res
      .status(403)
      .json({
        status: "error",
        message:
          "Only the original System Administrator can manage Owner Break-Glass security.",
      });
  }

  req.originalSystemAdmin =
    rows[0];

  return next();
}

async function ownerSessionRecord(req) {
  const rawToken = cleanText(
    req.headers[
      "x-owner-recovery-token"
    ],
    200
  );

  if (!rawToken) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
       ors.id,
       ors.owner_account_id,
       ors.expires_at,
       oba.username,
       oba.phone
     FROM owner_recovery_sessions ors
     INNER JOIN owner_break_glass_accounts oba
       ON oba.id = ors.owner_account_id
     WHERE ors.token_hash = ?
       AND ors.used_at IS NULL
       AND ors.revoked_at IS NULL
       AND ors.expires_at > NOW()
       AND oba.is_active = TRUE
     LIMIT 1`,
    [sha256(rawToken)]
  );

  return rows[0] || null;
}

function requireOwnerSession(
  req,
  res,
  next
) {
  ownerSessionRecord(req)
    .then((record) => {
      if (!record) {
        return res
          .status(401)
          .json({
            status: "error",
            code:
              "OWNER_RECOVERY_SESSION_INVALID",
            message:
              "The Owner Break-Glass session is invalid or expired.",
          });
      }

      req.ownerRecovery =
        record;

      return next();
    })
    .catch(next);
}

async function activeOwner(
  connection = pool,
  lock = false
) {
  const [rows] =
    await connection.query(
      `SELECT
         oba.*,
         (
           SELECT COUNT(*)
           FROM owner_break_glass_recovery_codes rc
           WHERE rc.owner_account_id = oba.id
             AND rc.used_at IS NULL
         ) AS unused_recovery_codes
       FROM owner_break_glass_accounts oba
       WHERE oba.is_active = TRUE
       ORDER BY oba.id DESC
       LIMIT 1${lock ? " FOR UPDATE" : ""}`
    );

  return rows[0] || null;
}

async function recordOwnerLogin({
  connection = pool,
  ownerAccountId = null,
  usernameAttempted = null,
  outcome,
  failureReason = null,
  mfaMethod = null,
  req,
}) {
  await connection.query(
    `INSERT INTO owner_break_glass_login_history (
       owner_account_id,
       username_attempted,
       outcome,
       failure_reason,
       mfa_method,
       ip_address,
       user_agent,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      ownerAccountId || null,
      cleanText(
        usernameAttempted,
        100
      ) || null,
      cleanText(outcome, 40),
      cleanText(
        failureReason,
        120
      ) || null,
      cleanText(mfaMethod, 40) ||
        null,
      requestIp(req) || null,
      requestUserAgent(req) ||
        null,
    ]
  );
}

function ownerReadiness(owner) {
  if (!owner?.id) {
    return {
      code: "not_configured",
      label: "Not configured",
      detail:
        "Create the separate Owner Break-Glass account.",
      fully_protected: false,
      encryption_key_ready:
        encryptionKeyReady(),
      unused_recovery_codes: 0,
    };
  }

  if (!encryptionKeyReady()) {
    return {
      code:
        "encryption_key_required",
      label:
        "Encryption key required",
      detail:
        "The server Owner MFA encryption key must be configured before MFA activation.",
      fully_protected: false,
      encryption_key_ready: false,
      unused_recovery_codes:
        Number(
          owner.unused_recovery_codes ||
            0
        ),
    };
  }

  if (
    !booleanValue(
      owner.mfa_enabled
    )
  ) {
    return {
      code:
        "configured_without_mfa",
      label: "MFA pending",
      detail:
        "Owner Break-Glass exists, but authenticator MFA has not been confirmed.",
      fully_protected: false,
      encryption_key_ready: true,
      unused_recovery_codes:
        Number(
          owner.unused_recovery_codes ||
            0
        ),
    };
  }

  if (
    Number(
      owner.unused_recovery_codes ||
        0
    ) < 1
  ) {
    return {
      code:
        "recovery_codes_required",
      label:
        "Recovery codes required",
      detail:
        "Authenticator MFA is active, but no unused emergency recovery code remains.",
      fully_protected: false,
      encryption_key_ready: true,
      unused_recovery_codes: 0,
    };
  }

  return {
    code: "fully_protected",
    label: "Fully protected",
    detail:
      "Owner Break-Glass uses password, authenticator MFA and one-time recovery codes.",
    fully_protected: true,
    encryption_key_ready: true,
    unused_recovery_codes:
      Number(
        owner.unused_recovery_codes ||
          0
      ),
  };
}

async function sendOwnerChangeAlert({
  phone,
  message,
  sourceReference,
}) {
  if (!phone) {
    return;
  }

  try {
    const {
      businessName,
    } =
      await buildOwnerAlertContext(
        1
      );

    await sendSmsAlertToPhone({
      branchId: 1,
      phone,
      message: `${businessName}: ${message} ${formatSecurityDateTime()}.`,
      logMessage:
        `${businessName}: Owner security change notification submitted.`,
      smsType:
        "security_alert",
      sentBy: null,
      sourceReference,
    });
  } catch (error) {
    console.warn(
      "Owner security SMS skipped:",
      error.message
    );
  }
}

async function replaceRecoveryCodes(
  connection,
  ownerAccountId,
  codes
) {
  await connection.query(
    `DELETE FROM owner_break_glass_recovery_codes
     WHERE owner_account_id = ?`,
    [ownerAccountId]
  );

  for (const code of codes) {
    await connection.query(
      `INSERT INTO owner_break_glass_recovery_codes (
         owner_account_id,
         code_hash,
         created_at
       )
       VALUES (?, ?, NOW())`,
      [
        ownerAccountId,
        hashRecoveryCode(code),
      ]
    );
  }

  await connection.query(
    `UPDATE owner_break_glass_accounts
     SET recovery_codes_generated_at = NOW()
     WHERE id = ?`,
    [ownerAccountId]
  );
}

async function registerOwnerFailure({
  owner,
  username,
  reason,
  mfaMethod = null,
  req,
}) {
  if (!owner) {
    await recordOwnerLogin({
      usernameAttempted:
        username,
      outcome: "failure",
      failureReason: reason,
      mfaMethod,
      req,
    });

    return false;
  }

  const nextFailures =
    Number(
      owner.failed_attempts || 0
    ) + 1;

  const shouldLock =
    nextFailures >=
    OWNER_MAX_FAILURES;

  await pool.query(
    `UPDATE owner_break_glass_accounts
     SET failed_attempts = ?,
         locked_until = ${
           shouldLock
             ? "DATE_ADD(NOW(), INTERVAL 15 MINUTE)"
             : "NULL"
         }
     WHERE id = ?`,
    [
      shouldLock
        ? 0
        : nextFailures,
      owner.id,
    ]
  );

  await recordOwnerLogin({
    ownerAccountId:
      owner.id,
    usernameAttempted:
      username,
    outcome:
      shouldLock
        ? "locked"
        : "failure",
    failureReason: reason,
    mfaMethod,
    req,
  });

  await appendLedger({
    req,
    actorType: "owner",
    actionCode:
      "OWNER_BREAK_GLASS_LOGIN_FAILED",
    outcome: "failure",
    severity:
      shouldLock
        ? "critical"
        : "warning",
    entityType:
      "owner_break_glass",
    entityId:
      owner.id,
    payload: {
      failure_reason: reason,
      mfa_method:
        mfaMethod || null,
      account_locked:
        shouldLock,
      passwords_or_codes_recorded:
        false,
    },
  });

  return shouldLock;
}

router.get(
  "/security/owner-readiness",
  requireAuth,
  requirePermission(
    "security.view"
  ),
  asyncHandler(
    async (req, res) => {
      const owner =
        await activeOwner();

      return res.json({
        status: "success",
        owner: owner
          ? {
              id: owner.id,
              username:
                owner.username,
              phone:
                owner.phone,
              is_active:
                booleanValue(
                  owner.is_active
                ),
              mfa_enabled:
                booleanValue(
                  owner.mfa_enabled
                ),
              mfa_confirmed_at:
                owner.mfa_confirmed_at,
              recovery_codes_generated_at:
                owner.recovery_codes_generated_at,
              unused_recovery_codes:
                Number(
                  owner.unused_recovery_codes ||
                    0
                ),
              last_login_at:
                owner.last_login_at,
              last_login_ip:
                owner.last_login_ip,
              rotated_at:
                owner.rotated_at,
            }
          : null,
        readiness:
          ownerReadiness(owner),
      });
    }
  )
);

router.get(
  "/security/owner-login-history",
  requireAuth,
  requirePermission(
    "security.view"
  ),
  asyncHandler(
    async (req, res) => {
      const [rows] =
        await pool.query(
          `SELECT
             id,
             owner_account_id,
             username_attempted,
             outcome,
             failure_reason,
             mfa_method,
             ip_address,
             user_agent,
             created_at
           FROM owner_break_glass_login_history
           ORDER BY id DESC
           LIMIT 100`
        );

      return res.json({
        status: "success",
        login_history: rows,
      });
    }
  )
);

router.post(
  "/security/break-glass/setup",
  requireAuth,
  requirePermission(
    "security.admin"
  ),
  requireProtectedAction,
  requireOriginalAdmin,
  asyncHandler(
    async (req, res) => {
      const username =
        cleanText(
          req.body?.username,
          100
        ).toLowerCase();

      const phone =
        cleanText(
          req.body?.phone,
          30
        );

      const password =
        req.body?.password;

      const confirmation =
        req.body
          ?.confirm_password;

      if (
        !username ||
        !phone ||
        !password
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Owner username, phone and password are required.",
          });
      }

      if (
        username ===
        SYSTEM_ADMIN_USERNAME
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Owner Break-Glass must use a separate username from the System Administrator.",
          });
      }

      if (
        password !== confirmation
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Password confirmation does not match.",
          });
      }

      const policyError =
        strongPasswordError(
          password
        );

      if (policyError) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              policyError,
          });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const connection =
        await pool.getConnection();

      let owner;

      try {
        await connection.beginTransaction();

        await connection.query(
          `UPDATE owner_break_glass_accounts
           SET is_active = FALSE
           WHERE is_active = TRUE`
        );

        await connection.query(
          `INSERT INTO owner_break_glass_accounts (
             username,
             password_hash,
             phone,
             mfa_enabled,
             mfa_secret_ciphertext,
             mfa_secret_iv,
             mfa_secret_tag,
             mfa_confirmed_at,
             mfa_last_verified_at,
             recovery_codes_generated_at,
             is_active,
             failed_attempts,
             locked_until,
             created_by,
             created_at,
             rotated_at
           )
           VALUES (
             ?, ?, ?,
             FALSE, NULL, NULL, NULL,
             NULL, NULL, NULL,
             TRUE, 0, NULL, ?, NOW(), NOW()
           )
           ON DUPLICATE KEY UPDATE
             password_hash = VALUES(password_hash),
             phone = VALUES(phone),
             mfa_enabled = FALSE,
             mfa_secret_ciphertext = NULL,
             mfa_secret_iv = NULL,
             mfa_secret_tag = NULL,
             mfa_confirmed_at = NULL,
             mfa_last_verified_at = NULL,
             recovery_codes_generated_at = NULL,
             is_active = TRUE,
             failed_attempts = 0,
             locked_until = NULL,
             created_by = VALUES(created_by),
             rotated_at = NOW()`,
          [
            username,
            passwordHash,
            phone,
            req.user.id,
          ]
        );

        const [ownerRows] =
          await connection.query(
            `SELECT *
             FROM owner_break_glass_accounts
             WHERE username = ?
               AND is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [username]
          );

        owner = ownerRows[0];

        await connection.query(
          `DELETE FROM owner_break_glass_recovery_codes
           WHERE owner_account_id = ?`,
          [owner.id]
        );

        await connection.query(
          `UPDATE owner_break_glass_mfa_enrollments
           SET revoked_at = NOW()
           WHERE owner_account_id = ?
             AND confirmed_at IS NULL
             AND revoked_at IS NULL`,
          [owner.id]
        );

        await connection.query(
          `UPDATE owner_recovery_sessions
           SET revoked_at = NOW()
           WHERE revoked_at IS NULL
             AND used_at IS NULL`
        );

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "OWNER_BREAK_GLASS_CONFIGURED",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        payload: {
          owner_username:
            username,
          mfa_reset:
            true,
          password_recorded:
            false,
        },
      });

      await writeAuditEvent({
        req,
        userId:
          req.user.id,
        action:
          "OWNER_BREAK_GLASS_CONFIGURED",
        actionType:
          "security.break_glass.configured",
        severity: "critical",
        outcome: "success",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        details:
          "Owner Break-Glass credentials were initialized or rotated. MFA must be enrolled before emergency login is enabled.",
        metadata: {
          password_recorded:
            false,
          mfa_enabled:
            false,
        },
      });

      await sendOwnerChangeAlert({
        phone,
        message:
          "Owner Break-Glass credentials were changed. Authenticator MFA must now be enrolled.",
        sourceReference:
          "release3-owner-credentials-changed",
      });

      return res.json({
        status: "success",
        message:
          "Owner Break-Glass credentials were saved. Authenticator MFA must now be enrolled and confirmed.",
        owner: {
          id: owner.id,
          username:
            owner.username,
          mfa_enabled: false,
        },
      });
    }
  )
);

router.post(
  "/security/break-glass/mfa/start",
  requireAuth,
  requirePermission(
    "security.admin"
  ),
  requireProtectedAction,
  requireOriginalAdmin,
  asyncHandler(
    async (req, res) => {
      if (!encryptionKeyReady()) {
        return res
          .status(503)
          .json({
            status: "error",
            code:
              "OWNER_MFA_ENCRYPTION_KEY_REQUIRED",
            message:
              "OWNER_MFA_ENCRYPTION_KEY must be configured securely on the backend before MFA enrollment.",
          });
      }

      const owner =
        await activeOwner();

      if (!owner) {
        return res
          .status(404)
          .json({
            status: "error",
            message:
              "Configure Owner Break-Glass credentials before starting MFA enrollment.",
          });
      }

      const secret =
        generateTotpSecret();

      const encrypted =
        encryptMfaSecret(secret);

      const enrollmentToken =
        randomToken();

      const connection =
        await pool.getConnection();

      try {
        await connection.beginTransaction();

        await connection.query(
          `UPDATE owner_break_glass_mfa_enrollments
           SET revoked_at = NOW()
           WHERE owner_account_id = ?
             AND confirmed_at IS NULL
             AND revoked_at IS NULL`,
          [owner.id]
        );

        await connection.query(
          `INSERT INTO owner_break_glass_mfa_enrollments (
             owner_account_id,
             token_hash,
             secret_ciphertext,
             secret_iv,
             secret_tag,
             secret_version,
             created_by,
             created_at,
             expires_at
           )
           VALUES (
             ?, ?, ?, ?, ?, ?, ?, NOW(),
             DATE_ADD(NOW(), INTERVAL ${MFA_ENROLLMENT_MINUTES} MINUTE)
           )`,
          [
            owner.id,
            sha256(
              enrollmentToken
            ),
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.tag,
            encrypted.version,
            req.user.id,
          ]
        );

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "OWNER_MFA_ENROLLMENT_STARTED",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        payload: {
          expires_in_minutes:
            MFA_ENROLLMENT_MINUTES,
          secret_recorded_in_ledger:
            false,
        },
      });

      return res.json({
        status: "success",
        message:
          "Add the account to an authenticator app, then confirm the current 6-digit code.",
        enrollment_token:
          enrollmentToken,
        expires_in_minutes:
          MFA_ENROLLMENT_MINUTES,
        owner_username:
          owner.username,
        manual_secret:
          secret,
        otpauth_uri:
          buildOtpAuthUri({
            secret,
            username:
              owner.username,
          }),
      });
    }
  )
);

router.post(
  "/security/break-glass/mfa/confirm",
  requireAuth,
  requirePermission(
    "security.admin"
  ),
  requireProtectedAction,
  requireOriginalAdmin,
  asyncHandler(
    async (req, res) => {
      const enrollmentToken =
        cleanText(
          req.body
            ?.enrollment_token,
          200
        );

      const code =
        cleanText(
          req.body?.mfa_code,
          20
        );

      if (
        !enrollmentToken ||
        !code
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Enrollment token and current authenticator code are required.",
          });
      }

      const connection =
        await pool.getConnection();

      let owner;
      let recoveryCodes;

      try {
        await connection.beginTransaction();

        const [rows] =
          await connection.query(
            `SELECT
               enrollment.*,
               owner.username,
               owner.phone
             FROM owner_break_glass_mfa_enrollments enrollment
             INNER JOIN owner_break_glass_accounts owner
               ON owner.id = enrollment.owner_account_id
             WHERE enrollment.token_hash = ?
               AND enrollment.confirmed_at IS NULL
               AND enrollment.revoked_at IS NULL
               AND enrollment.expires_at > NOW()
               AND owner.is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [
              sha256(
                enrollmentToken
              ),
            ]
          );

        const enrollment =
          rows[0];

        if (!enrollment) {
          await connection.rollback();

          return res
            .status(400)
            .json({
              status: "error",
              message:
                "The MFA enrollment expired or is no longer valid. Start again.",
            });
        }

        const secret =
          decryptMfaSecret({
            ciphertext:
              enrollment.secret_ciphertext,
            iv:
              enrollment.secret_iv,
            tag:
              enrollment.secret_tag,
          });

        if (
          !verifyTotpCode(
            secret,
            code
          )
        ) {
          await connection.rollback();

          await appendLedger({
            req,
            actorUserId:
              req.user.id,
            actionCode:
              "OWNER_MFA_CONFIRMATION_FAILED",
            outcome: "failure",
            severity: "warning",
            entityType:
              "owner_break_glass",
            entityId:
              enrollment.owner_account_id,
            payload: {
              code_recorded:
                false,
            },
          });

          return res
            .status(400)
            .json({
              status: "error",
              message:
                "The authenticator code was not accepted. Check the device time and try again.",
            });
        }

        recoveryCodes =
          generateRecoveryCodes(8);

        await connection.query(
          `UPDATE owner_break_glass_accounts
           SET mfa_enabled = TRUE,
               mfa_secret_ciphertext = ?,
               mfa_secret_iv = ?,
               mfa_secret_tag = ?,
               mfa_secret_version = ?,
               mfa_confirmed_at = NOW(),
               mfa_last_verified_at = NOW(),
               failed_attempts = 0,
               locked_until = NULL
           WHERE id = ?`,
          [
            enrollment.secret_ciphertext,
            enrollment.secret_iv,
            enrollment.secret_tag,
            enrollment.secret_version,
            enrollment.owner_account_id,
          ]
        );

        await replaceRecoveryCodes(
          connection,
          enrollment.owner_account_id,
          recoveryCodes
        );

        await connection.query(
          `UPDATE owner_break_glass_mfa_enrollments
           SET confirmed_at = NOW()
           WHERE id = ?`,
          [enrollment.id]
        );

        await connection.query(
          `UPDATE owner_break_glass_mfa_enrollments
           SET revoked_at = NOW()
           WHERE owner_account_id = ?
             AND id <> ?
             AND confirmed_at IS NULL
             AND revoked_at IS NULL`,
          [
            enrollment.owner_account_id,
            enrollment.id,
          ]
        );

        await connection.query(
          `UPDATE owner_recovery_sessions
           SET revoked_at = NOW()
           WHERE owner_account_id = ?
             AND used_at IS NULL
             AND revoked_at IS NULL`,
          [
            enrollment.owner_account_id,
          ]
        );

        const [ownerRows] =
          await connection.query(
            `SELECT *
             FROM owner_break_glass_accounts
             WHERE id = ?
             LIMIT 1`,
            [
              enrollment.owner_account_id,
            ]
          );

        owner = ownerRows[0];

        await connection.commit();
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve original error.
        }

        throw error;
      } finally {
        connection.release();
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "OWNER_MFA_ENABLED",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        payload: {
          recovery_code_count:
            recoveryCodes.length,
          secret_or_codes_recorded:
            false,
        },
      });

      await writeAuditEvent({
        req,
        userId:
          req.user.id,
        action:
          "OWNER_BREAK_GLASS_MFA_ENABLED",
        actionType:
          "security.break_glass.mfa_enabled",
        severity: "critical",
        outcome: "success",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        details:
          "Owner Break-Glass authenticator MFA was enabled and new one-time recovery codes were generated.",
        metadata: {
          recovery_code_count:
            recoveryCodes.length,
          secret_or_codes_recorded:
            false,
        },
      });

      await sendOwnerChangeAlert({
        phone:
          owner.phone,
        message:
          "Owner Break-Glass authenticator MFA was enabled and emergency recovery codes were rotated.",
        sourceReference:
          "release3-owner-mfa-enabled",
      });

      return res.json({
        status: "success",
        message:
          "Owner MFA is active. Save these recovery codes now; they will not be displayed again.",
        recovery_codes:
          recoveryCodes,
        readiness:
          ownerReadiness({
            ...owner,
            mfa_enabled: true,
            unused_recovery_codes:
              recoveryCodes.length,
          }),
      });
    }
  )
);

router.post(
  "/security/break-glass/recovery-codes/rotate",
  requireAuth,
  requirePermission(
    "security.admin"
  ),
  requireProtectedAction,
  requireOriginalAdmin,
  asyncHandler(
    async (req, res) => {
      const connection =
        await pool.getConnection();

      let owner;
      let recoveryCodes;

      try {
        await connection.beginTransaction();

        owner =
          await activeOwner(
            connection,
            true
          );

        if (
          !owner ||
          !booleanValue(
            owner.mfa_enabled
          )
        ) {
          await connection.rollback();

          return res
            .status(409)
            .json({
              status: "error",
              message:
                "Enable and confirm Owner MFA before rotating recovery codes.",
            });
        }

        recoveryCodes =
          generateRecoveryCodes(8);

        await replaceRecoveryCodes(
          connection,
          owner.id,
          recoveryCodes
        );

        await connection.commit();
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve original error.
        }

        throw error;
      } finally {
        connection.release();
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "OWNER_RECOVERY_CODES_ROTATED",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        payload: {
          recovery_code_count:
            recoveryCodes.length,
          codes_recorded:
            false,
        },
      });

      await sendOwnerChangeAlert({
        phone:
          owner.phone,
        message:
          "Owner Break-Glass emergency recovery codes were rotated. All previous codes are invalid.",
        sourceReference:
          "release3-owner-recovery-codes-rotated",
      });

      return res.json({
        status: "success",
        message:
          "Recovery codes were rotated. Save the new codes now; previous codes are invalid.",
        recovery_codes:
          recoveryCodes,
      });
    }
  )
);

router.post(
  "/owner/login",
  asyncHandler(
    async (req, res) => {
      const username =
        cleanText(
          req.body?.username,
          100
        ).toLowerCase();

      const password =
        req.body?.password;

      const mfaCode =
        cleanText(
          req.body?.mfa_code,
          20
        );

      const recoveryCode =
        normalizeRecoveryCode(
          req.body
            ?.recovery_code
        );

      const genericMessage =
        "Owner Break-Glass credentials were not accepted.";

      if (
        !username ||
        !password
      ) {
        await recordOwnerLogin({
          usernameAttempted:
            username,
          outcome: "failure",
          failureReason:
            "missing_credentials",
          req,
        });

        return res
          .status(401)
          .json({
            status: "error",
            message:
              genericMessage,
          });
      }

      const [rows] =
        await pool.query(
          `SELECT *
           FROM owner_break_glass_accounts
           WHERE username = ?
             AND is_active = TRUE
           LIMIT 1`,
          [username]
        );

      const owner = rows[0];

      if (!owner) {
        await registerOwnerFailure({
          owner: null,
          username,
          reason:
            "unknown_account",
          req,
        });

        return res
          .status(401)
          .json({
            status: "error",
            message:
              genericMessage,
          });
      }

      if (
        owner.locked_until &&
        new Date(
          owner.locked_until
        ).getTime() >
          Date.now()
      ) {
        await recordOwnerLogin({
          ownerAccountId:
            owner.id,
          usernameAttempted:
            username,
          outcome: "locked",
          failureReason:
            "temporary_lock_active",
          req,
        });

        return res
          .status(423)
          .json({
            status: "error",
            message:
              "Owner Break-Glass is temporarily locked. Wait and try again.",
          });
      }

      const passwordMatches =
        await bcrypt.compare(
          password,
          owner.password_hash
        );

      if (!passwordMatches) {
        await registerOwnerFailure({
          owner,
          username,
          reason:
            "invalid_password",
          req,
        });

        return res
          .status(401)
          .json({
            status: "error",
            message:
              genericMessage,
          });
      }

      if (
        !booleanValue(
          owner.mfa_enabled
        )
      ) {
        await recordOwnerLogin({
          ownerAccountId:
            owner.id,
          usernameAttempted:
            username,
          outcome: "denied",
          failureReason:
            "mfa_not_configured",
          req,
        });

        await appendLedger({
          req,
          actorType: "owner",
          actionCode:
            "OWNER_LOGIN_BLOCKED_MFA_NOT_CONFIGURED",
          outcome: "failure",
          severity: "critical",
          entityType:
            "owner_break_glass",
          entityId:
            owner.id,
          payload: {
            password_accepted:
              true,
            password_recorded:
              false,
          },
        });

        return res
          .status(428)
          .json({
            status: "error",
            code:
              "OWNER_MFA_NOT_CONFIGURED",
            message:
              "Owner Break-Glass MFA is not active. The System Administrator must complete MFA enrollment in Security Centre.",
          });
      }

      const usingAuthenticator =
        Boolean(mfaCode);

      const usingRecoveryCode =
        Boolean(recoveryCode);

      if (
        usingAuthenticator ===
        usingRecoveryCode
      ) {
        await registerOwnerFailure({
          owner,
          username,
          reason:
            "one_second_factor_required",
          req,
        });

        return res
          .status(401)
          .json({
            status: "error",
            message:
              "Provide either the authenticator code or one emergency recovery code.",
          });
      }

      const connection =
        await pool.getConnection();

      let mfaMethod;
      let sessionToken;

      try {
        await connection.beginTransaction();

        const [lockedRows] =
          await connection.query(
            `SELECT *
             FROM owner_break_glass_accounts
             WHERE id = ?
               AND is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [owner.id]
          );

        const lockedOwner =
          lockedRows[0];

        let mfaValid = false;

        if (usingRecoveryCode) {
          mfaMethod =
            "recovery_code";

          const codeHash =
            hashRecoveryCode(
              recoveryCode
            );

          const [codeRows] =
            await connection.query(
              `SELECT id
               FROM owner_break_glass_recovery_codes
               WHERE owner_account_id = ?
                 AND code_hash = ?
                 AND used_at IS NULL
               LIMIT 1
               FOR UPDATE`,
              [
                owner.id,
                codeHash,
              ]
            );

          if (codeRows.length) {
            const [result] =
              await connection.query(
                `UPDATE owner_break_glass_recovery_codes
                 SET used_at = NOW(),
                     used_ip = ?
                 WHERE id = ?
                   AND used_at IS NULL`,
                [
                  requestIp(req) ||
                    null,
                  codeRows[0].id,
                ]
              );

            mfaValid =
              result.affectedRows === 1;
          }
        } else {
          mfaMethod =
            "authenticator";

          const secret =
            decryptMfaSecret({
              ciphertext:
                lockedOwner.mfa_secret_ciphertext,
              iv:
                lockedOwner.mfa_secret_iv,
              tag:
                lockedOwner.mfa_secret_tag,
            });

          mfaValid =
            verifyTotpCode(
              secret,
              mfaCode
            );
        }

        if (!mfaValid) {
          await connection.rollback();

          await registerOwnerFailure({
            owner:
              lockedOwner,
            username,
            reason:
              "invalid_second_factor",
            mfaMethod,
            req,
          });

          return res
            .status(401)
            .json({
              status: "error",
              message:
                genericMessage,
            });
        }

        await connection.query(
          `UPDATE owner_break_glass_accounts
           SET failed_attempts = 0,
               locked_until = NULL,
               last_login_at = NOW(),
               last_login_ip = ?,
               mfa_last_verified_at = NOW()
           WHERE id = ?`,
          [
            requestIp(req) ||
              null,
            owner.id,
          ]
        );

        await connection.query(
          `UPDATE owner_recovery_sessions
           SET revoked_at = NOW()
           WHERE owner_account_id = ?
             AND used_at IS NULL
             AND revoked_at IS NULL`,
          [owner.id]
        );

        sessionToken =
          randomToken();

        await connection.query(
          `INSERT INTO owner_recovery_sessions (
             owner_account_id,
             token_hash,
             ip_address,
             user_agent,
             created_at,
             expires_at
           )
           VALUES (?, ?, ?, ?, NOW(),
             DATE_ADD(NOW(), INTERVAL ${OWNER_SESSION_MINUTES} MINUTE)
           )`,
          [
            owner.id,
            sha256(
              sessionToken
            ),
            requestIp(req) ||
              null,
            requestUserAgent(req) ||
              null,
          ]
        );

        await recordOwnerLogin({
          connection,
          ownerAccountId:
            owner.id,
          usernameAttempted:
            username,
          outcome: "success",
          mfaMethod,
          req,
        });

        await connection.commit();
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve original error.
        }

        throw error;
      } finally {
        connection.release();
      }

      await appendLedger({
        req,
        actorType: "owner",
        actionCode:
          "OWNER_BREAK_GLASS_LOGIN_SUCCESS",
        entityType:
          "owner_break_glass",
        entityId:
          owner.id,
        payload: {
          recovery_window_minutes:
            OWNER_SESSION_MINUTES,
          mfa_method:
            mfaMethod,
          passwords_or_codes_recorded:
            false,
        },
      });

      return res.json({
        status: "success",
        message:
          `Owner recovery session opened for ${OWNER_SESSION_MINUTES} minutes.`,
        owner_recovery_token:
          sessionToken,
        expires_in_minutes:
          OWNER_SESSION_MINUTES,
        mfa_method:
          mfaMethod,
      });
    }
  )
);

router.get(
  "/owner/login-history",
  requireOwnerSession,
  asyncHandler(
    async (req, res) => {
      const [rows] =
        await pool.query(
          `SELECT
             id,
             outcome,
             failure_reason,
             mfa_method,
             ip_address,
             user_agent,
             created_at
           FROM owner_break_glass_login_history
           WHERE owner_account_id = ?
           ORDER BY id DESC
           LIMIT 50`,
          [
            req.ownerRecovery
              .owner_account_id,
          ]
        );

      return res.json({
        status: "success",
        login_history: rows,
      });
    }
  )
);

module.exports = router;
