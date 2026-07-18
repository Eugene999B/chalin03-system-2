-- CHALIN 03 RELEASE 3F-C3 READ-ONLY VERIFICATION
-- Every problem_count must be 0. Never changes data.

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    COUNT(*) AS migration_marker_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM schema_migrations
WHERE migration_name = 'release3fc3_mobile_id_expense_funding';

SELECT
    3 - COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'expenses'
  AND COLUMN_NAME IN (
      'funding_source',
      'affects_daily_closing',
      'closing_treatment_note'
  );

SELECT
    2 - COUNT(DISTINCT INDEX_NAME) AS problem_count,
    CASE WHEN COUNT(DISTINCT INDEX_NAME) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'expenses'
  AND INDEX_NAME IN (
      'idx_expense_closing_treatment',
      'idx_expense_funding_source'
  );

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM expenses
WHERE affects_daily_closing NOT IN (0, 1)
   OR funding_source IS NULL
   OR TRIM(funding_source) = '';

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM expenses
WHERE affects_daily_closing = 1
  AND funding_source <> 'today_sales_receipts';
