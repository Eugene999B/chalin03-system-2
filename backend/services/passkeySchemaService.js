const { pool } = require("../config/db");

let ensurePromise = null;

async function ensurePasskeySchema() {
  if (ensurePromise) {
    return ensurePromise;
  }

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
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });

  return ensurePromise;
}

module.exports = {
  ensurePasskeySchema,
};
