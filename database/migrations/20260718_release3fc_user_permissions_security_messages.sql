-- CHALIN 03 RELEASE 3F-C
-- Per-user permission overrides, protected Security Centre message dismissal,
-- and login password autofill hardening support.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- Existing users, roles, sessions, activity logs and business records are preserved.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL DEFAULT 'spare_parts',
    permission_code VARCHAR(120) NOT NULL,
    effect ENUM('allow','deny') NOT NULL,
    reason VARCHAR(500) NOT NULL,
    expires_at DATETIME NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    revoked_by INT NULL,
    revocation_reason VARCHAR(500) NULL,

    INDEX idx_permission_override_user_workspace (
        user_id,
        workspace_code,
        revoked_at,
        expires_at
    ),
    INDEX idx_permission_override_permission (
        permission_code,
        effect,
        revoked_at
    ),
    INDEX idx_permission_override_created_by (created_by, created_at),

    CONSTRAINT fk_permission_override_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_permission_override_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_permission_override_revoked_by
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS security_event_dismissals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    activity_log_id INT NOT NULL,
    dismissed_by INT NOT NULL,
    dismissal_reason VARCHAR(500) NOT NULL,
    dismissed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restored_by INT NULL,
    restored_at DATETIME NULL,
    restoration_reason VARCHAR(500) NULL,

    UNIQUE KEY uq_security_event_dismissal_activity (activity_log_id),
    INDEX idx_security_event_dismissal_active (restored_at, dismissed_at),
    INDEX idx_security_event_dismissal_user (dismissed_by, dismissed_at),

    CONSTRAINT fk_security_event_dismissal_activity
        FOREIGN KEY (activity_log_id) REFERENCES activity_log(id) ON DELETE CASCADE,
    CONSTRAINT fk_security_event_dismissal_user
        FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_security_event_restore_user
        FOREIGN KEY (restored_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release3fc_user_permissions_security_messages',
    'Adds auditable per-user permission allow/deny overrides and protected Security Centre message dismissal without deleting audit evidence.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
