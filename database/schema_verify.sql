-- CHALIN 03 CLEAN MASTER SCHEMA VERIFY
-- Read-only verification. Select the target database before running.

SELECT DATABASE() AS verified_database;

WITH expected_tables AS (
  SELECT 'branches' AS table_name
  UNION ALL SELECT 'users' AS table_name
  UNION ALL SELECT 'user_branch_access' AS table_name
  UNION ALL SELECT 'business_units' AS table_name
  UNION ALL SELECT 'business_locations' AS table_name
  UNION ALL SELECT 'user_business_access' AS table_name
  UNION ALL SELECT 'products' AS table_name
  UNION ALL SELECT 'stock_adjustments' AS table_name
  UNION ALL SELECT 'suppliers' AS table_name
  UNION ALL SELECT 'purchases' AS table_name
  UNION ALL SELECT 'purchase_items' AS table_name
  UNION ALL SELECT 'purchase_payments' AS table_name
  UNION ALL SELECT 'customers' AS table_name
  UNION ALL SELECT 'sales' AS table_name
  UNION ALL SELECT 'sale_items' AS table_name
  UNION ALL SELECT 'debts' AS table_name
  UNION ALL SELECT 'debt_payments' AS table_name
  UNION ALL SELECT 'returns' AS table_name
  UNION ALL SELECT 'expenses' AS table_name
  UNION ALL SELECT 'sms_log' AS table_name
  UNION ALL SELECT 'activity_log' AS table_name
  UNION ALL SELECT 'settings' AS table_name
  UNION ALL SELECT 'daily_closings' AS table_name
  UNION ALL SELECT 'audit_signoffs' AS table_name
  UNION ALL SELECT 'audit_unlock_requests' AS table_name
  UNION ALL SELECT 'audit_reapproval_log' AS table_name
  UNION ALL SELECT 'stock_transfers' AS table_name
  UNION ALL SELECT 'stock_transfer_items' AS table_name
  UNION ALL SELECT 'fleet_assets' AS table_name
  UNION ALL SELECT 'fleet_meter_readings' AS table_name
  UNION ALL SELECT 'fleet_fuel_logs' AS table_name
  UNION ALL SELECT 'fleet_maintenance_records' AS table_name
  UNION ALL SELECT 'fleet_inspections' AS table_name
  UNION ALL SELECT 'mining_sites' AS table_name
  UNION ALL SELECT 'user_mining_site_access' AS table_name
  UNION ALL SELECT 'user_hire_location_access' AS table_name
  UNION ALL SELECT 'mining_daily_logs' AS table_name
  UNION ALL SELECT 'mining_production_records' AS table_name
  UNION ALL SELECT 'mining_equipment_logs' AS table_name
  UNION ALL SELECT 'mining_fuel_logs' AS table_name
  UNION ALL SELECT 'mining_expenses' AS table_name
  UNION ALL SELECT 'mining_incidents' AS table_name
  UNION ALL SELECT 'hire_customers' AS table_name
  UNION ALL SELECT 'hire_enquiries' AS table_name
  UNION ALL SELECT 'hire_quotations' AS table_name
  UNION ALL SELECT 'hire_contracts' AS table_name
  UNION ALL SELECT 'hire_contract_assets' AS table_name
  UNION ALL SELECT 'hire_dispatches' AS table_name
  UNION ALL SELECT 'hire_work_logs' AS table_name
  UNION ALL SELECT 'hire_invoices' AS table_name
  UNION ALL SELECT 'hire_invoice_lines' AS table_name
  UNION ALL SELECT 'hire_payments' AS table_name
  UNION ALL SELECT 'hire_return_inspections' AS table_name
)
SELECT
  53 AS expected_application_tables,
  COUNT(t.TABLE_NAME) AS application_tables_found
FROM expected_tables e
LEFT JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA = DATABASE()
 AND t.TABLE_NAME = e.table_name
 AND t.TABLE_TYPE = 'BASE TABLE';

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'present' ELSE 'missing' END AS schema_migrations_found
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'schema_migrations'
  AND TABLE_TYPE = 'BASE TABLE';

