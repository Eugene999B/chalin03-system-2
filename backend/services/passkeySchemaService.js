const { pool } = require("../config/db");

const RESET_MIGRATION_NAME = "20260722_bank_biometric_device_reset_v1";
const GENERATION_KEY = "bank_biometric_generation";
const PASSWORD_REVOCATION_TRIGGER = "trg_user_password_change_revoke_biometrics";
const REQUIRED_TABLE_COLUMNS = Object.freeze({
  user_passkeys: [
    "id",
    "user_id",
    "webauthn_user_id",
    "credential_id",
    "public_key",
    "counter",
    "device_type",
    "backed_up",
    "transports",
    "display_name",
    "created_at",
    "last_used_at",
    "revoked_at",
    "device_binding_hash",
    "binding_generation",
    "authenticator_attachment",
    "revoked_reason",
  ],
  passkey_challenges: [
    "id",
    "purpose",
    "user_id",
    "challenge",
    "context_json",
    "expires_at",
    "used_at",
    "created_at",
  ],
  passkey_security_state: ["state_key", "state_value", "updated_at"],
  passkey_security_events: [
    "id",
    "event_type",
    "affected_count",
    "user_id",
    "details",
    "created_at",
  ],
});

let ensurePromise = null;

function schemaError(message, metadata = {}) {
  const error = new Error(message);
  error.code = "BIOMETRIC_SCHEMA_NOT_READY";
  error.statusCode = 503;
  Object.assign(error, metadata);
  return error;
}

async function ensurePasskeySchema(connection = pool) {
  if (connection === pool && ensurePromise) return ensurePromise;

  const verify = async () => {
    const tableNames = Object.keys(REQUIRED_TABLE_COLUMNS);
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = tableNames.filter(
      (tableName) => !existingTables.has(tableName)
    );

    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const columnsByTable = new Map(
      tableNames.map((tableName) => [tableName, new Set()])
    );
    for (const row of columnRows) {
      columnsByTable.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
    }

    const missingColumns = [];
    for (const [tableName, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
      if (!existingTables.has(tableName)) continue;
      for (const columnName of columns) {
        if (!columnsByTable.get(tableName)?.has(columnName)) {
          missingColumns.push(`${tableName}.${columnName}`);
        }
      }
    }

    const [triggerRows] = await connection.query(
      `SELECT TRIGGER_NAME
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE()
         AND TRIGGER_NAME = ?`,
      [PASSWORD_REVOCATION_TRIGGER]
    );
    const missingTriggers = triggerRows.length
      ? []
      : [PASSWORD_REVOCATION_TRIGGER];

    let generationReady = false;
    if (existingTables.has("passkey_security_state")) {
      const [generationRows] = await connection.query(
        `SELECT state_value
         FROM passkey_security_state
         WHERE state_key = ?
         LIMIT 1`,
        [GENERATION_KEY]
      );
      generationReady =
        generationRows.length === 1 &&
        Number(generationRows[0]?.state_value || 0) >= 1;
    }

    if (
      missingTables.length ||
      missingColumns.length ||
      missingTriggers.length ||
      !generationReady
    ) {
      throw schemaError(
        "The approved fingerprint and face migration is incomplete. Apply it through the controlled migration process before startup.",
        {
          migrationName: RESET_MIGRATION_NAME,
          missingTables,
          missingColumns,
          missingTriggers,
          generationReady,
        }
      );
    }

    return {
      ready: true,
      migration_name: RESET_MIGRATION_NAME,
      generation_key: GENERATION_KEY,
      missing_tables: [],
      missing_columns: [],
      missing_triggers: [],
    };
  };

  if (connection !== pool) return verify();
  ensurePromise = verify().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

async function getBiometricGeneration(connection = pool) {
  await ensurePasskeySchema(connection);
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
  reason = "user_security_reset",
  connection = pool
) {
  await ensurePasskeySchema(connection);
  const [result] = await connection.query(
    `UPDATE user_passkeys
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revoked_reason = COALESCE(revoked_reason, ?)
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [String(reason || "user_security_reset").slice(0, 120), userId]
  );
  return Number(result.affectedRows || 0);
}

module.exports = {
  GENERATION_KEY,
  PASSWORD_REVOCATION_TRIGGER,
  REQUIRED_TABLE_COLUMNS,
  RESET_MIGRATION_NAME,
  ensurePasskeySchema,
  getBiometricGeneration,
  revokeUserBiometrics,
};
