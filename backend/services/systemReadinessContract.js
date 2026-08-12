"use strict";

const CORE_RUNTIME_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "user_permission_overrides",
  "business_units",
  "business_locations",
  "user_business_access",
  "user_category_assignment_conflicts",
  "worker_category_assignment_conflicts",
  "worker_hr_letters",
  "products",
  "sales",
  "sale_items",
  "debts",
  "activity_log",
  "security_event_dismissals",
  "settings",
  "stock_transfers",
  "fleet_assets",
  "mining_sites",
  "user_mining_site_access",
  "user_hire_location_access",
  "mining_daily_logs",
  "mining_production_records",
  "mining_equipment_logs",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_payments",
  "hire_return_inspections",
  "content_studio_roles",
  "content_studio_role_permissions",
  "content_studio_role_scopes",
  "content_studio_user_access",
  "public_redirect_rules",
]);

// These tables and columns are the minimum structural contract for the Admin,
// Permissions, Activity/Security, Backup, Worker, Payroll and Inventory pages
// that participate in CHALIN ONE operational staging. Keep this list shared with
// both the live /api/readiness route and the disposable MySQL rehearsal so a
// future migration cannot be green in CI while an admin runtime dependency is
// absent from readiness.
const ADMIN_RUNTIME_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "business_units",
  "business_locations",
  "user_business_access",
  "activity_log",
  "auth_sessions",
  "password_recovery_otps",
  "settings",
  "protected_action_sessions",
  "privileged_action_ledger",
  "owner_break_glass_accounts",
  "owner_break_glass_mfa_enrollments",
  "owner_break_glass_recovery_codes",
  "owner_break_glass_login_history",
  "user_permission_overrides",
  "security_event_dismissals",
  "user_category_assignment_conflicts",
  "worker_category_assignment_conflicts",
  "backup_history",
  "worker_profiles",
  "worker_assignments",
  "worker_family_members",
  "worker_emergency_contacts",
  "worker_private_files",
  "worker_print_history",
  "worker_identity_sequences",
  "worker_hr_letters",
  "document_signature_settings",
  "standalone_hr_documents",
  "payroll_compensation_profiles",
  "payroll_periods",
  "payroll_entries",
  "payroll_salary_payments",
  "inventory_label_batches",
  "inventory_units",
  "inventory_unit_events",
  "inventory_count_sessions",
  "inventory_loss_investigations",
]);

const ADMIN_RUNTIME_COLUMNS = Object.freeze([
  Object.freeze(["users", "is_login_locked"]),
  Object.freeze(["users", "login_locked_at"]),
  Object.freeze(["users", "login_lock_reason"]),
  Object.freeze(["users", "last_failed_login_at"]),
  Object.freeze(["users", "last_failed_login_ip"]),
  Object.freeze(["users", "login_phone_normalized"]),
  Object.freeze(["users", "primary_workspace_code"]),
  Object.freeze(["users", "category_assignment_status"]),
  Object.freeze(["auth_sessions", "device_type"]),
  Object.freeze(["auth_sessions", "location_source"]),
  Object.freeze(["worker_profiles", "workspace_code"]),
  Object.freeze(["worker_profiles", "business_unit_id"]),
  Object.freeze(["worker_profiles", "id_card_serial"]),
  Object.freeze(["settings", "worker_id_card_validity_months"]),
  Object.freeze(["settings", "worker_employee_number_prefix"]),
  Object.freeze(["worker_hr_letters", "approval_signature_data_url"]),
  Object.freeze(["worker_hr_letters", "signature_captured_at"]),
  Object.freeze(["products", "inventory_tracking_mode"]),
  Object.freeze(["products", "inventory_product_code"]),
  Object.freeze(["products", "inventory_risk_tier"]),
  Object.freeze(["products", "inventory_traceability_state"]),
]);

const EXPECTED_TABLES = Object.freeze([
  ...new Set([...CORE_RUNTIME_TABLES, ...ADMIN_RUNTIME_TABLES]),
]);

const EXPECTED_COLUMNS = Object.freeze(
  ADMIN_RUNTIME_COLUMNS.map(([tableName, columnName]) =>
    Object.freeze([tableName, columnName])
  )
);

function evaluateRuntimeSchema({ tableRows = [], columnRows = [] } = {}) {
  const existingTables = new Set(
    tableRows.map((row) => String(row?.TABLE_NAME || row?.table_name || ""))
  );
  const existingColumns = new Set(
    columnRows.map((row) => {
      const tableName = String(row?.TABLE_NAME || row?.table_name || "");
      const columnName = String(row?.COLUMN_NAME || row?.column_name || "");
      return `${tableName}.${columnName}`;
    })
  );

  const missingTables = EXPECTED_TABLES.filter(
    (tableName) => !existingTables.has(tableName)
  );
  const missingColumns = EXPECTED_COLUMNS.filter(
    ([tableName, columnName]) => !existingColumns.has(`${tableName}.${columnName}`)
  ).map(([tableName, columnName]) => `${tableName}.${columnName}`);

  return Object.freeze({
    expected_table_count: EXPECTED_TABLES.length,
    discovered_table_count: existingTables.size,
    missing_tables: Object.freeze(missingTables),
    expected_column_count: EXPECTED_COLUMNS.length,
    discovered_column_count: existingColumns.size,
    missing_columns: Object.freeze(missingColumns),
  });
}

module.exports = {
  ADMIN_RUNTIME_COLUMNS,
  ADMIN_RUNTIME_TABLES,
  CORE_RUNTIME_TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_TABLES,
  evaluateRuntimeSchema,
};
