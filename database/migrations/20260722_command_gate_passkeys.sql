-- CHALIN 03 COMMAND GATE PASSKEY SECURITY
-- ADDITIVE MIGRATION ONLY.
-- Existing business records are preserved.
-- BACKUP REQUIRED: verify the latest Railway/MySQL database backup and Chalin 03 full-system backup before production execution.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260722_command_gate_passkeys',
    'Add compact WebAuthn passkey credentials and one-time authentication challenges.'
WHERE NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE migration_name = '20260722_command_gate_passkeys'
);
