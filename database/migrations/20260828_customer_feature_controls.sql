-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS customer_feature_controls (
    branch_id INT NOT NULL PRIMARY KEY,
    customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
    customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO customer_feature_controls (branch_id, customer_identity_editing_enabled, customer_merge_enabled)
SELECT id, 1, 1
FROM branches
ON DUPLICATE KEY UPDATE
    branch_id = VALUES(branch_id);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'customer_feature_controls',
    'Adds additive per-branch customer identity editing and customer merge controls.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
