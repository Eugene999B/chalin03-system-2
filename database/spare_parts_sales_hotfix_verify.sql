-- CHALIN 03 SPARE PARTS SALES HOTFIX VERIFICATION
-- READ ONLY
--
-- Run against the database already selected by the connection.

SELECT DATABASE() AS hotfix_verification_database;

SELECT
  'required_columns' AS check_name,
  SUM(COLUMN_NAME = 'amount_tendered') AS amount_tendered_present,
  SUM(COLUMN_NAME = 'change_due') AS change_due_present,
  SUM(COLUMN_NAME = 'edited_by') AS edited_by_present,
  SUM(COLUMN_NAME = 'edited_at') AS edited_at_present,
  SUM(COLUMN_NAME = 'edit_reason') AS edit_reason_present
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sales'
  AND COLUMN_NAME IN (
    'amount_tendered',
    'change_due',
    'edited_by',
    'edited_at',
    'edit_reason'
  );

SELECT
  'editor_foreign_key' AS check_name,
  COUNT(*) AS foreign_key_present
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sales'
  AND COLUMN_NAME = 'edited_by'
  AND REFERENCED_TABLE_NAME = 'users'
  AND REFERENCED_COLUMN_NAME = 'id';

SELECT
  'negative_payment_values' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE amount_tendered < 0
   OR amount_paid < 0
   OR change_due < 0
   OR balance < 0;

SELECT
  'immediate_payment_underpaid_sales' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE is_voided = 0
  AND sale_status = 'completed'
  AND payment_type IN ('cash', 'momo', 'bank')
  AND amount_tendered + 0.004 < total;

SELECT
  'immediate_payment_change_due_mismatch' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE is_voided = 0
  AND sale_status = 'completed'
  AND payment_type IN ('cash', 'momo', 'bank')
  AND ABS(change_due - GREATEST(amount_tendered - total, 0)) > 0.004;

SELECT
  'credit_mixed_change_due_mismatch' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE is_voided = 0
  AND sale_status = 'completed'
  AND payment_type IN ('credit', 'mixed')
  AND ABS(change_due) > 0.004;

SELECT
  'immediate_amount_paid_exceeds_total' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE is_voided = 0
  AND sale_status = 'completed'
  AND payment_type IN ('cash', 'momo', 'bank')
  AND amount_paid > total + 0.004;

SELECT
  'balance_mismatch' AS check_name,
  COUNT(*) AS problem_count
FROM sales
WHERE is_voided = 0
  AND sale_status = 'completed'
  AND ABS(balance - GREATEST(total - amount_paid, 0)) > 0.004;

SELECT
  'edited_sales_with_recorded_debt_payments' AS check_name,
  COUNT(DISTINCT s.id) AS problem_count
FROM sales s
INNER JOIN debts d
  ON d.sale_id = s.id
 AND d.branch_id = s.branch_id
INNER JOIN debt_payments dp
  ON dp.debt_id = d.id
 AND dp.branch_id = d.branch_id
WHERE s.edited_at IS NOT NULL;

SELECT
  'duplicate_product_rows_per_sale' AS check_name,
  COUNT(*) AS problem_count
FROM (
  SELECT sale_id, product_id
  FROM sale_items
  WHERE product_id IS NOT NULL
  GROUP BY sale_id, product_id
  HAVING COUNT(*) > 1
) duplicate_sale_products;

SELECT
  'duplicate_receipt_numbers' AS check_name,
  COUNT(*) AS problem_count
FROM (
  SELECT receipt_number
  FROM sales
  GROUP BY receipt_number
  HAVING COUNT(*) > 1
) duplicate_receipts;

SELECT
  'voided_sales_preserved' AS check_name,
  COUNT(*) AS voided_sale_count
FROM sales
WHERE is_voided = 1
   OR sale_status IN ('cancelled', 'voided');

SELECT
  'SPARE PARTS SALES HOTFIX VERIFY FINISHED' AS result,
  DATABASE() AS verified_database;
