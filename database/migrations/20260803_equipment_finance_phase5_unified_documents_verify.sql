-- READ-ONLY VERIFICATION: PHASE 5 UNIFIED ENCRYPTED DOCUMENT AUTHORITY

SELECT migration_name
FROM schema_migrations
WHERE migration_name = '20260803_equipment_finance_phase5_unified_documents';

SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_private_documents'
  AND COLUMN_NAME IN (
      'asset_id',
      'document_stage',
      'version_number',
      'legacy_case_document_id'
  )
ORDER BY COLUMN_NAME;

SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
      (TABLE_NAME = 'equipment_finance_private_documents'
       AND COLUMN_NAME = 'agreement_id')
      OR
      (TABLE_NAME = 'equipment_finance_document_review_history'
       AND COLUMN_NAME = 'agreement_id')
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS unmapped_legacy_documents
FROM equipment_finance_case_documents legacy_document
LEFT JOIN equipment_finance_private_documents private_document
  ON private_document.legacy_case_document_id = legacy_document.id
WHERE private_document.id IS NULL;

SELECT COUNT(*) AS invalid_unified_document_links
FROM equipment_finance_private_documents document
WHERE document.application_id IS NULL
   OR document.asset_id IS NULL
   OR NOT EXISTS (
       SELECT 1
       FROM equipment_credit_applications application
       WHERE application.id = document.application_id
         AND application.asset_id = document.asset_id
   )
   OR (
       document.agreement_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM equipment_sale_agreements agreement
           WHERE agreement.id = document.agreement_id
             AND agreement.credit_application_id = document.application_id
             AND agreement.asset_id = document.asset_id
       )
   )
   OR (
       document.document_stage = 'application'
       AND document.agreement_id IS NOT NULL
   );


