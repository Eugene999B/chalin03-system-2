const { pool } = require("../config/db");

const RESET_MIGRATION_NAME = "20260722_bank_biometric_device_reset_v1";
const GENERATION_KEY = "bank_biometric_generation";
let ensurePromise = null;

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function triggerExists(triggerName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME = ?`,
    [triggerName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function ensureColumn(tableName, columnName, definition) {
  if (!(await columnExists(tableName, columnName))) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  }
}

async function ensureIndex(tableName, indexName, definition) {
  if (!(await indexExists(tableName, indexName))) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`);
  }
}

async function ensureRegistry() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(150) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      description TEXT NULL,
      INDEX idx_schema_migration_name (migration_name),
      INDEX idx_schema_migration_applied_at (applied_at)
    )
  `);

  if (!(await columnExists("schema_migrations", "description"))) {
    await pool.query("ALTER TABLE schema_migrations ADD COLUMN description TEXT NULL");
  }
}

async function ensurePasswordRevocationTrigger() {
  const triggerName = "trg_user_password_change_revoke_biometrics";

  if (await triggerExists(triggerName)) return;

  await pool.query(`
    CREATE TRIGGER ${triggerName}
    AFTER UPDATE ON users
    FOR EACH ROW
    BEGIN
      IF NOT (NEW.password_hash <=> OLD.password_hash) THEN
        UPDATE user_passkeys
        SET revoked_at = COALESCE(revoked_at, NOW()),
            revoked_reason = COALESCE(revoked_reason, 'password_changed')
        WHERE user_id = NEW.id
          AND revoked_at IS NULL;
      END IF;
    END
  `);
}

async function applyOneTimeGlobalReset() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [markers] = await connection.query(
      `SELECT id
       FROM schema_migrations
       WHERE migration_name = ?
       LIMIT 1
       FOR UPDATE`,
      [RESET_MIGRATION_NAME]
    );

    if (markers.length > 0) {
      await connection.commit();
      return { applied: false, revokedDevices: 0 };
    }

    await connection.query(
      `INSERT INTO passkey_security_state (state_key, state_value)
       VALUES (?, 1)
       ON DUPLICATE KEY UPDATE state_value = state_value`,
      [GENERATION_KEY]
    );

    const [revoked] = await connection.query(
      `UPDATE user_passkeys
       SET revoked_at = COALESCE(revoked_at, NOW()),
           revoked_reason = COALESCE(revoked_reason, 'global_bank_biometric_reset')
       WHERE revoked_at IS NULL`
    );

    await connection.query(
      `UPDATE passkey_challenges
       SET used_at = COALESCE(used_at, NOW())
       WHERE used_at IS NULL`
    );

    await connection.query(
      `UPDATE passkey_security_state
       SET state_value = state_value + 1,
           updated_at = NOW()
       WHERE state_key = ?`,
      [GENERATION_KEY]
    );

    await connection.query(
      `INSERT INTO passkey_security_events
        (event_type, affected_count, details)
       VALUES ('global_device_reset', ?, ?)`,
      [
        Number(revoked.affectedRows || 0),
        "All previously registered device credentials were revoked before enabling the new account-bound fingerprint and face login flow.",
      ]
    );

    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)` ,
      [
        RESET_MIGRATION_NAME,
        "Revokes all earlier passkeys and starts the account-bound platform biometric generation.",
      ]
    );

    await connection.commit();
    console.log(
      `Bank biometric reset applied. Revoked ${Number(revoked.affectedRows || 0)} existing device credential(s).`
    );

    return {
      applied: true,
      revokedDevices: Number(revoked.affectedRows || 0),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function ensurePasskeySchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_passkeys (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        webauthn_user_id VARCHAR(128) NOT NULL,
        credential_id VARCHAR(512) NOT NULL,
        public_key LONGBLOB NOT NULL,
        counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
        device_type VARCHAR(32) NULL,
        backed_up TINYINT(1) NOT NULL DEFAULT 0,
        transports VARCHAR(255) NULL,
        display_name VARCHAR(120) NOT NULL DEFAULT 'Trusted device',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NULL DEFAULT NULL,
        revoked_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_user_passkeys_credential (credential_id(255)),
        KEY idx_user_passkeys_user (user_id, revoked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS passkey_challenges (
        id CHAR(36) NOT NULL,
        purpose VARCHAR(32) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        challenge VARCHAR(512) NOT NULL,
        context_json TEXT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_passkey_challenges_expiry (expires_at, used_at),
        KEY idx_passkey_challenges_user (user_id, purpose)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn("user_passkeys", "device_binding_hash", "CHAR(64) NULL");
    await ensureColumn("user_passkeys", "binding_generation", "INT NOT NULL DEFAULT 1");
    await ensureColumn("user_passkeys", "authenticator_attachment", "VARCHAR(32) NULL");
    await ensureColumn("user_passkeys", "revoked_reason", "VARCHAR(120) NULL");
    await ensureIndex(
      "user_passkeys",
      "uq_user_passkeys_binding_hash",
      "UNIQUE KEY `uq_user_passkeys_binding_hash` (`device_binding_hash`)"
    );
    await ensureIndex(
      "user_passkeys",
      "idx_user_passkeys_generation",
      "KEY `idx_user_passkeys_generation` (`binding_generation`, `revoked_at`)"
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS passkey_security_state (
        state_key VARCHAR(80) NOT NULL PRIMARY KEY,
        state_value BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS passkey_security_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        affected_count INT NOT NULL DEFAULT 0,
        user_id BIGINT UNSIGNED NULL,
        details TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_passkey_security_event_type (event_type, created_at),
        KEY idx_passkey_security_event_user (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureRegistry();
    await pool.query(
      `INSERT INTO passkey_security_state (state_key, state_value)
       VALUES (?, 1)
       ON DUPLICATE KEY UPDATE state_value = state_value`,
      [GENERATION_KEY]
    );
    await ensurePasswordRevocationTrigger();
    await applyOneTimeGlobalReset();
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });

  return ensurePromise;
}

async function getBiometricGeneration(connection = pool) {
  await ensurePasskeySchema();
  const [rows] = await connection.query(
    `SELECT state_value
     FROM passkey_security_state
     WHERE state_key = ?
     LIMIT 1`,
    [GENERATION_KEY]
  );
  return Math.max(1, Number(rows[0]?.state_value || 1));
}

async function revokeUserBiometrics(userId, reason = "user_security_reset") {
  await ensurePasskeySchema();
  const [result] = await pool.query(
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
  RESET_MIGRATION_NAME,
  ensurePasskeySchema,
  getBiometricGeneration,
  revokeUserBiometrics,
};
