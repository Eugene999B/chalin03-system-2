-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 5C DELIVERY AUTHORIZATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Phase 5A encrypted documents, Phase 5B decisions and all Finance records are preserved.

DELIMITER $$

DROP PROCEDURE IF EXISTS phase5c_add_column_if_missing$$
CREATE PROCEDURE phase5c_add_column_if_missing(
    IN target_table VARCHAR(128),
    IN target_column VARCHAR(128),
    IN column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = target_table
           AND COLUMN_NAME = target_column
    ) THEN
        SET @phase5c_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(target_table, '`', '``'),
            '` ADD COLUMN `', REPLACE(target_column, '`', '``'), '` ',
            column_definition
        );
        PREPARE phase5c_statement FROM @phase5c_sql;
        EXECUTE phase5c_statement;
        DEALLOCATE PREPARE phase5c_statement;
    END IF;
END$$

DELIMITER ;

CALL phase5c_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'delivery_authorization_policy_version',
    'VARCHAR(80) NOT NULL DEFAULT ''FIN-DELIVERY-AUTH-1'' AFTER separate_document_approval_required'
);
CALL phase5c_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'independent_delivery_authorization_required',
    'TINYINT(1) NOT NULL DEFAULT 1 AFTER delivery_authorization_policy_version'
);
CALL phase5c_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'delivery_authorization_valid_hours',
    'INT UNSIGNED NOT NULL DEFAULT 48 AFTER independent_delivery_authorization_required'
);

DROP PROCEDURE IF EXISTS phase5c_add_column_if_missing;

CREATE TABLE IF NOT EXISTS equipment_finance_delivery_authorizations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    authorization_number VARCHAR(120) NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    application_id BIGINT NOT NULL,
    asset_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    authorization_status ENUM(
        'pending',
        'authorized',
        'rejected',
        'revoked',
        'expired',
        'consumed'
    ) NOT NULL DEFAULT 'pending',
    policy_version VARCHAR(80) NOT NULL,
    document_snapshot_json LONGTEXT NOT NULL,
    financial_snapshot_json LONGTEXT NOT NULL,
    snapshot_checksum CHAR(64) NOT NULL,
    request_reason VARCHAR(1500) NOT NULL,
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    decision_reason VARCHAR(1500) NULL,
    expires_at DATETIME NULL,
    revoked_by INT NULL,
    revoked_at DATETIME NULL,
    revocation_reason VARCHAR(1500) NULL,
    consumed_by INT NULL,
    consumed_at DATETIME NULL,
    delivery_id BIGINT NULL,
    INDEX idx_finance_phase5c_authorization_case (agreement_id, authorization_status, requested_at),
    INDEX idx_finance_phase5c_authorization_asset (asset_id, authorization_status, requested_at),
    INDEX idx_finance_phase5c_authorization_customer (customer_id, requested_at),
    INDEX idx_finance_phase5c_authorization_requester (requested_by, requested_at),
    INDEX idx_finance_phase5c_authorization_decider (decided_by, decided_at),
    INDEX idx_finance_phase5c_authorization_expiry (authorization_status, expires_at)
);

UPDATE equipment_finance_document_delivery_policy
   SET delivery_authorization_policy_version = 'FIN-DELIVERY-AUTH-1',
       independent_delivery_authorization_required = 1,
       delivery_authorization_valid_hours = CASE
           WHEN delivery_authorization_valid_hours BETWEEN 1 AND 168
             THEN delivery_authorization_valid_hours
           ELSE 48
       END
 WHERE id = 1;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase5c_delivery_authorization',
    'Independent, expiring Equipment Finance delivery authorization with approved-document and financial snapshots.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
