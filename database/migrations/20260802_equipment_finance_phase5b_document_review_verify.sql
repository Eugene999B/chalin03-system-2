SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase5b_document_review';

SELECT COUNT(*) AS missing_review_columns
FROM (
    SELECT 'equipment_finance_document_delivery_policy' AS table_name, 'required_document_categories_json' AS column_name
    UNION ALL SELECT 'equipment_finance_document_delivery_policy', 'independent_document_review_required'
    UNION ALL SELECT 'equipment_finance_document_delivery_policy', 'separate_document_approval_required'
    UNION ALL SELECT 'equipment_finance_private_documents', 'replacement_of_document_id'
    UNION ALL SELECT 'equipment_finance_private_documents', 'review_status'
    UNION ALL SELECT 'equipment_finance_private_documents', 'reviewed_by'
    UNION ALL SELECT 'equipment_finance_private_documents', 'reviewed_at'
    UNION ALL SELECT 'equipment_finance_private_documents', 'review_notes'
    UNION ALL SELECT 'equipment_finance_private_documents', 'approval_status'
    UNION ALL SELECT 'equipment_finance_private_documents', 'approved_by'
    UNION ALL SELECT 'equipment_finance_private_documents', 'approved_at'
    UNION ALL SELECT 'equipment_finance_private_documents', 'approval_notes'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS missing_history_table
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_document_review_history';

SELECT COUNT(*) AS invalid_review_policy
FROM equipment_finance_document_delivery_policy
WHERE id = 1
  AND (
      policy_version <> 'FIN-DOC-REVIEW-2'
      OR required_document_categories_json IS NULL
      OR independent_document_review_required <> 1
      OR separate_document_approval_required <> 1
  );

SELECT COUNT(*) AS invalid_document_decisions
FROM equipment_finance_private_documents
WHERE (review_status = 'verified' AND reviewed_by IS NULL)
   OR (approval_status = 'approved' AND approved_by IS NULL)
   OR (approval_status = 'approved' AND review_status <> 'verified')
   OR (reviewed_by IS NOT NULL AND reviewed_by = uploaded_by)
   OR (approved_by IS NOT NULL AND (approved_by = uploaded_by OR approved_by = reviewed_by));
