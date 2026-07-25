const { pool } = require("../config/db");

const REQUIRED_MIGRATIONS = Object.freeze([
  "20260725_phase1_financial_control_hardening",
]);

const REQUIRED_TABLE_COLUMNS = Object.freeze({
  schema_migrations: ["migration_name", "applied_at", "description"],
  branches: [
    "id",
    "code",
    "branch_code",
    "name",
    "location",
    "phone",
    "is_active",
    "created_at",
    "updated_at",
  ],
  users: [
    "id",
    "full_name",
    "username",
    "password_hash",
    "role",
    "phone",
    "default_branch_id",
    "can_access_all_branches",
    "is_active",
    "token_version",
    "created_at",
    "updated_at",
  ],
  user_branch_access: [
    "user_id",
    "branch_id",
    "can_access",
    "created_at",
    "updated_at",
  ],
  expenses: [
    "branch_id",
    "amount",
    "expense_date",
    "funding_source",
    "affects_daily_closing",
    "is_voided",
    "void_reason",
    "void_reference",
    "voided_by",
    "voided_at",
    "void_approved_by",
    "void_approved_at",
    "is_reversal",
    "reversal_of_expense_id",
    "reversal_reference",
  ],
  worker_hr_letters: [
    "worker_id",
    "workspace_code",
    "status",
    "approval_signature_data_url",
    "approval_signatory_name",
    "approval_signatory_title",
    "signature_captured_at",
  ],
  document_signature_settings: [
    "id",
    "signatory_name",
    "signatory_title",
    "signature_data_url",
  ],
  standalone_hr_documents: [
    "workspace_code",
    "status",
    "approval_signature_data_url",
    "signature_captured_at",
  ],
  fleet_assets: [
    "hire_location_id",
    "operational_purpose",
    "sale_status",
    "acquisition_cost",
    "target_selling_price",
    "standard_hire_rate",
  ],
  equipment_media: ["asset_id", "hire_location_id", "file_url", "archived_at"],
  equipment_asset_sale_locks: [
    "asset_id",
    "agreement_id",
    "hire_location_id",
    "lock_status",
    "released_at",
  ],
  equipment_sales_enquiries: ["hire_location_id", "customer_id", "status"],
  equipment_sales_quotations: [
    "hire_location_id",
    "customer_id",
    "status",
    "total_amount",
  ],
  equipment_sales_quotation_items: [
    "quotation_id",
    "hire_location_id",
    "line_total",
  ],
  equipment_sale_agreements: [
    "hire_location_id",
    "quotation_item_id",
    "customer_id",
    "asset_id",
    "agreement_status",
    "outstanding_balance",
  ],
  equipment_installment_schedule: [
    "agreement_id",
    "due_date",
    "scheduled_amount",
    "schedule_status",
  ],
  equipment_sale_payments: ["agreement_id", "amount", "payment_category"],
  equipment_sale_payment_allocations: [
    "payment_id",
    "schedule_id",
    "allocated_amount",
  ],
  equipment_deliveries: ["agreement_id", "hire_location_id", "status"],
  equipment_ownership_transfers: [
    "agreement_id",
    "hire_location_id",
    "status",
  ],
  equipment_sales_reminder_log: [
    "agreement_id",
    "reminder_key",
    "delivery_status",
  ],
  equipment_legacy_installment_migrations: [
    "legacy_agreement_id",
    "reconciliation_status",
  ],
});

const OPTIONAL_TRIGGER_NAMES = Object.freeze([
  "trg_hire_contract_asset_sale_guard_before_insert",
  "trg_hire_contract_asset_sale_guard_before_update",
  "trg_equipment_sale_agreement_hire_guard_before_insert",
  "trg_equipment_sale_agreement_hire_guard_before_update",
  "trg_spare_parts_installment_retired_sales_insert",
]);

class SchemaReadinessError extends Error {
  constructor(problems) {
    super(`Production schema readiness check failed: ${problems.join("; ")}`);
    this.name = "SchemaReadinessError";
    this.code = "PRODUCTION_SCHEMA_NOT_READY";
    this.problems = [...problems];
  }
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

async function loadTableColumns(connection = pool) {
  const tableNames = Object.keys(REQUIRED_TABLE_COLUMNS);
  const placeholders = tableNames.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );

  const found = new Map(tableNames.map((tableName) => [tableName, new Set()]));
  for (const row of rows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  return found;
}

async function loadAppliedMigrations(connection = pool) {
  const [rows] = await connection.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name IN (${REQUIRED_MIGRATIONS.map(() => "?").join(",")})`,
    REQUIRED_MIGRATIONS
  );
  return new Set(rows.map((row) => row.migration_name));
}

async function loadInstalledTriggers(connection = pool) {
  const placeholders = OPTIONAL_TRIGGER_NAMES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${placeholders})`,
    OPTIONAL_TRIGGER_NAMES
  );
  return new Set(rows.map((row) => row.TRIGGER_NAME));
}

async function auditProductionSchemaReadiness({
  connection = pool,
  env = process.env,
} = {}) {
  const production = isProduction(env);
  const columnsByTable = await loadTableColumns(connection);
  const errors = [];
  const warnings = [];

  for (const [tableName, requiredColumns] of Object.entries(
    REQUIRED_TABLE_COLUMNS
  )) {
    const actualColumns = columnsByTable.get(tableName) || new Set();
    if (actualColumns.size === 0) {
      errors.push(`Required table ${tableName} is missing`);
      continue;
    }

    for (const columnName of requiredColumns) {
      if (!actualColumns.has(columnName)) {
        errors.push(`Required column ${tableName}.${columnName} is missing`);
      }
    }
  }

  if (errors.every((message) => !message.includes("schema_migrations"))) {
    const appliedMigrations = await loadAppliedMigrations(connection);
    for (const migrationName of REQUIRED_MIGRATIONS) {
      if (!appliedMigrations.has(migrationName)) {
        errors.push(`Required migration ${migrationName} is not recorded as applied`);
      }
    }
  }

  const installedTriggers = await loadInstalledTriggers(connection);
  const missingTriggers = OPTIONAL_TRIGGER_NAMES.filter(
    (triggerName) => !installedTriggers.has(triggerName)
  );
  if (missingTriggers.length > 0) {
    warnings.push(
      `Optional database trigger reinforcement is incomplete: ${missingTriggers.join(
        ", "
      )}`
    );
  }

  return {
    production,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    checked_tables: Object.keys(REQUIRED_TABLE_COLUMNS),
    required_migrations: REQUIRED_MIGRATIONS,
    missing_optional_triggers: missingTriggers,
  };
}

async function validateProductionSchemaReadiness(options = {}) {
  const result = await auditProductionSchemaReadiness(options);

  if (result.errors.length > 0 && result.production) {
    throw new SchemaReadinessError(result.errors);
  }

  return result;
}

module.exports = {
  OPTIONAL_TRIGGER_NAMES,
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLE_COLUMNS,
  SchemaReadinessError,
  auditProductionSchemaReadiness,
  isProduction,
  validateProductionSchemaReadiness,
};
