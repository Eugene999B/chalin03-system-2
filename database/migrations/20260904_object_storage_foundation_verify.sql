-- READ-ONLY VERIFICATION: object storage foundation metadata.

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'equipment_media' AND COLUMN_NAME IN (
        'storage_provider', 'storage_bucket', 'storage_status'
    ))
    OR
    (TABLE_NAME = 'equipment_finance_private_documents' AND COLUMN_NAME IN (
        'storage_provider', 'storage_bucket', 'storage_key', 'storage_etag',
        'storage_status', 'stored_at'
    ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT migration_name, description, applied_at
FROM schema_migrations
WHERE migration_name = 'chalin03_object_storage_foundation';
