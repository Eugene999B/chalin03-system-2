-- READ-ONLY VERIFICATION: EQUIPMENT FINANCE PHASE 6 PERFORMANCE

SELECT migration_name
FROM schema_migrations
WHERE migration_name = '20260803_equipment_finance_phase6_performance';

SELECT TABLE_NAME,
       INDEX_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'equipment_credit_applications' AND INDEX_NAME IN (
      'idx_finance_perf_application_status',
      'idx_finance_perf_application_updated'
    ))
    OR (TABLE_NAME = 'equipment_sale_agreements' AND INDEX_NAME = 'idx_finance_perf_agreement_application')
    OR (TABLE_NAME = 'equipment_finance_case_tasks' AND INDEX_NAME IN (
      'idx_finance_perf_task_user_inbox',
      'idx_finance_perf_task_role_inbox'
    ))
    OR (TABLE_NAME = 'equipment_finance_private_documents' AND INDEX_NAME IN (
      'idx_finance_perf_document_review',
      'idx_finance_perf_document_approval'
    ))
    OR (TABLE_NAME = 'equipment_finance_payment_alerts' AND INDEX_NAME = 'idx_finance_perf_failed_alert')
  )
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

SELECT COUNT(*) AS misclassified_legacy_documents
FROM equipment_finance_private_documents private_document
INNER JOIN equipment_finance_case_documents legacy_document
    ON legacy_document.id = private_document.legacy_case_document_id
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
