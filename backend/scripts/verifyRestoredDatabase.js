const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

try {
  require("dotenv").config();
} catch (_error) {
  // dotenv is optional when DB variables are injected by the environment.
}

const EQUIPMENT_SALES_MIGRATION_NAME =
  "20260722_equipment_sales_installments_foundation";

const APPLICATION_TABLES = [
  "branches",
  "users",
  "user_branch_access",
  "user_permission_overrides",
  "business_units",
  "business_locations",
  "user_business_access",
  "user_category_assignment_conflicts",
  "worker_profiles",
  "worker_assignments",
  "worker_family_members",
  "worker_emergency_contacts",
  "worker_documents",
  "worker_licenses",
  "worker_property_assignments",
  "worker_status_history",
  "worker_profile_change_history",
  "worker_private_files",
  "worker_print_history",
  "worker_hr_letters",
  "standalone_hr_documents",
  "document_signature_settings",
  "payroll_statutory_rule_versions",
  "payroll_compensation_profiles",
  "payroll_recurring_components",
  "payroll_periods",
  "payroll_entries",
  "payroll_entry_lines",
  "payroll_salary_payments",
  "payroll_adjustment_requests",
  "payroll_worker_loans",
  "payroll_loan_transactions",
  "payroll_payslips",
  "worker_category_assignment_conflicts",
  "products",
  "stock_adjustments",
  "suppliers",
  "purchases",
  "purchase_items",
  "purchase_payments",
  "customers",
  "sales",
  "sale_items",
  "sale_payment_allocations",
  "sale_change_history",
  "debts",
  "debt_payments",
  "returns",
  "expenses",
  "sms_log",
  "activity_log",
  "security_event_dismissals",
  "application_error_log",
  "settings",
  "daily_closings",
  "daily_closing_revisions",
  "audit_signoffs",
  "audit_unlock_requests",
  "audit_reapproval_log",
  "stock_transfers",
  "stock_transfer_items",
  "fleet_assets",
  "fleet_meter_readings",
  "fleet_fuel_logs",
  "fleet_maintenance_records",
  "fleet_inspections",
  "mining_sites",
  "user_mining_site_access",
  "user_hire_location_access",
  "mining_daily_logs",
  "mining_production_records",
  "mining_equipment_logs",
  "mining_fuel_logs",
  "mining_expenses",
  "mining_incidents",
  "mining_stockpiles",
  "mining_dispatches",
  "mining_stockpile_movements",
  "mining_fuel_tanks",
  "mining_fuel_transactions",
  "mining_fuel_reconciliations",
  "mining_contractors",
  "mining_shift_crews",
  "mining_shift_crew_members",
  "mining_site_closings",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_contract_assets",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_invoice_lines",
  "hire_payments",
  "hire_return_inspections",
  "hire_rate_cards",
  "hire_quotation_items",
  "hire_contract_items",
  "hire_contract_amendments",
  "hire_deposit_transactions",
  "hire_commercial_approvals",
  "hire_evidence_files",
  "hire_damage_assessments",
  "notification_rules",
  "notifications",
  "notification_user_states",
  "notification_escalations",
  "notification_sync_runs",
  "shared_control_evidence",
  "installment_settings",
  "installment_sequences",
  "installment_agreements",
  "installment_agreement_items",
  "installment_schedule",
  "installment_payments",
  "installment_payment_allocations",
  "installment_reschedules",
  "installment_reminder_log",
  "equipment_media",
  "equipment_sales_enquiries",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_sale_agreements",
  "equipment_asset_sale_locks",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
  "equipment_legacy_installment_migrations",
];

const HIRE_TRIGGERS = [
  "trg_hire_enquiry_location_before_insert",
  "trg_hire_quotation_location_before_insert",
  "trg_hire_contract_location_before_insert",
  "trg_hire_dispatch_location_before_insert",
  "trg_hire_work_location_before_insert",
  "trg_hire_invoice_location_before_insert",
  "trg_hire_payment_location_before_insert",
  "trg_hire_return_location_before_insert",
  "trg_hire_enquiry_location_before_update",
  "trg_hire_quotation_location_before_update",
  "trg_hire_contract_location_before_update",
  "trg_hire_dispatch_location_before_update",
  "trg_hire_work_location_before_update",
  "trg_hire_invoice_location_before_update",
  "trg_hire_payment_location_before_update",
  "trg_hire_return_location_before_update",
  "trg_hire_contract_asset_sale_guard_before_insert",
  "trg_hire_contract_asset_sale_guard_before_update",
  "trg_equipment_sale_agreement_hire_guard_before_insert",
  "trg_equipment_sale_agreement_hire_guard_before_update",
];

