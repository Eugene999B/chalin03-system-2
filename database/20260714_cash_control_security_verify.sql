-- CHALIN 03 CASH CONTROL SECURITY VERIFICATION
-- Read-only checks. Every problem count at the end must be zero.
SELECT DATABASE() AS verification_database;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'sale_payment_allocations',
    'sale_change_history',
    'daily_closing_revisions'
  )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'expenses' AND COLUMN_NAME = 'payment_method')
    OR
    (TABLE_NAME = 'returns' AND COLUMN_NAME IN (
      'return_type','refund_amount','refund_method','refund_reference','approved_by','approved_at'
    ))
    OR
    (TABLE_NAME = 'daily_closings' AND COLUMN_NAME IN (
      'opening_cash_float','cash_deposits','cash_withdrawals','other_cash_in','other_cash_out',
      'denomination_total','denomination_json','counted_confirmed','stale_after_close',
      'stale_detected_at','latest_revision_number','verified_by','verified_at','verification_status'
    ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT
  CONSTRAINT_NAME,
  TABLE_NAME,
  CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN ('fk_daily_closing_verified_by', 'fk_return_approved_by')
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

SELECT
  (SELECT COUNT(*) FROM sales WHERE COALESCE(amount_paid, 0) > 0) AS paid_sales,
  (SELECT COUNT(DISTINCT sale_id) FROM sale_payment_allocations) AS sales_with_payment_allocations,
  (SELECT COUNT(*) FROM daily_closings) AS daily_closings,
  (SELECT COUNT(*) FROM daily_closing_revisions WHERE revision_number = 1) AS original_closing_revisions;

SELECT
  'paid_sales_missing_allocation' AS check_name,
  COUNT(*) AS problem_count
FROM sales s
LEFT JOIN sale_payment_allocations spa ON spa.sale_id = s.id
WHERE COALESCE(s.amount_paid, 0) > 0
  AND spa.id IS NULL
UNION ALL
SELECT
  'sale_allocation_total_mismatch',
  COUNT(*)
FROM sales s
LEFT JOIN (
  SELECT sale_id, SUM(amount) AS allocated_total
  FROM sale_payment_allocations
  GROUP BY sale_id
) allocations ON allocations.sale_id = s.id
WHERE COALESCE(s.amount_paid, 0) > 0
  AND ABS(COALESCE(allocations.allocated_total, 0) - LEAST(GREATEST(COALESCE(s.amount_paid, 0), 0), GREATEST(COALESCE(s.total, 0), 0))) >= 0.01
UNION ALL
SELECT
  'closing_missing_original_revision',
  COUNT(*)
FROM daily_closings dc
LEFT JOIN daily_closing_revisions dcr
  ON dcr.daily_closing_id = dc.id AND dcr.revision_number = 1
WHERE dcr.id IS NULL
UNION ALL
SELECT
  'invalid_revision_number',
  COUNT(*)
FROM daily_closing_revisions
WHERE revision_number < 1
UNION ALL
SELECT
  'negative_payment_allocation',
  COUNT(*)
FROM sale_payment_allocations
WHERE amount < 0
UNION ALL
SELECT
  'invalid_return_refund',
  COUNT(*)
FROM returns
WHERE refund_amount < 0
   OR (return_type = 'refund' AND (refund_amount <= 0 OR refund_method = 'none'))
   OR (return_type <> 'refund' AND refund_amount <> 0);

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260714_cash_control_security_migration';