WITH expected_tables AS (
  SELECT 'branches' AS table_name
  UNION ALL SELECT 'users' AS table_name
  UNION ALL SELECT 'user_branch_access' AS table_name
  UNION ALL SELECT 'business_units' AS table_name
  UNION ALL SELECT 'business_locations' AS table_name
  UNION ALL SELECT 'user_business_access' AS table_name
  UNION ALL SELECT 'products' AS table_name
  UNION ALL SELECT 'stock_adjustments' AS table_name
  UNION ALL SELECT 'suppliers' AS table_name
  UNION ALL SELECT 'purchases' AS table_name
  UNION ALL SELECT 'purchase_items' AS table_name
  UNION ALL SELECT 'purchase_payments' AS table_name
  UNION ALL SELECT 'customers' AS table_name
  UNION ALL SELECT 'sales' AS table_name
  UNION ALL SELECT 'sale_items' AS table_name
  UNION ALL SELECT 'debts' AS table_name
  UNION ALL SELECT 'debt_payments' AS table_name
  UNION ALL SELECT 'returns' AS table_name
  UNION ALL SELECT 'expenses' AS table_name
  UNION ALL SELECT 'sms_log' AS table_name
  UNION ALL SELECT 'activity_log' AS table_name
  UNION ALL SELECT 'settings' AS table_name
  UNION ALL SELECT 'daily_closings' AS table_name
  UNION ALL SELECT 'audit_signoffs' AS table_name
  UNION ALL SELECT 'audit_unlock_requests' AS table_name
  UNION ALL SELECT 'audit_reapproval_log' AS table_name
  UNION ALL SELECT 'stock_transfers' AS table_name
  UNION ALL SELECT 'stock_transfer_items' AS table_name
  UNION ALL SELECT 'fleet_assets' AS table_name
  UNION ALL SELECT 'fleet_meter_readings' AS table_name
  UNION ALL SELECT 'fleet_fuel_logs' AS table_name
  UNION ALL SELECT 'fleet_maintenance_records' AS table_name
  UNION ALL SELECT 'fleet_inspections' AS table_name
  UNION ALL SELECT 'mining_sites' AS table_name
  UNION ALL SELECT 'user_mining_site_access' AS table_name
  UNION ALL SELECT 'user_hire_location_access' AS table_name
  UNION ALL SELECT 'mining_daily_logs' AS table_name
  UNION ALL SELECT 'mining_production_records' AS table_name
  UNION ALL SELECT 'mining_equipment_logs' AS table_name
  UNION ALL SELECT 'mining_fuel_logs' AS table_name
  UNION ALL SELECT 'mining_expenses' AS table_name
  UNION ALL SELECT 'mining_incidents' AS table_name
  UNION ALL SELECT 'hire_customers' AS table_name
  UNION ALL SELECT 'hire_enquiries' AS table_name
  UNION ALL SELECT 'hire_quotations' AS table_name
  UNION ALL SELECT 'hire_contracts' AS table_name
  UNION ALL SELECT 'hire_contract_assets' AS table_name
  UNION ALL SELECT 'hire_dispatches' AS table_name
  UNION ALL SELECT 'hire_work_logs' AS table_name
  UNION ALL SELECT 'hire_invoices' AS table_name
  UNION ALL SELECT 'hire_invoice_lines' AS table_name
  UNION ALL SELECT 'hire_payments' AS table_name
  UNION ALL SELECT 'hire_return_inspections' AS table_name
)
SELECT e.table_name AS missing_table
FROM expected_tables e
LEFT JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA = DATABASE()
 AND t.TABLE_NAME = e.table_name
 AND t.TABLE_TYPE = 'BASE TABLE'
WHERE t.TABLE_NAME IS NULL
ORDER BY e.table_name;


WITH required_columns AS (
  SELECT 'branches' AS table_name, 'code' AS column_name
  UNION ALL SELECT 'branches', 'branch_code'
  UNION ALL SELECT 'debts', 'amount_owed'
  UNION ALL SELECT 'debt_payments', 'amount'
  UNION ALL SELECT 'stock_transfers', 'approval_note'
)
SELECT rc.table_name, rc.column_name AS missing_core_compatibility_column
FROM required_columns rc
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = rc.table_name
 AND c.COLUMN_NAME = rc.column_name
WHERE c.COLUMN_NAME IS NULL;

