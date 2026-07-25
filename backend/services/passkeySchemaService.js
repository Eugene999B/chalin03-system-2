const { pool } = require("../config/db");

const RESET_MIGRATION_NAME = "20260722_bank_biometric_device_reset_v1";
const PASSWORD_REVOCATION_TRIGGER =
  "trg_user_password_change_revoke_biometrics";
const GENERATION_KEY = "bank_biometric_generation";

const RETIRED_MESSAGE =
  "Browser fingerprint, face and generic passkey login are retired. Password authentication remains authoritative.";

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function ensurePasskeySchema(connection = pool) {
  const historicalCredentialTableReady = await tableExists(
    connection,
    "user_passkeys"
  );

  return {
    ready: historicalCredentialTableReady,
    retired: true,
    runtime_mutation_disabled: true,
    historical_revocation_available: historicalCredentialTableReady,
    message: RETIRED_MESSAGE,
  };
}

async function getBiometricGeneration(connection = pool) {
  if (!(await tableExists(connection, "passkey_security_state"))) {
    return 1;
  }

  const [rows] = await connection.query(
    `SELECT state_value
     FROM passkey_security_state
     WHERE state_key = ?
     LIMIT 1`,
    [GENERATION_KEY]
  );

  return Math.max(1, Number(rows[0]?.state_value || 1));
}

async function revokeUserBiometrics(
  userId,
  reason = "user_security_reset"
) {
  const resolvedUserId = positiveId(userId);
  if (!resolvedUserId) return 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (!(await tableExists(connection, "user_passkeys"))) {
      await connection.commit();
      return 0;
    }

    const safeReason = String(reason || "user_security_reset")
      .trim()
      .slice(0, 120);

    const [result] = await connection.query(
      `UPDATE user_passkeys
       SET revoked_at = COALESCE(revoked_at, NOW()),
           revoked_reason = COALESCE(revoked_reason, ?)
       WHERE user_id = ?
         AND revoked_at IS NULL`,
      [safeReason || "user_security_reset", resolvedUserId]
    );

    if (await tableExists(connection, "passkey_challenges")) {
      await connection.query(
        `UPDATE passkey_challenges
         SET used_at = COALESCE(used_at, NOW())
         WHERE user_id = ?
           AND used_at IS NULL`,
        [resolvedUserId]
      );
    }

    if (await tableExists(connection, "passkey_security_events")) {
      await connection.query(
        `INSERT INTO passkey_security_events
          (event_type, affected_count, user_id, details)
         VALUES (?, ?, ?, ?)`,
        [
          "historical_credentials_revoked",
          Number(result.affectedRows || 0),
          resolvedUserId,
          `Historical browser credentials revoked after retirement. Reason: ${
            safeReason || "user_security_reset"
          }`,
        ]
      );
    }

    await connection.commit();
    return Number(result.affectedRows || 0);
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
}

module.exports = {
  GENERATION_KEY,
  PASSWORD_REVOCATION_TRIGGER,
  RESET_MIGRATION_NAME,
  RETIRED_MESSAGE,
  ensurePasskeySchema,
  getBiometricGeneration,
  revokeUserBiometrics,
  tableExists,
};
