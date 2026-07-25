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
      'voided_at',
      'void_approved_by',
      'void_approved_at',
      'is_reversal',
      'reversal_of_expense_id',
      'reversal_reference'
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
      'uq_expense_void_reference',
      'idx_expense_void_approval',
      'uq_expense_reversal_source',
      'uq_expense_reversal_reference'
  )
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY INDEX_NAME;

SELECT
    COUNT(*) AS invalid_void_rows
FROM expenses original
WHERE original.is_voided = 1
  AND (
      original.is_reversal <> 0
      OR original.void_reason IS NULL
      OR CHAR_LENGTH(TRIM(original.void_reason)) < 8
      OR original.void_reference IS NULL
      OR original.void_reference = ''
      OR original.voided_by IS NULL
      OR original.voided_at IS NULL
      OR original.void_approved_by IS NULL
      OR original.void_approved_at IS NULL
      OR original.voided_by = original.void_approved_by
      OR NOT EXISTS (
          SELECT 1
          FROM expenses reversal
          WHERE reversal.reversal_of_expense_id = original.id
            AND reversal.is_reversal = 1
            AND reversal.is_voided = 0
            AND reversal.reversal_reference = original.void_reference
            AND reversal.branch_id = original.branch_id
            AND reversal.expense_date = original.expense_date
            AND reversal.payment_method = original.payment_method
            AND reversal.funding_source = original.funding_source
            AND reversal.affects_daily_closing = original.affects_daily_closing
            AND ROUND(reversal.amount + original.amount, 2) = 0.00
      )
  );

SELECT
    COUNT(*) AS invalid_reversal_rows
FROM expenses reversal
LEFT JOIN expenses original
  ON original.id = reversal.reversal_of_expense_id
WHERE reversal.is_reversal = 1
  AND (
      reversal.is_voided <> 0
      OR reversal.amount >= 0
      OR reversal.reversal_of_expense_id IS NULL
      OR reversal.reversal_reference IS NULL
      OR reversal.reversal_reference = ''
      OR original.id IS NULL
      OR original.is_voided <> 1
      OR original.void_reference <> reversal.reversal_reference
      OR original.branch_id <> reversal.branch_id
      OR original.expense_date <> reversal.expense_date
      OR ROUND(original.amount + reversal.amount, 2) <> 0.00
  );
