-- CHALIN 03 RELEASE 2A.1
-- One active server-side session per account.
-- ADDITIVE MIGRATION ONLY.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(64) NOT NULL,
    user_id INT NOT NULL,

    workspace_code VARCHAR(50) NULL,
    branch_id INT NULL,

    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(255) NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,

    revoked_at DATETIME NULL,
    revocation_reason VARCHAR(80) NULL,
    replaced_by_session_id CHAR(64) NULL,

    CONSTRAINT uq_auth_sessions_session_id UNIQUE (session_id),
    CONSTRAINT fk_auth_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    INDEX idx_auth_sessions_user_active (
        user_id,
        revoked_at,
        expires_at
    ),
    INDEX idx_auth_sessions_last_seen (last_seen_at),
    INDEX idx_auth_sessions_expires (expires_at)
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release2a1_one_active_session',
    'Adds auditable server-side sessions and one-active-session enforcement.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);