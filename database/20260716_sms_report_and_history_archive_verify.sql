-- CHALIN 03 RELEASE 1.2 VERIFICATION
-- Run after 20260716_sms_report_and_history_archive_migration.sql.

SELECT
  'sms_history_archive_columns' AS verification,
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  3 AS expected_count,
  COUNT(*) AS actual_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND COLUMN_NAME IN ('archived_at', 'archived_by', 'archive_reason');

SELECT
  'sms_history_archive_index' AS verification,
  CASE WHEN COUNT(*) >= 1 THEN 'PASS' ELSE 'PROBLEM' END AS status,
  COUNT(*) AS actual_count
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND INDEX_NAME = 'idx_sms_branch_archived';

SELECT
  'invalid_archived_sms_rows' AS verification,
  COUNT(*) AS problem_count
FROM sms_log
WHERE archived_at IS NULL
  AND (archived_by IS NOT NULL OR archive_reason IS NOT NULL);

SELECT
  COUNT(*) AS total_sms_rows,
  SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active_sms_rows,
  SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived_sms_rows
FROM sms_log;