WITH required_columns AS (
  SELECT 'id' AS column_name
  UNION ALL SELECT 'full_name' AS column_name
  UNION ALL SELECT 'username' AS column_name
  UNION ALL SELECT 'password_hash' AS column_name
  UNION ALL SELECT 'role' AS column_name
  UNION ALL SELECT 'phone' AS column_name
  UNION ALL SELECT 'default_branch_id' AS column_name
  UNION ALL SELECT 'can_access_all_branches' AS column_name
  UNION ALL SELECT 'is_active' AS column_name
  UNION ALL SELECT 'must_change_password' AS column_name
  UNION ALL SELECT 'password_changed_at' AS column_name
  UNION ALL SELECT 'created_by' AS column_name
  UNION ALL SELECT 'created_at' AS column_name
  UNION ALL SELECT 'updated_at' AS column_name
)
SELECT rc.column_name AS missing_users_column
FROM required_columns rc
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = 'users'
 AND c.COLUMN_NAME = rc.column_name
WHERE c.COLUMN_NAME IS NULL;

SELECT
  COLUMN_TYPE AS users_role_column_type,
  CASE
    WHEN COLUMN_TYPE LIKE '%admin%'
     AND COLUMN_TYPE LIKE '%manager%'
     AND COLUMN_TYPE LIKE '%staff%'
     AND COLUMN_TYPE LIKE '%cashier%'
     AND COLUMN_TYPE LIKE '%auditor%'
    THEN 'ok' ELSE 'problem'
  END AS allowed_user_roles_check
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'role';

WITH required_columns AS (
  SELECT 'amount_tendered' AS column_name
  UNION ALL SELECT 'amount_paid' AS column_name
  UNION ALL SELECT 'change_due' AS column_name
  UNION ALL SELECT 'balance' AS column_name
  UNION ALL SELECT 'is_voided' AS column_name
  UNION ALL SELECT 'void_reason' AS column_name
  UNION ALL SELECT 'voided_by' AS column_name
  UNION ALL SELECT 'voided_at' AS column_name
  UNION ALL SELECT 'edited_by' AS column_name
  UNION ALL SELECT 'edited_at' AS column_name
  UNION ALL SELECT 'edit_reason' AS column_name
)
SELECT rc.column_name AS missing_sales_hotfix_column
FROM required_columns rc
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = 'sales'
 AND c.COLUMN_NAME = rc.column_name
WHERE c.COLUMN_NAME IS NULL;

WITH required_columns AS (
  SELECT 'closure_notes' AS column_name
  UNION ALL SELECT 'operational_status' AS column_name
  UNION ALL SELECT 'financial_status' AS column_name
  UNION ALL SELECT 'closed_by' AS column_name
  UNION ALL SELECT 'closed_at' AS column_name
)
SELECT rc.column_name AS missing_hire_contract_closure_column
FROM required_columns rc
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = 'hire_contracts'
 AND c.COLUMN_NAME = rc.column_name
WHERE c.COLUMN_NAME IS NULL;

WITH expected_triggers AS (
  SELECT 'trg_hire_enquiry_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_quotation_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_contract_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_dispatch_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_work_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_invoice_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_payment_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_return_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_enquiry_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_quotation_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_contract_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_dispatch_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_work_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_invoice_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_payment_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_return_location_before_update' AS trigger_name
)
SELECT
  16 AS expected_hire_triggers,
  COUNT(t.TRIGGER_NAME) AS hire_triggers_found
FROM expected_triggers e
LEFT JOIN information_schema.TRIGGERS t
  ON t.TRIGGER_SCHEMA = DATABASE()
 AND t.TRIGGER_NAME = e.trigger_name;

WITH expected_triggers AS (
  SELECT 'trg_hire_enquiry_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_quotation_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_contract_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_dispatch_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_work_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_invoice_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_payment_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_return_location_before_insert' AS trigger_name
  UNION ALL SELECT 'trg_hire_enquiry_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_quotation_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_contract_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_dispatch_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_work_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_invoice_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_payment_location_before_update' AS trigger_name
  UNION ALL SELECT 'trg_hire_return_location_before_update' AS trigger_name
)
SELECT e.trigger_name AS missing_hire_trigger
FROM expected_triggers e
LEFT JOIN information_schema.TRIGGERS t
  ON t.TRIGGER_SCHEMA = DATABASE()
 AND t.TRIGGER_NAME = e.trigger_name
WHERE t.TRIGGER_NAME IS NULL
ORDER BY e.trigger_name;

