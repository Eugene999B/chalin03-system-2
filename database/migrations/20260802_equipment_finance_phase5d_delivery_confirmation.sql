-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 5D DELIVERY CONFIRMATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- All Finance documents, approvals, authorizations, agreements, payments and deliveries are preserved.

DELIMITER $$

DROP PROCEDURE IF EXISTS phase5d_add_column_if_missing$$
CREATE PROCEDURE phase5d_add_column_if_missing(
    IN target_table VARCHAR(128),
    IN target_column VARCHAR(128),
    IN column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = target_table
           AND COLUMN_NAME = target_column
    ) THEN
        SET @phase5d_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(target_table, '`', '``'),
            '` ADD COLUMN `', REPLACE(target_column, '`', '``'), '` ',
            column_definition
        );
        PREPARE phase5d_statement FROM @phase5d_sql;
        EXECUTE phase5d_statement;
        DEALLOCATE PREPARE phase5d_statement;
    END IF;
END$$

DELIMITER ;

CALL phase5d_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'delivery_confirmation_policy_version',
    'VARCHAR(80) NOT NULL DEFAULT ''FIN-DELIVERY-CONFIRM-1'' AFTER delivery_authorization_valid_hours'
);
CALL phase5d_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'independent_delivery_confirmation_required',
    'TINYINT(1) NOT NULL DEFAULT 1 AFTER delivery_confirmation_policy_version'
);
CALL phase5d_add_column_if_missing(
    'equipment_finance_case_activity',
    'authorization_id',
    'BIGINT NULL AFTER document_id'
);
CALL phase5d_add_column_if_missing(
    'equipment_finance_case_activity',
    'delivery_id',
    'BIGINT NULL AFTER authorization_id'
);
CALL phase5d_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_delivery_completed_at',
    'DATETIME NULL AFTER delivered_at'
);
CALL phase5d_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_delivery_completed_by',
    'INT NULL AFTER controlled_delivery_completed_at'
);

DROP PROCEDURE IF EXISTS phase5d_add_column_if_missing;

CREATE TABLE IF NOT EXISTS equipment_finance_delivery_confirmations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    confirmation_number VARCHAR(120) NOT NULL UNIQUE,
    authorization_id BIGINT NOT NULL UNIQUE,
    delivery_id BIGINT NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    application_id BIGINT NOT NULL,
    asset_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    receiving_person VARCHAR(180) NOT NULL,
    receiving_phone VARCHAR(40) NULL,
    destination VARCHAR(255) NULL,
    condition_status VARCHAR(40) NOT NULL,
    meter_reading DECIMAL(14,2) NOT NULL,
    fuel_level_percent DECIMAL(7,2) NOT NULL,
    attachments_tools VARCHAR(3000) NULL,
    customer_signature_document_id BIGINT NULL,
    delivery_note_document_id BIGINT NULL,
    confirmation_snapshot_json LONGTEXT NOT NULL,
    confirmation_checksum CHAR(64) NOT NULL,
    notes VARCHAR(3000) NULL,
    confirmed_by INT NOT NULL,
    confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5d_confirmation_case (agreement_id, confirmed_at),
    INDEX idx_finance_phase5d_confirmation_asset (asset_id, confirmed_at),
    INDEX idx_finance_phase5d_confirmation_actor (confirmed_by, confirmed_at)
);

UPDATE equipment_finance_document_delivery_policy
   SET delivery_confirmation_policy_version = 'FIN-DELIVERY-CONFIRM-1',
       independent_delivery_confirmation_required = 1
 WHERE id = 1;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase5d_delivery_confirmation',
    'Atomic authorized Finance delivery, one-time authorization consumption and independent physical handover confirmation.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
