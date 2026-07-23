-- CHALIN 03 RELEASE 3.1 AUDIT-SCHEMA SAFETY VERIFICATION
-- READ-ONLY VERIFICATION ONLY.

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(required.table_name ORDER BY required.table_name SEPARATOR ', ') AS missing_tables
FROM (
  SELECT 'audit_signoffs' AS table_name
  UNION ALL SELECT 'audit_unlock_requests'
  UNION ALL SELECT 'audit_reapproval_log'
) required
LEFT JOIN information_schema.TABLES current_table
  ON current_table.TABLE_SCHEMA = DATABASE()
 AND current_table.TABLE_TYPE = 'BASE TABLE'
 AND current_table.TABLE_NAME = required.table_name
WHERE current_table.TABLE_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(
    CONCAT(required.table_name, '.', required.column_name)
    ORDER BY required.table_name, required.column_name
    SEPARATOR ', '
  ) AS missing_columns
FROM (
  SELECT 'audit_signoffs' AS table_name, 'id' AS column_name
  UNION ALL SELECT 'audit_signoffs', 'branch_id'
  UNION ALL SELECT 'audit_signoffs', 'period_type'
  UNION ALL SELECT 'audit_signoffs', 'period_label'
  UNION ALL SELECT 'audit_signoffs', 'period_start'
  UNION ALL SELECT 'audit_signoffs', 'period_end'
  UNION ALL SELECT 'audit_signoffs', 'audit_score'
  UNION ALL SELECT 'audit_signoffs', 'audit_status'
  UNION ALL SELECT 'audit_signoffs', 'prepared_by_name'
  UNION ALL SELECT 'audit_signoffs', 'reviewed_by_name'
  UNION ALL SELECT 'audit_signoffs', 'approved_by_name'
  UNION ALL SELECT 'audit_signoffs', 'review_date'
  UNION ALL SELECT 'audit_signoffs', 'period_status'
  UNION ALL SELECT 'audit_signoffs', 'sales_checked'
  UNION ALL SELECT 'audit_signoffs', 'expenses_checked'
  UNION ALL SELECT 'audit_signoffs', 'debts_checked'
  UNION ALL SELECT 'audit_signoffs', 'stock_checked'
  UNION ALL SELECT 'audit_signoffs', 'warnings_checked'
  UNION ALL SELECT 'audit_signoffs', 'reports_checked'
  UNION ALL SELECT 'audit_signoffs', 'purchases_checked'
  UNION ALL SELECT 'audit_signoffs', 'returns_checked'
  UNION ALL SELECT 'audit_signoffs', 'transfers_checked'
  UNION ALL SELECT 'audit_signoffs', 'sms_checked'
  UNION ALL SELECT 'audit_signoffs', 'stock_ledger_checked'
  UNION ALL SELECT 'audit_signoffs', 'backup_checked'
  UNION ALL SELECT 'audit_signoffs', 'maintenance_checked'
  UNION ALL SELECT 'audit_signoffs', 'accountant_notes'
  UNION ALL SELECT 'audit_signoffs', 'management_notes'
  UNION ALL SELECT 'audit_signoffs', 'created_by'
  UNION ALL SELECT 'audit_signoffs', 'approved_by'
  UNION ALL SELECT 'audit_signoffs', 'created_at'
  UNION ALL SELECT 'audit_signoffs', 'updated_at'
  UNION ALL SELECT 'audit_unlock_requests', 'id'
  UNION ALL SELECT 'audit_unlock_requests', 'branch_id'
  UNION ALL SELECT 'audit_unlock_requests', 'audit_signoff_id'
  UNION ALL SELECT 'audit_unlock_requests', 'period_label'
  UNION ALL SELECT 'audit_unlock_requests', 'period_start'
  UNION ALL SELECT 'audit_unlock_requests', 'period_end'
  UNION ALL SELECT 'audit_unlock_requests', 'request_area'
  UNION ALL SELECT 'audit_unlock_requests', 'requested_action'
  UNION ALL SELECT 'audit_unlock_requests', 'reason'
  UNION ALL SELECT 'audit_unlock_requests', 'status'
  UNION ALL SELECT 'audit_unlock_requests', 'requested_by'
  UNION ALL SELECT 'audit_unlock_requests', 'reviewed_by'
  UNION ALL SELECT 'audit_unlock_requests', 'reviewed_at'
  UNION ALL SELECT 'audit_unlock_requests', 'review_notes'
  UNION ALL SELECT 'audit_unlock_requests', 'created_at'
  UNION ALL SELECT 'audit_unlock_requests', 'updated_at'
  UNION ALL SELECT 'audit_reapproval_log', 'id'
  UNION ALL SELECT 'audit_reapproval_log', 'branch_id'
  UNION ALL SELECT 'audit_reapproval_log', 'audit_signoff_id'
  UNION ALL SELECT 'audit_reapproval_log', 'unlock_request_id'
  UNION ALL SELECT 'audit_reapproval_log', 'period_label'
  UNION ALL SELECT 'audit_reapproval_log', 'period_start'
  UNION ALL SELECT 'audit_reapproval_log', 'period_end'
  UNION ALL SELECT 'audit_reapproval_log', 'previous_status'
  UNION ALL SELECT 'audit_reapproval_log', 'new_status'
  UNION ALL SELECT 'audit_reapproval_log', 'audit_score'
  UNION ALL SELECT 'audit_reapproval_log', 'audit_status'
  UNION ALL SELECT 'audit_reapproval_log', 'reapproved_by'
  UNION ALL SELECT 'audit_reapproval_log', 'reapproved_by_name'
  UNION ALL SELECT 'audit_reapproval_log', 'reapproved_at'
  UNION ALL SELECT 'audit_reapproval_log', 'reapproval_notes'
  UNION ALL SELECT 'audit_reapproval_log', 'accountant_notes'
  UNION ALL SELECT 'audit_reapproval_log', 'management_notes'
  UNION ALL SELECT 'audit_reapproval_log', 'created_at'
) required
LEFT JOIN information_schema.COLUMNS current_column
  ON current_column.TABLE_SCHEMA = DATABASE()
 AND current_column.TABLE_NAME = required.table_name
 AND current_column.COLUMN_NAME = required.column_name