SELECT 'required_indexes' AS check_name, COUNT(*) AS found_count
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'users' AND INDEX_NAME = 'idx_user_must_change_password') OR
    (TABLE_NAME = 'sales' AND INDEX_NAME = 'idx_sale_change_due') OR
    (TABLE_NAME = 'sales' AND INDEX_NAME = 'idx_sale_edited_by') OR
    (TABLE_NAME = 'hire_contracts' AND INDEX_NAME = 'idx_hire_contract_closure') OR
    (TABLE_NAME = 'hire_invoice_lines' AND INDEX_NAME = 'idx_hire_invoice_line_invoice') OR
    (TABLE_NAME = 'fleet_assets' AND INDEX_NAME = 'idx_fleet_asset_status')
  );

SELECT 'required_foreign_keys' AS check_name, COUNT(*) AS found_count
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
  AND (
    (TABLE_NAME = 'users' AND COLUMN_NAME = 'created_by' AND REFERENCED_TABLE_NAME = 'users') OR
    (TABLE_NAME = 'sales' AND COLUMN_NAME = 'edited_by' AND REFERENCED_TABLE_NAME = 'users') OR
    (TABLE_NAME = 'user_mining_site_access' AND COLUMN_NAME = 'site_id' AND REFERENCED_TABLE_NAME = 'mining_sites') OR
    (TABLE_NAME = 'user_hire_location_access' AND COLUMN_NAME = 'location_id' AND REFERENCED_TABLE_NAME = 'business_locations') OR
    (TABLE_NAME = 'hire_invoice_lines' AND COLUMN_NAME = 'invoice_id' AND REFERENCED_TABLE_NAME = 'hire_invoices') OR
    (TABLE_NAME = 'hire_contracts' AND COLUMN_NAME = 'closed_by' AND REFERENCED_TABLE_NAME = 'users')
  );

SELECT 'duplicate_usernames' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1
) x;

SELECT 'duplicate_receipt_numbers' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT receipt_number FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1
) x;

SELECT 'orphan_sale_items' AS check_name, COUNT(*) AS problem_count
FROM sale_items si
LEFT JOIN sales s ON s.id = si.sale_id
WHERE s.id IS NULL;

SELECT 'orphan_sales_customers' AS check_name, COUNT(*) AS problem_count
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
WHERE s.customer_id IS NOT NULL
  AND c.id IS NULL;

SELECT 'orphan_sales_staff' AS check_name, COUNT(*) AS problem_count
FROM sales s
LEFT JOIN users u ON u.id = s.staff_id
WHERE s.staff_id IS NOT NULL
  AND u.id IS NULL;

SELECT 'multiple_default_branch_assignments' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT user_id FROM user_branch_access WHERE is_primary = TRUE GROUP BY user_id HAVING COUNT(*) > 1
) x;

SELECT 'multiple_default_business_assignments' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT user_id FROM user_business_access WHERE is_default = TRUE GROUP BY user_id HAVING COUNT(*) > 1
) x;

SELECT 'multiple_default_mining_sites' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT user_id FROM user_mining_site_access WHERE is_default = TRUE GROUP BY user_id HAVING COUNT(*) > 1
) x;

SELECT 'multiple_default_hire_locations' AS check_name, COUNT(*) AS problem_count
FROM (
  SELECT user_id FROM user_hire_location_access WHERE is_default = TRUE GROUP BY user_id HAVING COUNT(*) > 1
) x;

SELECT 'hire_locations_not_equipment_hire' AS check_name, COUNT(*) AS problem_count
FROM user_hire_location_access uhla
JOIN business_locations bl ON bl.id = uhla.location_id
JOIN business_units bu ON bu.id = bl.business_unit_id
WHERE bu.code <> 'equipment_hire';

SELECT 'mining_site_access_orphans' AS check_name, COUNT(*) AS problem_count
FROM user_mining_site_access umsa
LEFT JOIN mining_sites ms ON ms.id = umsa.site_id
WHERE ms.id IS NULL;

SELECT 'canonical_backup_restore_counts' AS check_name,
  (SELECT COUNT(*) FROM branches) AS branches_count,
  (SELECT COUNT(*) FROM users) AS users_count,
  (SELECT COUNT(*) FROM user_branch_access) AS user_branch_access_count,
  (SELECT COUNT(*) FROM products) AS products_count,
  (SELECT COUNT(*) FROM sales) AS sales_count,
  (SELECT COUNT(*) FROM sale_items) AS sale_items_count,
  (SELECT COUNT(*) FROM sms_log) AS sms_log_count,
  (SELECT COUNT(*) FROM activity_log) AS activity_log_count;

