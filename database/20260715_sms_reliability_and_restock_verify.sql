-- CHALIN 03 RELEASE 1 VERIFICATION
-- Run immediately after 20260715_sms_reliability_and_restock_migration.sql.
-- Every status row must show PASS and every problem_count must be 0.

SELECT
  'sms_log_status_enum' AS verification,
  CASE
    WHEN COLUMN_TYPE LIKE '%pending%'
     AND COLUMN_TYPE LIKE '%accepted%'
     AND COLUMN_TYPE LIKE '%delivered%'
     AND COLUMN_TYPE LIKE '%undelivered%'
     AND COLUMN_TYPE LIKE '%expired%'
     AND COLUMN_TYPE LIKE '%failed%'
     AND COLUMN_TYPE LIKE '%delivery_unknown%'
     AND COLUMN_TYPE NOT LIKE '%sent%'
    THEN 'PASS'
    ELSE 'PROBLEM'
  END AS status,
  COLUMN_TYPE AS detail
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND COLUMN_NAME = 'status';

SELECT
  'sms_reliability_columns' AS verification,
  CASE WHEN COUNT(*) = 14 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  14 AS expected_count,
  COUNT(*) AS actual_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND COLUMN_NAME IN (
    'provider','sender_id','provider_message_id','provider_status','status_reason',
    'segment_count','estimated_credits','retry_count','original_log_id',
    'source_reference','submitted_at','delivery_confirmed_at','last_status_at',
    'delivery_report_response'
  );

SELECT
  'stock_movement_columns' AS verification,
  CASE WHEN COUNT(*) = 8 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  8 AS expected_count,
  COUNT(*) AS actual_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_adjustments'
  AND COLUMN_NAME IN (
    'movement_type','source_name','reference_number','unit_cost',
    'cost_price_before','cost_price_after','movement_date','notes'
  );

SELECT
  'invalid_sms_status_rows' AS verification,
  COUNT(*) AS problem_count
FROM sms_log
WHERE status NOT IN (
  'pending','accepted','delivered','undelivered','expired','failed','delivery_unknown'
);

SELECT
  'missing_stock_movement_type_rows' AS verification,
  COUNT(*) AS problem_count
FROM stock_adjustments
WHERE movement_type IS NULL OR TRIM(movement_type) = '';

SELECT
  'sms_provider_reference_index' AS verification,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  COUNT(*) AS actual_count
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND INDEX_NAME = 'idx_sms_provider_message_id';

SELECT
  'stock_movement_type_index' AS verification,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  COUNT(*) AS actual_count
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_adjustments'
  AND INDEX_NAME = 'idx_stock_movement_type';

-- Informational summaries. These are not errors.
SELECT status, COUNT(*) AS sms_count
FROM sms_log
GROUP BY status
ORDER BY status;

SELECT movement_type, COUNT(*) AS movement_count
FROM stock_adjustments
GROUP BY movement_type
ORDER BY movement_type;
