-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 5 UNIFIED ENCRYPTED DOCUMENT AUTHORITY
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified SQL and Professional Backup before production execution.
-- Existing private documents, operational case documents, issued agreements,
-- delivery evidence and all audit history are preserved.

DELIMITER $$

DROP PROCEDURE IF EXISTS phase5_unified_add_column_if_missing $$
CREATE PROCEDURE phase5_unified_add_column_if_missing(
    IN p_table_name VARCHAR(128),
    IN p_column_name VARCHAR(128),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @phase5_unified_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE phase5_unified_statement FROM @phase5_unified_sql;
        EXECUTE phase5_unified_statement;
        DEALLOCATE PREPARE phase5_unified_statement;
    END IF;
END $$

DROP PROCEDURE IF EXISTS phase5_unified_add_index_if_missing $$
CREATE PROCEDURE phase5_unified_add_index_if_missing(
    IN p_table_name VARCHAR(128),
    IN p_index_name VARCHAR(128),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @phase5_unified_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE phase5_unified_statement FROM @phase5_unified_sql;
        EXECUTE phase5_unified_statement;
        DEALLOCATE PREPARE phase5_unified_statement;
    END IF;
END $$

DELIMITER ;

CALL phase5_unified_add_column_if_missing(
    'equipment_finance_private_documents',
    'asset_id',
    'INT NULL AFTER customer_id'
);
CALL phase5_unified_add_column_if_missing(
    'equipment_finance_private_documents',
    'document_stage',
    'ENUM(''application'',''agreement'') NOT NULL DEFAULT ''agreement'' AFTER asset_id'
);
CALL phase5_unified_add_column_if_missing(
    'equipment_finance_private_documents',
    'version_number',
    'INT UNSIGNED NOT NULL DEFAULT 1 AFTER replacement_of_document_id'
);
CALL phase5_unified_add_column_if_missing(
    'equipment_finance_private_documents',
    'legacy_case_document_id',
    'BIGINT NULL AFTER version_number'
);

CALL phase5_unified_add_index_if_missing(
    'equipment_finance_private_documents',
    'uq_finance_unified_legacy_document',
    'UNIQUE INDEX `uq_finance_unified_legacy_document` (`legacy_case_document_id`)'
);
CALL phase5_unified_add_index_if_missing(
    'equipment_finance_private_documents',
    'idx_finance_unified_application_documents',
    'INDEX `idx_finance_unified_application_documents` (`application_id`, `document_status`, `document_category`, `uploaded_at`)'
);
CALL phase5_unified_add_index_if_missing(
    'equipment_finance_private_documents',
    'idx_finance_unified_asset_documents',
    'INDEX `idx_finance_unified_asset_documents` (`asset_id`, `document_status`, `uploaded_at`)'
);
CALL phase5_unified_add_index_if_missing(
    'equipment_finance_private_documents',
    'idx_finance_unified_replacement',
    'INDEX `idx_finance_unified_replacement` (`replacement_of_document_id`, `version_number`)'
);

DROP PROCEDURE IF EXISTS phase5_unified_add_column_if_missing;
DROP PROCEDURE IF EXISTS phase5_unified_add_index_if_missing;

ALTER TABLE equipment_finance_private_documents
    MODIFY COLUMN agreement_id BIGINT NULL;

ALTER TABLE equipment_finance_document_review_history
    MODIFY COLUMN agreement_id BIGINT NULL;

UPDATE equipment_finance_private_documents document
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = document.agreement_id
SET document.asset_id = COALESCE(document.asset_id, agreement.asset_id),
    document.document_stage = 'agreement'
WHERE document.asset_id IS NULL
   OR document.document_stage <> 'agreement';

UPDATE equipment_finance_document_delivery_policy
SET allowed_mime_types_json =
        CASE
            WHEN JSON_CONTAINS(
                CAST(allowed_mime_types_json AS JSON),
                JSON_QUOTE('image/webp')
            ) THEN allowed_mime_types_json
            ELSE JSON_ARRAY_APPEND(
                CAST(allowed_mime_types_json AS JSON),
                '$',
                'image/webp'
            )
        END,
    maximum_file_size_bytes = GREATEST(maximum_file_size_bytes, 8388608),
    policy_version = 'FIN-UNIFIED-DOC-3'
WHERE id = 1;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260803_equipment_finance_phase5_unified_documents',
    'Unify application and agreement evidence in the encrypted Finance document authority while preserving and mapping legacy case documents.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

