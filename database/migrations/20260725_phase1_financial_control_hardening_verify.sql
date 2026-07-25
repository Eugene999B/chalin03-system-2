-- Read-only verification for 20260725_phase1_financial_control_hardening.sql

SELECT
    migration_name,
    description,
    applied_at
FROM schema_migrations
WHERE migration_name = '20260725_phase1_financial_control_hardening';

SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'expenses'
  AND COLUMN_NAME IN (
      'is_voided',
      'void_reason',
      'void_reference',
      'voided_by',
      'voided_at'
  )
ORDER BY ORDINAL_POSITION;

SELECT
    INDEX_NAME,
    NON_UNIQUE,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'expenses'
  AND INDEX_NAME IN (
      'idx_expense_void_status',
      'uq_expense_void_reference'
  )
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY INDEX_NAME;

SELECT
    COUNT(*) AS invalid_void_rows
FROM expenses
WHERE is_voided = 1
  AND (
      void_reason IS NULL
      OR void_reason = ''
      OR void_reference IS NULL
      OR void_reference = ''
      OR voided_by IS NULL
      OR voided_at IS NULL
  );
