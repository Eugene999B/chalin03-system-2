SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase5a_private_documents';

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'equipment_finance_document_delivery_policy',
    'equipment_finance_private_documents',
    'equipment_finance_case_activity'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS policy_rows
FROM equipment_finance_document_delivery_policy
WHERE id = 1
  AND policy_version = 'FIN-PRIVATE-DOC-1';

SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_private_documents'
  AND COLUMN_NAME IN (
    'content_checksum',
    'encrypted_payload',
    'encryption_iv',
    'encryption_tag',
    'encryption_version',
    'document_status',
    'uploaded_by',
    'uploaded_at'
  )
ORDER BY COLUMN_NAME;

SELECT COUNT(*) AS exposed_public_locations
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_private_documents'
  AND COLUMN_NAME IN ('file_url','public_url','storage_url','download_url');
