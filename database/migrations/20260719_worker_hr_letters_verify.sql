-- CHALIN 03 WORKER HR LETTERS VERIFICATION

SELECT
    TABLE_NAME,
    ENGINE,
    TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'worker_hr_letters';

SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'worker_hr_letters'
ORDER BY ORDINAL_POSITION;

SELECT
    COUNT(*) AS worker_id_type_mismatches
FROM information_schema.COLUMNS letter_column
INNER JOIN information_schema.COLUMNS worker_column
    ON worker_column.TABLE_SCHEMA = letter_column.TABLE_SCHEMA
   AND worker_column.TABLE_NAME = 'worker_profiles'
   AND worker_column.COLUMN_NAME = 'id'
WHERE letter_column.TABLE_SCHEMA = DATABASE()
  AND letter_column.TABLE_NAME = 'worker_hr_letters'
  AND letter_column.COLUMN_NAME = 'worker_id'
  AND letter_column.COLUMN_TYPE <> worker_column.COLUMN_TYPE;

SELECT
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'worker_hr_letters'
GROUP BY INDEX_NAME
ORDER BY INDEX_NAME;

SELECT
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'worker_hr_letters'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY CONSTRAINT_NAME;

SELECT
    COUNT(*) AS invalid_workspace_links
FROM worker_hr_letters letter_record
INNER JOIN worker_profiles worker
    ON worker.id = letter_record.worker_id
WHERE letter_record.workspace_code <> worker.workspace_code;

SELECT
    migration_name,
    applied_at,
    description
FROM schema_migrations
WHERE migration_name = '20260719_worker_hr_letters';
