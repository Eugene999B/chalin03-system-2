const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { revokeAllUserSessions } = require("./accountSessionService");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
  sendSmsAlertToPhone,
} = require("./smsAlertService");
const { normalizeGhanaPhone } = require("./smsService");
const { writeAuditEvent } = require("./auditTrailService");

const SYSTEM_ADMIN_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
)
  .trim()
  .toLowerCase();

const MAX_FAILED_LOGIN_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const OTP_HOURLY_LIMIT = 3;

const GENERIC_RECOVERY_REQUEST_MESSAGE =
  "If the username is eligible and has a valid registered phone, a password recovery code will be sent. Enter the code below or contact the original System Administrator.";

function cleanText(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function booleanValue(value) {
  return value === true || Number(value || 0) === 1;
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

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    cleanText(user?.username, 80).toLowerCase() ===
      SYSTEM_ADMIN_USERNAME &&
    cleanText(user?.role, 30).toLowerCase() === "admin"
  );
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Password must include uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Password must include at least one symbol.";
  }

  return "";
}

function createServiceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function generateOtp() {
  return crypto
    .randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

function getOtpSecret() {
  const secret = cleanText(
    process.env.ACCOUNT_RECOVERY_OTP_SECRET ||
      process.env.JWT_SECRET,
    1000
  );

  if (!secret) {
    throw createServiceError(
      503,
      "OTP_SECRET_MISSING",
      "Password recovery is not configured."
    );
  }

  return secret;
}

function hashOtp({ userId, otp, salt }) {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(`${Number(userId)}:${salt}:${String(otp || "")}`)
    .digest("hex");
}

function verifyOtp({ userId, otp, salt, expectedHash }) {
  const calculated = Buffer.from(
    hashOtp({
      userId,
      otp,
      salt,
    }),
    "hex"
  );

  const expected = Buffer.from(
    String(expectedHash || ""),
    "hex"
  );

  return (
    calculated.length === expected.length &&
    crypto.timingSafeEqual(calculated, expected)
  );
}

function maskPhone(phone) {
  const normalized = normalizeGhanaPhone(phone);

  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");
  const local = `0${digits.slice(3)}`;

  return `${local.slice(0, 3)}***${local.slice(-4)}`;
}

function calculateFailedLoginState({
  currentAttempts,
  originalSystemAdministrator,
}) {
  const current = Math.max(
    Number(currentAttempts || 0),
    0
  );

  if (originalSystemAdministrator) {
    return {
      attempts: Math.min(current + 1, 2),
      locked: false,
      attempts_remaining: null,
      protected_original_admin: true,
    };
  }

  const attempts = Math.min(
    current + 1,
    MAX_FAILED_LOGIN_ATTEMPTS
  );

  return {
    attempts,
    locked: attempts >= MAX_FAILED_LOGIN_ATTEMPTS,
    attempts_remaining: Math.max(
      MAX_FAILED_LOGIN_ATTEMPTS - attempts,
      0
    ),
    protected_original_admin: false,
  };
}

async function sendAccountLockedAlerts(user) {
  const branchId = Number(user.default_branch_id || 1);
  const { businessName } = await buildOwnerAlertContext(branchId);
  const lockedAt = formatSecurityDateTime();

  const userPhone = normalizeGhanaPhone(user.phone);

  if (userPhone) {
    await sendSmsAlertToPhone({
      branchId,
      phone: userPhone,
      message: `${businessName}: Your Chalin 03 account was locked after 3 incorrect password attempts on ${lockedAt}. Use Forgot Password for SMS recovery or contact the original System Administrator. Do not share recovery codes.`,
      logMessage: `${businessName}: Account-lock security notice sent to the registered user. No password or recovery code was included.`,
      smsType: "account_lock_alert",
      sentBy: null,
      sourceReference: `account-lock:user:${user.id}`,
    });
  }

  await sendOwnerSmsAlert({
    branchId,
    message: `${businessName}: Security alert. Account ${user.username} was locked after 3 incorrect password attempts on ${lockedAt}. Active sessions were revoked. Review the account before manually resetting it.`,
    smsType: "account_lock_admin_alert",
    sentBy: null,
    sourceReference: `account-lock:admin:${user.id}`,
  });
}

async function recordFailedLoginAttempt({ req, user }) {
  const connection = await pool.getConnection();
  let result = null;

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT
         id,
         full_name,
         username,
         role,
         phone,
         default_branch_id,
         failed_login_attempts,
         is_login_locked,
         login_locked_at
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [user.id]
    );

    if (rows.length === 0) {
      await connection.rollback();

      return {
        attempts: 0,
        locked: false,
        attempts_remaining: null,
        just_locked: false,
      };
    }

    const currentUser = rows[0];
    const originalAdmin =
      isOriginalSystemAdministrator(currentUser);

    const failureState = calculateFailedLoginState({
      currentAttempts: currentUser.failed_login_attempts,
      originalSystemAdministrator: originalAdmin,
    });

    const wasLocked = booleanValue(
      currentUser.is_login_locked
    );

    const finalLocked =
      !originalAdmin &&
      (wasLocked || failureState.locked);

    const justLocked =
      !originalAdmin &&
      !wasLocked &&
      failureState.locked;

    await connection.query(
      `UPDATE users
       SET failed_login_attempts = ?,
           locked_until = NULL,
           is_login_locked = ?,
           login_locked_at =
             CASE
               WHEN ? = 1
               THEN COALESCE(login_locked_at, NOW())
               ELSE NULL
             END,
           login_lock_reason =
             CASE
               WHEN ? = 1
               THEN 'failed_login_attempts'
               ELSE NULL
             END,
           last_failed_login_at = NOW(),
           last_failed_login_ip = ?
       WHERE id = ?`,
      [
        failureState.attempts,
        finalLocked ? 1 : 0,
        finalLocked ? 1 : 0,
        finalLocked ? 1 : 0,
        requestIp(req) || null,
        currentUser.id,
      ]
    );

    await connection.commit();

    result = {
      ...failureState,
      locked: finalLocked,
      just_locked: justLocked,
      user: currentUser,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    connection.release();
  }

  await writeAuditEvent({
    req,
    userId: result.user.id,
    branchId: result.user.default_branch_id || null,
    action: result.just_locked
      ? "ACCOUNT_LOGIN_LOCKED"
      : "LOGIN_FAILURE",
    actionType: result.just_locked
      ? "security.account.locked"
      : "auth.login.failure",
    outcome: result.just_locked ? "blocked" : "failure",
    severity: result.just_locked ? "critical" : "warning",
    entityType: "user",
    entityId: result.user.id,
    details: result.just_locked
      ? "Account locked after three consecutive incorrect password attempts."
      : "Login failed because the supplied password was incorrect.",
    metadata: {
      failed_login_attempts: result.attempts,
      attempts_remaining: result.attempts_remaining,
      original_system_administrator_protected:
        result.protected_original_admin,
      ip_address: requestIp(req),
      user_agent: requestUserAgent(req),
    },
  });

  if (result.just_locked) {
    await revokeAllUserSessions(
      result.user.id,
      "account_locked"
    );

    try {
      await sendAccountLockedAlerts(result.user);
    } catch (error) {
      console.warn(
        "Account-lock SMS alerts were not completed:",
        error.message
      );
    }
  }

  return result;
}

