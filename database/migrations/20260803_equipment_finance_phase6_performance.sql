-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 6 PERFORMANCE AND OPERATIONAL INBOX
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified SQL and Professional Backup before production execution.
-- Existing Finance, Hire, Mining, Spare Parts, application, agreement, payment,
-- document, task and audit records are preserved.

DELIMITER $$

DROP PROCEDURE IF EXISTS phase6_performance_add_index_if_missing $$
CREATE PROCEDURE phase6_performance_add_index_if_missing(
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
        SET @phase6_performance_sql = CONCAT(
            'ALTER ', 'TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD INDEX `', REPLACE(p_index_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE phase6_performance_statement FROM @phase6_performance_sql;
        EXECUTE phase6_performance_statement;
        DEALLOCATE PREPARE phase6_performance_statement;
    END IF;
END $$

DELIMITER ;

CALL phase6_performance_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_perf_application_status',
    '(`application_status`, `updated_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_perf_application_updated',
    '(`updated_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_finance_perf_agreement_application',
    '(`sale_type`, `credit_application_id`, `updated_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_finance_case_tasks',
    'idx_finance_perf_task_user_inbox',
    '(`task_status`, `assigned_to`, `priority`, `due_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_finance_case_tasks',
    'idx_finance_perf_task_role_inbox',
    '(`task_status`, `assigned_role`, `priority`, `due_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_finance_private_documents',
    'idx_finance_perf_document_review',
    '(`document_status`, `review_status`, `uploaded_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_finance_private_documents',
    'idx_finance_perf_document_approval',
    '(`document_status`, `approval_status`, `uploaded_at`, `id`)'
);
CALL phase6_performance_add_index_if_missing(
    'equipment_finance_payment_alerts',
    'idx_finance_perf_failed_alert',
    '(`alert_status`, `updated_at`, `id`)'
);

DROP PROCEDURE IF EXISTS phase6_performance_add_index_if_missing;

UPDATE equipment_finance_private_documents private_document
INNER JOIN equipment_finance_case_documents legacy_document
    ON legacy_document.id = private_document.legacy_case_document_id
SET private_document.document_category = CASE legacy_document.document_category
    WHEN 'buyer_id_front' THEN 'kyc_identity'
    WHEN 'buyer_id_back' THEN 'kyc_identity'
    WHEN 'buyer_photo' THEN 'kyc_identity'
    WHEN 'proof_of_address' THEN 'kyc_address'
    WHEN 'income_evidence' THEN 'kyc_income'
    WHEN 'guarantor_id' THEN 'guarantor_identity'
    WHEN 'signed_agreement' THEN 'agreement_attachment'
    ELSE private_document.document_category
END
WHERE legacy_document.document_category IN (
    'buyer_id_front',
    'buyer_id_back',
    'buyer_photo',
    'proof_of_address',
    'income_evidence',
    'guarantor_id',
    'signed_agreement'
)
AND private_document.document_category <> CASE legacy_document.document_category
    WHEN 'buyer_id_front' THEN 'kyc_identity'
    WHEN 'buyer_id_back' THEN 'kyc_identity'
    WHEN 'buyer_photo' THEN 'kyc_identity'
    WHEN 'proof_of_address' THEN 'kyc_address'
    WHEN 'income_evidence' THEN 'kyc_income'
    WHEN 'guarantor_id' THEN 'guarantor_identity'
    WHEN 'signed_agreement' THEN 'agreement_attachment'
    ELSE private_document.document_category
END;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260803_equipment_finance_phase6_performance',
    'Bounded Finance application, case, document-review, task and failed-alert queries plus forward repair of encrypted legacy-document categories.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
