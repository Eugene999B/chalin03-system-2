-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 5B DOCUMENT REVIEW AND APPROVAL
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Phase 5A encrypted payloads and all existing Finance records are preserved.

DELIMITER $$

DROP PROCEDURE IF EXISTS phase5b_add_column_if_missing$$
CREATE PROCEDURE phase5b_add_column_if_missing(
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
        SET @phase5b_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(target_table, '`', '``'),
            '` ADD COLUMN `', REPLACE(target_column, '`', '``'), '` ',
            column_definition
        );
        PREPARE phase5b_statement FROM @phase5b_sql;
        EXECUTE phase5b_statement;
        DEALLOCATE PREPARE phase5b_statement;
    END IF;
END$$

DELIMITER ;

CALL phase5b_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'required_document_categories_json',
    'LONGTEXT NULL AFTER allowed_document_categories_json'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'independent_document_review_required',
    'TINYINT(1) NOT NULL DEFAULT 1 AFTER maximum_file_size_bytes'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_document_delivery_policy',
    'separate_document_approval_required',
    'TINYINT(1) NOT NULL DEFAULT 1 AFTER independent_document_review_required'
);

CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'replacement_of_document_id',
    'BIGINT NULL AFTER customer_id'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'review_status',
    'ENUM(''pending'',''verified'',''rejected'') NOT NULL DEFAULT ''pending'' AFTER document_status'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'reviewed_by',
    'INT NULL AFTER review_status'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'reviewed_at',
    'DATETIME NULL AFTER reviewed_by'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'review_notes',
    'VARCHAR(1500) NULL AFTER reviewed_at'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'approval_status',
    'ENUM(''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''pending'' AFTER review_notes'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'approved_by',
    'INT NULL AFTER approval_status'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'approved_at',
    'DATETIME NULL AFTER approved_by'
);
CALL phase5b_add_column_if_missing(
    'equipment_finance_private_documents',
    'approval_notes',
    'VARCHAR(1500) NULL AFTER approved_at'
);

DROP PROCEDURE IF EXISTS phase5b_add_column_if_missing;

CREATE TABLE IF NOT EXISTS equipment_finance_document_review_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT NOT NULL,
    agreement_id BIGINT NOT NULL,
    application_id BIGINT NULL,
    decision_stage ENUM('review','approval','archive') NOT NULL,
    decision_value VARCHAR(40) NOT NULL,
    decision_notes VARCHAR(1500) NOT NULL,
    decided_by INT NULL,
    decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    document_checksum CHAR(64) NOT NULL,
    policy_version VARCHAR(80) NOT NULL,
    INDEX idx_finance_phase5b_history_document (document_id, decided_at),
    INDEX idx_finance_phase5b_history_case (agreement_id, decided_at),
    INDEX idx_finance_phase5b_history_actor (decided_by, decided_at)
);

UPDATE equipment_finance_document_delivery_policy
   SET policy_version = 'FIN-DOC-REVIEW-2',
       required_document_categories_json = COALESCE(
           required_document_categories_json,
           '["kyc_identity","guarantor_identity","agreement_attachment"]'
       ),
       independent_document_review_required = 1,
       separate_document_approval_required = 1
 WHERE id = 1;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase5b_document_review',
    'Independent encrypted-document review, separate approval, archival evidence and required-document readiness.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