const REQUIRED_EQUIPMENT_COLUMNS = [
  ["fleet_assets", "hire_location_id"],
  ["fleet_assets", "equipment_category"],
  ["fleet_assets", "model_year"],
  ["fleet_assets", "chassis_number"],
  ["fleet_assets", "engine_number"],
  ["fleet_assets", "condition_status"],
  ["fleet_assets", "operational_purpose"],
  ["fleet_assets", "sale_status"],
  ["fleet_assets", "acquisition_cost"],
  ["fleet_assets", "target_selling_price"],
  ["fleet_assets", "standard_hire_rate"],
  ["fleet_assets", "main_image_url"],
  ["sms_log", "workspace_code"],
  ["sms_log", "business_unit_id"],
  ["sms_log", "hire_location_id"],
  ["sms_log", "entity_type"],
  ["sms_log", "entity_id"],
  ["sms_log", "template_code"],
  ["sms_log", "deduplication_key"],
  ["sms_log", "scheduled_for"],
  ["sms_log", "consent_basis"],
];

function env(primaryName, fallbackName, defaultValue = undefined) {
  return process.env[primaryName] || process.env[fallbackName] || defaultValue;
}

function connectionConfig() {
  const sslValue = String(process.env.DB_SSL || "").toLowerCase();
  const ssl =
    sslValue === "true"
      ? { rejectUnauthorized: true }
      : sslValue === "false"
        ? false
        : undefined;

  return {
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(env("DB_PORT", "MYSQLPORT", 3306)),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    timezone: "Z",
    ssl,
  };
}

function safeIdentifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(value || ""))) {
    throw new Error(`Unsafe identifier: ${value}`);
  }

  return `\`${value}\``;
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sqlText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "");
      continue;
    }

    buffer += `${rawLine}\n`;

    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();

      if (statement) {
        statements.push(statement);
      }

      buffer = "";
    }
  }

  if (buffer.trim()) {
    statements.push(buffer.trim());
  }

  return statements;
}

async function runReadOnlySqlFile(connection, relativePath) {
  const filePath = path.resolve(__dirname, relativePath);
  const statements = splitSqlStatements(fs.readFileSync(filePath, "utf8"));
  let resultSets = 0;

  for (const statement of statements) {
    const [rows] = await connection.query(statement);
    resultSets += Array.isArray(rows) ? 1 : 0;
  }

  return resultSets;
}

async function scalar(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  const firstRow = rows[0] || {};
  const firstKey = Object.keys(firstRow)[0];
  return Number(firstRow[firstKey] || 0);
}