async function writeRecoveryAudit({
  req,
  user,
  action,
  actionType,
  outcome,
  severity,
  details,
  metadata = {},
}) {
  try {
    await writeAuditEvent({
      req,
      userId: user?.id || null,
      branchId: user?.default_branch_id || null,
      action,
      actionType,
      outcome,
      severity,
      entityType: "user",
      entityId: user?.id || null,
      details,
      metadata: {
        ...metadata,
        ip_address: requestIp(req),
        user_agent: requestUserAgent(req),
      },
    });
  } catch (error) {
    console.warn(
      "Password recovery audit was not completed:",
      error.message
    );
  }
}

async function requestRecoveryOtp({ req, username }) {
  const cleanUsername = cleanText(username, 80);

  if (!cleanUsername) {
    return {
      message: GENERIC_RECOVERY_REQUEST_MESSAGE,
      sent: false,
    };
  }

  const connection = await pool.getConnection();
  let otpRecord = null;

  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT
         id,
         full_name,
         username,
         role,
         phone,
         default_branch_id,
         is_active,
         is_login_locked
       FROM users
       WHERE username = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanUsername]
    );

    const user = users[0] || null;

    if (
      !user ||
      !booleanValue(user.is_active) ||
      isOriginalSystemAdministrator(user) ||
      !normalizeGhanaPhone(user.phone)
    ) {
      await connection.commit();

      return {
        message: GENERIC_RECOVERY_REQUEST_MESSAGE,
        sent: false,
      };
    }

    const ipAddress = requestIp(req);

    const [accountCounts] = await connection.query(
      `SELECT COUNT(*) AS request_count
       FROM password_recovery_otps
       WHERE user_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [user.id]
    );

    const accountHourlyCount = Number(
      accountCounts[0]?.request_count || 0
    );

    let ipHourlyCount = 0;

    if (ipAddress) {
      const [ipCounts] = await connection.query(
        `SELECT COUNT(*) AS request_count
         FROM password_recovery_otps
         WHERE request_ip = ?
           AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
        [ipAddress]
      );

      ipHourlyCount = Number(
        ipCounts[0]?.request_count || 0
      );
    }

    const [latestRows] = await connection.query(
      `SELECT created_at
       FROM password_recovery_otps
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [user.id]
    );

    const latestCreatedAt = latestRows[0]?.created_at
      ? new Date(latestRows[0].created_at)
      : null;

    const cooldownActive =
      latestCreatedAt &&
      !Number.isNaN(latestCreatedAt.getTime()) &&
      Date.now() - latestCreatedAt.getTime() <
        OTP_RESEND_SECONDS * 1000;

    if (
      accountHourlyCount >= OTP_HOURLY_LIMIT ||
      ipHourlyCount >= OTP_HOURLY_LIMIT ||
      cooldownActive
    ) {
      await connection.commit();

      await writeRecoveryAudit({
        req,
        user,
        action: "PASSWORD_RECOVERY_OTP_RATE_LIMITED",
        actionType: "security.password_recovery.rate_limited",
        outcome: "blocked",
        severity: "warning",
        details:
          "Password recovery OTP request was blocked by resend or hourly limits.",
        metadata: {
          account_hourly_count: accountHourlyCount,
          ip_hourly_count: ipHourlyCount,
          cooldown_active: Boolean(cooldownActive),
        },
      });

      return {
        message: GENERIC_RECOVERY_REQUEST_MESSAGE,
        sent: false,
      };
    }

    await connection.query(
      `UPDATE password_recovery_otps
       SET invalidated_at = NOW(),
           invalidation_reason = 'replaced_by_new_request'
       WHERE user_id = ?
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [user.id]
    );

    const otp = generateOtp();
    const salt = crypto.randomBytes(16).toString("hex");
    const otpHash = hashOtp({
      userId: user.id,
      otp,
      salt,
    });

    const [insertResult] = await connection.query(
      `INSERT INTO password_recovery_otps (
         user_id,
         otp_hash,
         otp_salt,
         request_ip,
         request_user_agent,
         attempts_used,
         max_attempts,
         created_at,
         expires_at
       )
       VALUES (?, ?, ?, ?, ?, 0, ?, NOW(),
         DATE_ADD(NOW(), INTERVAL 5 MINUTE)
       )`,
      [
        user.id,
        otpHash,
        salt,
        ipAddress || null,
        requestUserAgent(req) || null,
        OTP_MAX_ATTEMPTS,
      ]
    );

    await connection.commit();

    otpRecord = {
      id: insertResult.insertId,
      otp,
      user,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    connection.release();
  }

  const branchId = Number(
    otpRecord.user.default_branch_id || 1
  );

  const { businessName } =
    await buildOwnerAlertContext(branchId);

  let smsResult = null;

  try {
    smsResult = await sendSmsAlertToPhone({
      branchId,
      phone: otpRecord.user.phone,
      message: `${businessName}: Your Chalin 03 password recovery code is ${otpRecord.otp}. It expires in 5 minutes. Do not share this code with anyone.`,
      logMessage: `${businessName}: A password recovery OTP was sent to the registered account phone. The code is intentionally redacted from SMS history.`,
      smsType: "password_recovery_otp",
      sentBy: null,
      sourceReference: `password-recovery:${otpRecord.id}`,
    });

    await pool.query(
      `UPDATE password_recovery_otps
       SET sms_log_id = ?
       WHERE id = ?`,
      [
        smsResult?.log_id || null,
        otpRecord.id,
      ]
    );

    if (!smsResult?.ok) {
      await pool.query(
        `UPDATE password_recovery_otps
         SET invalidated_at = NOW(),
             invalidation_reason = 'sms_not_accepted'
         WHERE id = ?
           AND consumed_at IS NULL
           AND invalidated_at IS NULL`,
        [otpRecord.id]
      );
    }
  } catch (error) {
    await pool.query(
      `UPDATE password_recovery_otps
       SET invalidated_at = NOW(),
           invalidation_reason = 'sms_send_error'
       WHERE id = ?
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [otpRecord.id]
    );

    console.warn(
      "Password recovery OTP SMS was not completed:",
      error.message
    );
  }

  await writeRecoveryAudit({
    req,
    user: otpRecord.user,
    action: "PASSWORD_RECOVERY_OTP_REQUEST",
    actionType: "security.password_recovery.otp_request",
    outcome: smsResult?.ok ? "success" : "failure",
    severity: smsResult?.ok ? "notice" : "warning",
    details:
      "Password recovery OTP request was processed. The OTP value was not recorded in the audit trail.",
    metadata: {
      masked_phone: maskPhone(otpRecord.user.phone),
      sms_status: smsResult?.status || "failed",
      otp_expires_in_minutes: OTP_TTL_MINUTES,
    },
  });

  return {
    message: GENERIC_RECOVERY_REQUEST_MESSAGE,
    sent: Boolean(smsResult?.ok),
  };
}

async function sendRecoveryCompletedAlerts(user, method) {
  const branchId = Number(user.default_branch_id || 1);
  const { businessName } =
    await buildOwnerAlertContext(branchId);

  const userPhone = normalizeGhanaPhone(user.phone);
  const completedAt = formatSecurityDateTime();

  if (userPhone) {
    await sendSmsAlertToPhone({
      branchId,
      phone: userPhone,
      message: `${businessName}: Your Chalin 03 password was changed using ${method} on ${completedAt}. All previous sessions were signed out. Contact the original System Administrator immediately if this was not you.`,
      logMessage: `${businessName}: Password recovery completion notice sent to the registered user. No password or OTP was included.`,
      smsType: "password_recovery_confirmation",
      sentBy: null,
      sourceReference: `password-recovery-confirmation:${user.id}`,
    });
  }

  await sendOwnerSmsAlert({
    branchId,
    message: `${businessName}: Security notice. Account ${user.username} completed ${method} password recovery on ${completedAt}. Existing sessions were revoked.`,
    smsType: "password_recovery_admin_alert",
    sentBy: null,
    sourceReference: `password-recovery-admin:${user.id}`,
  });
}

async function recoverAccountWithOtp({
  req,
  username,
  otp,
  newPassword,
  confirmPassword,
}) {
  const cleanUsername = cleanText(username, 80);
  const cleanOtp = cleanText(otp, 12);

  if (
    !cleanUsername ||
    !cleanOtp ||
    !newPassword ||
    !confirmPassword
  ) {
    throw createServiceError(
      400,
      "RECOVERY_FIELDS_REQUIRED",
      "Username, verification code, new password and confirmation are required."
    );
  }

  if (!/^\d{6}$/.test(cleanOtp)) {
    throw createServiceError(
      400,
      "RECOVERY_CODE_INVALID",
      "The verification code is invalid or expired."
    );
  }

  const passwordPolicyError =
    strongPasswordError(newPassword);

  if (passwordPolicyError) {
    throw createServiceError(
      400,
      "PASSWORD_POLICY_FAILED",
      passwordPolicyError
    );
  }

  if (newPassword !== confirmPassword) {
    throw createServiceError(
      400,
      "PASSWORD_CONFIRMATION_FAILED",
      "New password and confirm password do not match."
    );
  }

  const connection = await pool.getConnection();
  let recoveredUser = null;

  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT
         id,
         full_name,
         username,
         password_hash,
         role,
         phone,
         default_branch_id,
         is_active,
         is_login_locked,
         token_version
       FROM users
       WHERE username = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanUsername]
    );

    const user = users[0] || null;

    if (
      !user ||
      !booleanValue(user.is_active) ||
      isOriginalSystemAdministrator(user)
    ) {
      throw createServiceError(
        400,
        "RECOVERY_CODE_INVALID",
        "The verification code is invalid or expired."
      );
    }

    const [otpRows] = await connection.query(
      `SELECT
         id,
         user_id,
         otp_hash,
         otp_salt,
         attempts_used,
         max_attempts,
         expires_at,
         consumed_at,
         invalidated_at
       FROM password_recovery_otps
       WHERE user_id = ?
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [user.id]
    );

    const otpRow = otpRows[0] || null;

    const expired =
      !otpRow ||
      !otpRow.expires_at ||
      new Date(otpRow.expires_at).getTime() <= Date.now();

    if (expired) {
      if (otpRow) {
        await connection.query(
          `UPDATE password_recovery_otps
           SET invalidated_at = NOW(),
               invalidation_reason = 'expired'
           WHERE id = ?`,
          [otpRow.id]
        );
      }

      throw createServiceError(
        400,
        "RECOVERY_CODE_INVALID",
        "The verification code is invalid or expired."
      );
    }

    const otpMatches = verifyOtp({
      userId: user.id,
      otp: cleanOtp,
      salt: otpRow.otp_salt,
      expectedHash: otpRow.otp_hash,
    });

    if (!otpMatches) {
      const nextAttempts =
        Number(otpRow.attempts_used || 0) + 1;

      const exhausted =
        nextAttempts >=
        Number(otpRow.max_attempts || OTP_MAX_ATTEMPTS);

      await connection.query(
        `UPDATE password_recovery_otps
         SET attempts_used = ?,
             invalidated_at =
               CASE WHEN ? = 1 THEN NOW() ELSE invalidated_at END,
             invalidation_reason =
               CASE
                 WHEN ? = 1
                 THEN 'maximum_attempts_reached'
                 ELSE invalidation_reason
               END
         WHERE id = ?`,
        [
          nextAttempts,
          exhausted ? 1 : 0,
          exhausted ? 1 : 0,
          otpRow.id,
        ]
      );

      await connection.commit();

      await writeRecoveryAudit({
        req,
        user,
        action: "PASSWORD_RECOVERY_OTP_FAILURE",
        actionType: "security.password_recovery.otp_failure",
        outcome: "failure",
        severity: exhausted ? "critical" : "warning",
        details:
          "An incorrect password recovery OTP was submitted.",
        metadata: {
          attempts_used: nextAttempts,
          maximum_attempts_reached: exhausted,
        },
      });

      throw createServiceError(
        400,
        "RECOVERY_CODE_INVALID",
        "The verification code is invalid or expired."
      );
    }

    const sameAsOldPassword = await bcrypt.compare(
      newPassword,
      user.password_hash
    );

    if (sameAsOldPassword) {
      throw createServiceError(
        400,
        "PASSWORD_REUSE_NOT_ALLOWED",
        "New password must be different from the previous password."
      );
    }

    const passwordHash = await bcrypt.hash(
      newPassword,
      10
    );

    await connection.query(
      `UPDATE users
       SET password_hash = ?,
           must_change_password = FALSE,
           password_changed_at = NOW(),
           token_version = token_version + 1,
           failed_login_attempts = 0,
           locked_until = NULL,
           is_login_locked = FALSE,
           login_locked_at = NULL,
           login_lock_reason = NULL,
           last_failed_login_at = NULL,
           last_failed_login_ip = NULL
       WHERE id = ?`,
      [
        passwordHash,
        user.id,
      ]
    );

    await connection.query(
      `UPDATE password_recovery_otps
       SET consumed_at = NOW(),
           attempts_used = attempts_used + 1
       WHERE id = ?`,
      [otpRow.id]
    );

    await connection.query(
      `UPDATE password_recovery_otps
       SET invalidated_at = NOW(),
           invalidation_reason = 'recovery_completed'
       WHERE user_id = ?
         AND id <> ?
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [
        user.id,
        otpRow.id,
      ]
    );

    await connection.commit();

    recoveredUser = user;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    connection.release();
  }

  await revokeAllUserSessions(
    recoveredUser.id,
    "password_recovered_by_otp"
  );

  try {
    await sendRecoveryCompletedAlerts(
      recoveredUser,
      "SMS OTP"
    );
  } catch (error) {
    console.warn(
      "Password recovery confirmation alerts were not completed:",
      error.message
    );
  }

  await writeRecoveryAudit({
    req,
    user: recoveredUser,
    action: "PASSWORD_RECOVERY_OTP_SUCCESS",
    actionType: "security.password_recovery.otp_success",
    outcome: "success",
    severity: "critical",
    details:
      "Password was changed through verified SMS OTP recovery. Existing sessions were revoked.",
  });

  return {
    user: recoveredUser,
    message:
      "Password changed successfully. All previous sessions were signed out. You may now login with the new password.",
  };
}

async function sendAdministratorResetAlerts(user) {
  const branchId = Number(user.default_branch_id || 1);
  const { businessName } =
    await buildOwnerAlertContext(branchId);

  const userPhone = normalizeGhanaPhone(user.phone);
  const resetAt = formatSecurityDateTime();

  if (userPhone) {
    await sendSmsAlertToPhone({
      branchId,
      phone: userPhone,
      message: `${businessName}: The original System Administrator reset your Chalin 03 account password on ${resetAt}. All sessions were signed out. Use the temporary password supplied securely and change it immediately. The password is not included in this SMS.`,
      logMessage: `${businessName}: Administrator password-reset confirmation sent to the registered user. No password was included.`,
      smsType: "administrator_password_reset",
      sentBy: null,
      sourceReference: `administrator-password-reset:${user.id}`,
    });
  }

  await sendOwnerSmsAlert({
    branchId,
    message: `${businessName}: Security notice. The original System Administrator reset account ${user.username} on ${resetAt}. Lock state was cleared and all sessions were revoked.`,
    smsType: "administrator_password_reset_alert",
    sentBy: null,
    sourceReference: `administrator-password-reset-admin:${user.id}`,
  });
}

async function resetAccountBySystemAdministrator({
  req,
  targetUserId,
  newPassword,
}) {
  const targetId = Number(targetUserId);

  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createServiceError(
      400,
      "INVALID_USER_ID",
      "Invalid user ID."
    );
  }

  const passwordPolicyError =
    strongPasswordError(newPassword);

  if (passwordPolicyError) {
    throw createServiceError(
      400,
      "PASSWORD_POLICY_FAILED",
      passwordPolicyError
    );
  }

  const connection = await pool.getConnection();
  let targetUser = null;

  try {
    await connection.beginTransaction();

    const [requesters] = await connection.query(
      `SELECT id, username, role
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [req.user.id]
    );

    const requester = requesters[0] || null;

    if (!isOriginalSystemAdministrator(requester)) {
      throw createServiceError(
        403,
        "SYSTEM_ADMIN_REQUIRED",
        "Only the original System Administrator can unlock or reset user accounts."
      );
    }

    const [targets] = await connection.query(
      `SELECT
         id,
         full_name,
         username,
         role,
         phone,
         default_branch_id,
         is_active,
         is_login_locked
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [targetId]
    );

    targetUser = targets[0] || null;

    if (!targetUser) {
      throw createServiceError(
        404,
        "USER_NOT_FOUND",
        "User account not found."
      );
    }

    if (isOriginalSystemAdministrator(targetUser)) {
      throw createServiceError(
        403,
        "BREAK_GLASS_REQUIRED",
        "The original System Administrator can only be recovered through the Owner Break-Glass process in Release 2B."
      );
    }

    const passwordHash = await bcrypt.hash(
      newPassword,
      10
    );

    await connection.query(
      `UPDATE users
       SET password_hash = ?,
           must_change_password = TRUE,
           password_changed_at = NULL,
           token_version = token_version + 1,
           failed_login_attempts = 0,
           locked_until = NULL,
           is_login_locked = FALSE,
           login_locked_at = NULL,
           login_lock_reason = NULL,
           last_failed_login_at = NULL,
           last_failed_login_ip = NULL
       WHERE id = ?`,
      [
        passwordHash,
        targetUser.id,
      ]
    );

    await connection.query(
      `UPDATE password_recovery_otps
       SET invalidated_at = NOW(),
           invalidation_reason = 'administrator_reset'
       WHERE user_id = ?
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [targetUser.id]
    );

    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    connection.release();
  }

  await revokeAllUserSessions(
    targetUser.id,
    "administrator_password_reset"
  );

  try {
    await sendAdministratorResetAlerts(targetUser);
  } catch (error) {
    console.warn(
      "Administrator reset SMS alerts were not completed:",
      error.message
    );
  }

  await writeAuditEvent({
    req,
    userId: req.user.id,
    branchId: targetUser.default_branch_id || null,
    action: "SYSTEM_ADMIN_ACCOUNT_RESET",
    actionType: "security.account.system_admin_reset",
    outcome: "success",
    severity: "critical",
    entityType: "user",
    entityId: targetUser.id,
    details:
      "Original System Administrator reset and unlocked an account. Existing sessions were revoked and immediate password change was required.",
    metadata: {
      target_username: targetUser.username,
      target_was_locked: booleanValue(
        targetUser.is_login_locked
      ),
      temporary_password_recorded: false,
    },
  });

  return {
    user: targetUser,
    message: `Account reset and unlocked successfully for ${
      targetUser.full_name || targetUser.username
    }. The user must change the temporary password immediately after login.`,
  };
}

module.exports = {
  GENERIC_RECOVERY_REQUEST_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  OTP_HOURLY_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  calculateFailedLoginState,
  generateOtp,
  hashOtp,
  isOriginalSystemAdministrator,
  maskPhone,
  recordFailedLoginAttempt,
  recoverAccountWithOtp,
  requestRecoveryOtp,
  resetAccountBySystemAdministrator,
  strongPasswordError,
  verifyOtp,
};