-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- Adds governed public redirect rules. No live route is changed by this migration alone.

CREATE TABLE IF NOT EXISTS public_redirect_rules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_path VARCHAR(500) NOT NULL,
    destination_url VARCHAR(1000) NOT NULL,
    redirect_status SMALLINT UNSIGNED NOT NULL DEFAULT 301,
    rule_status ENUM('draft','active','inactive','archived') NOT NULL DEFAULT 'draft',
    activate_at DATETIME NULL,
    expires_at DATETIME NULL,
    reason VARCHAR(500) NULL,
    created_by INT NULL,
    updated_by INT NULL,
    activated_by INT NULL,
    activated_at DATETIME NULL,
    deactivated_by INT NULL,
    deactivated_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_public_redirect_source_path (source_path),
    KEY idx_public_redirect_status_window (rule_status, activate_at, expires_at),
    KEY idx_public_redirect_destination (destination_url(191)),
    CONSTRAINT fk_public_redirect_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_public_redirect_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_public_redirect_activated_by FOREIGN KEY (activated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_public_redirect_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_public_redirect_status_code CHECK (redirect_status IN (301,302,307,308))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260809_chalin_one_public_redirects',
    'Add governed CHALIN ONE public redirect rules with draft/activation lifecycle and audit ownership'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