async function main() {
  const config = connectionConfig();

  if (!config.host || !config.user || !config.database) {
    throw new Error("Missing DB_HOST/MYSQLHOST, DB_USER/MYSQLUSER, or DB_NAME/MYSQLDATABASE.");
  }

  console.log("Read-only verification target:");
  console.log(`  host: ${config.host}`);
  console.log(`  port: ${config.port}`);
  console.log(`  user: ${config.user}`);
  console.log(`  database: ${config.database}`);

  const connection = await mysql.createConnection(config);

  try {
    const appTableCount = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${APPLICATION_TABLES.map(() => "?").join(", ")})`,
      APPLICATION_TABLES
    );
    const schemaMigrations = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
    );
    const equipmentMigrationRecord = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM schema_migrations
       WHERE migration_name = ?`,
      [EQUIPMENT_SALES_MIGRATION_NAME]
    );
    const triggerCount = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${HIRE_TRIGGERS.map(() => "?").join(", ")})`,
      HIRE_TRIGGERS
    );
    const requiredCoreColumns = [
      ["branches", "code"],
      ["branches", "branch_code"],
      ["debts", "amount_owed"],
      ["debt_payments", "amount"],
      ["stock_transfers", "approval_note"],
    ];
    const coreColumnConditions = requiredCoreColumns
      .map(() => "(TABLE_NAME = ? AND COLUMN_NAME = ?)")
      .join(" OR ");
    const coreColumnsFound = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       AND (${coreColumnConditions})`,
      requiredCoreColumns.flat()
    );
    const equipmentColumnConditions = REQUIRED_EQUIPMENT_COLUMNS
      .map(() => "(TABLE_NAME = ? AND COLUMN_NAME = ?)")
      .join(" OR ");
    const equipmentColumnsFound = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       AND (${equipmentColumnConditions})`,
      REQUIRED_EQUIPMENT_COLUMNS.flat()
    );
    const userRoleSupportsStaff = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'role'
       AND COLUMN_TYPE LIKE '%staff%'`
    );
    const duplicateUsers = await scalar(
      connection,
      "SELECT COUNT(*) AS count_value FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) x"
    );
    const duplicateReceipts = await scalar(
      connection,
      "SELECT COUNT(*) AS count_value FROM (SELECT receipt_number FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1) x"
    );
    const orphanSaleItems = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM sale_items si
       LEFT JOIN sales s ON s.id = si.sale_id
       WHERE s.id IS NULL`
    );
    const orphanEquipmentMedia = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM equipment_media em
       LEFT JOIN fleet_assets fa ON fa.id = em.asset_id
       WHERE fa.id IS NULL`
    );
    const orphanEquipmentAgreements = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM equipment_sale_agreements esa
       LEFT JOIN hire_customers hc ON hc.id = esa.customer_id
       LEFT JOIN fleet_assets fa ON fa.id = esa.asset_id
       LEFT JOIN business_locations bl ON bl.id = esa.hire_location_id
       WHERE hc.id IS NULL OR fa.id IS NULL OR bl.id IS NULL`
    );
    const activeHireSaleConflicts = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM hire_contract_assets hca
       INNER JOIN equipment_asset_sale_locks easl
         ON easl.asset_id = hca.asset_id
        AND easl.released_at IS NULL
       WHERE hca.status IN ('assigned', 'dispatched', 'active')`
    );
    const scheduleTotalMismatches = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM equipment_sale_agreements esa
       WHERE esa.sale_type = 'installment'
         AND ABS(
           esa.scheduled_total - COALESCE((
             SELECT SUM(eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount)
             FROM equipment_installment_schedule eis
             WHERE eis.agreement_id = esa.id
               AND eis.schedule_status <> 'cancelled'
           ), 0)
         ) > 0.01`
    );
    const paymentAllocationMismatches = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM equipment_sale_payments esp
       WHERE esp.is_voided = FALSE
         AND esp.payment_category IN ('installment', 'settlement')
         AND ABS(
           esp.amount - COALESCE((
             SELECT SUM(espa.allocated_amount)
             FROM equipment_sale_payment_allocations espa
             WHERE espa.payment_id = esp.id
           ), 0)
         ) > 0.01`
    );
    const aliasObjects = await scalar(
      connection,
      `SELECT COUNT(*) AS count_value
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('stores', 'user_store_access', 'activity_logs')`
    );

    const schemaVerifyResultSets = await runReadOnlySqlFile(
      connection,
      "../../database/schema_verify.sql"
    );
    const equipmentVerifyResultSets = await runReadOnlySqlFile(
      connection,
      "../../database/migrations/20260722_equipment_sales_installments_verify.sql"
    );

    const summary = {
      applicationTablesExpected: 67,
      applicationTablesFound: appTableCount,
      schemaMigrationsFound: schemaMigrations === 1,
      equipmentMigrationRecordFound: equipmentMigrationRecord === 1,
      hireTriggersExpected: 20,
      hireTriggersFound: triggerCount,
      requiredCoreColumnsExpected: 5,
      requiredCoreColumnsFound: coreColumnsFound,
      requiredEquipmentColumnsExpected: REQUIRED_EQUIPMENT_COLUMNS.length,
      requiredEquipmentColumnsFound: equipmentColumnsFound,
      userRoleSupportsStaff: userRoleSupportsStaff === 1,
      duplicateUsers,
      duplicateReceipts,
      orphanSaleItems,
      orphanEquipmentMedia,
      orphanEquipmentAgreements,
      activeHireSaleConflicts,
      scheduleTotalMismatches,
      paymentAllocationMismatches,
      legacyAliasObjects: aliasObjects,
      schemaVerifyResultSets,
      equipmentVerifyResultSets,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (
      appTableCount !== 67 ||
      schemaMigrations !== 1 ||
      equipmentMigrationRecord !== 1 ||
      triggerCount !== 20 ||
      coreColumnsFound !== 5 ||
      equipmentColumnsFound !== REQUIRED_EQUIPMENT_COLUMNS.length ||
      userRoleSupportsStaff !== 1 ||
      duplicateUsers > 0 ||
      duplicateReceipts > 0 ||
      orphanSaleItems > 0 ||
      orphanEquipmentMedia > 0 ||
      orphanEquipmentAgreements > 0 ||
      activeHireSaleConflicts > 0 ||
      scheduleTotalMismatches > 0 ||
      paymentAllocationMismatches > 0 ||
      aliasObjects > 0
    ) {
      throw new Error("Verification found blocking database problems.");
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