SELECT 'legacy_alias_objects' AS check_name, COUNT(*) AS warning_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('stores', 'user_store_access', 'activity_logs');

SELECT 'blocking_problem_count' AS check_name,
  (
    (SELECT COUNT(*) FROM (
      SELECT e.table_name
      FROM (SELECT 'branches' AS table_name UNION ALL SELECT 'users' AS table_name UNION ALL SELECT 'user_branch_access' AS table_name UNION ALL SELECT 'business_units' AS table_name UNION ALL SELECT 'business_locations' AS table_name UNION ALL SELECT 'user_business_access' AS table_name UNION ALL SELECT 'products' AS table_name UNION ALL SELECT 'stock_adjustments' AS table_name UNION ALL SELECT 'suppliers' AS table_name UNION ALL SELECT 'purchases' AS table_name UNION ALL SELECT 'purchase_items' AS table_name UNION ALL SELECT 'purchase_payments' AS table_name UNION ALL SELECT 'customers' AS table_name UNION ALL SELECT 'sales' AS table_name UNION ALL SELECT 'sale_items' AS table_name UNION ALL SELECT 'debts' AS table_name UNION ALL SELECT 'debt_payments' AS table_name UNION ALL SELECT 'returns' AS table_name UNION ALL SELECT 'expenses' AS table_name UNION ALL SELECT 'sms_log' AS table_name UNION ALL SELECT 'activity_log' AS table_name UNION ALL SELECT 'settings' AS table_name UNION ALL SELECT 'daily_closings' AS table_name UNION ALL SELECT 'audit_signoffs' AS table_name UNION ALL SELECT 'audit_unlock_requests' AS table_name UNION ALL SELECT 'audit_reapproval_log' AS table_name UNION ALL SELECT 'stock_transfers' AS table_name UNION ALL SELECT 'stock_transfer_items' AS table_name UNION ALL SELECT 'fleet_assets' AS table_name UNION ALL SELECT 'fleet_meter_readings' AS table_name UNION ALL SELECT 'fleet_fuel_logs' AS table_name UNION ALL SELECT 'fleet_maintenance_records' AS table_name UNION ALL SELECT 'fleet_inspections' AS table_name UNION ALL SELECT 'mining_sites' AS table_name UNION ALL SELECT 'user_mining_site_access' AS table_name UNION ALL SELECT 'user_hire_location_access' AS table_name UNION ALL SELECT 'mining_daily_logs' AS table_name UNION ALL SELECT 'mining_production_records' AS table_name UNION ALL SELECT 'mining_equipment_logs' AS table_name UNION ALL SELECT 'mining_fuel_logs' AS table_name UNION ALL SELECT 'mining_expenses' AS table_name UNION ALL SELECT 'mining_incidents' AS table_name UNION ALL SELECT 'hire_customers' AS table_name UNION ALL SELECT 'hire_enquiries' AS table_name UNION ALL SELECT 'hire_quotations' AS table_name UNION ALL SELECT 'hire_contracts' AS table_name UNION ALL SELECT 'hire_contract_assets' AS table_name UNION ALL SELECT 'hire_dispatches' AS table_name UNION ALL SELECT 'hire_work_logs' AS table_name UNION ALL SELECT 'hire_invoices' AS table_name UNION ALL SELECT 'hire_invoice_lines' AS table_name UNION ALL SELECT 'hire_payments' AS table_name UNION ALL SELECT 'hire_return_inspections' AS table_name) e
      LEFT JOIN information_schema.TABLES t
        ON t.TABLE_SCHEMA = DATABASE()
       AND t.TABLE_NAME = e.table_name
       AND t.TABLE_TYPE = 'BASE TABLE'
      WHERE t.TABLE_NAME IS NULL
    ) missing_tables) +
    (SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations') +
    (SELECT COUNT(*) FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) dup_users) +
    (SELECT COUNT(*) FROM (SELECT receipt_number FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1) dup_receipts) +
    (SELECT COUNT(*) FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL)
  ) AS problem_count;

SELECT 'warning_count' AS check_name,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('stores', 'user_store_access', 'activity_logs')) AS warning_count;