WHERE current_column.COLUMN_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(
    CONCAT(required.table_name, '.', required.index_name)
    ORDER BY required.table_name, required.index_name
    SEPARATOR ', '
  ) AS missing_indexes
FROM (
  SELECT 'audit_signoffs' AS table_name, 'PRIMARY' AS index_name
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_branch'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_period_type'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_period_dates'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_status'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_created_by'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_approved_by'
  UNION ALL SELECT 'audit_signoffs', 'idx_audit_signoff_created_at'
  UNION ALL SELECT 'audit_unlock_requests', 'PRIMARY'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_branch'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_signoff'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_status'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_area'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_requested_by'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_reviewed_by'
  UNION ALL SELECT 'audit_unlock_requests', 'idx_unlock_request_created_at'
  UNION ALL SELECT 'audit_reapproval_log', 'PRIMARY'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_branch'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_signoff'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_unlock_request'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_period_dates'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_user'
  UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_date'
) required
LEFT JOIN information_schema.STATISTICS current_index
  ON current_index.TABLE_SCHEMA = DATABASE()
 AND current_index.TABLE_NAME = required.table_name
 AND current_index.INDEX_NAME = required.index_name
WHERE current_index.INDEX_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(required.request_area ORDER BY required.request_area SEPARATOR ', ') AS missing_request_areas
FROM (
  SELECT 'sale' AS request_area
  UNION ALL SELECT 'expense'
  UNION ALL SELECT 'debt_payment'
  UNION ALL SELECT 'stock'
  UNION ALL SELECT 'stock_adjustment'
  UNION ALL SELECT 'stock_transfer'
  UNION ALL SELECT 'stock_ledger'
  UNION ALL SELECT 'purchase'
  UNION ALL SELECT 'return'
  UNION ALL SELECT 'sms'
  UNION ALL SELECT 'backup_restore'
  UNION ALL SELECT 'maintenance'
  UNION ALL SELECT 'audit_signoff'
  UNION ALL SELECT 'audit_reapproval'
  UNION ALL SELECT 'report'
  UNION ALL SELECT 'export'
  UNION ALL SELECT 'other'
) required
LEFT JOIN information_schema.COLUMNS request_area_column
  ON request_area_column.TABLE_SCHEMA = DATABASE()
 AND request_area_column.TABLE_NAME = 'audit_unlock_requests'
 AND request_area_column.COLUMN_NAME = 'request_area'
 AND LOCATE(CONCAT(CHAR(39), required.request_area, CHAR(39)), request_area_column.COLUMN_TYPE) > 0
WHERE request_area_column.COLUMN_NAME IS NULL;
