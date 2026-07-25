const path = require("path");

const { pool } = require("../config/db");
const equipmentSalesRoutes = require("../routes/equipmentSalesRoutes");
const equipmentSalesFinalizationRoutes = require("../routes/equipmentSalesFinalizationRoutes");
const {
  startEquipmentSalesReminderScheduler,
} = require("./equipmentSalesReminderService");

const MIGRATION_NAME = "20260722_equipment_sales_installments_foundation";
const MIGRATION_FILE = path.resolve(
  __dirname,
  "../../database/migrations/20260722_equipment_sales_installments_foundation.sql"
);
const RETIREMENT_MIGRATION_NAME = "20260722_retire_spare_parts_installments";
const RETIREMENT_MIGRATION_FILE = path.resolve(
  __dirname,
  "../../database/migrations/20260722_retire_spare_parts_installments.sql"
);
const CORE_REPAIR_MIGRATION_NAME =
  "20260723_equipment_catalogue_core_compatibility_repair_v2";

const FOUNDATION_MIGRATION = Object.freeze({
  name: MIGRATION_NAME,
  file: MIGRATION_FILE,
  required: true,
});
const RETIREMENT_MIGRATION = Object.freeze({
  name: RETIREMENT_MIGRATION_NAME,
  file: RETIREMENT_MIGRATION_FILE,
  required: false,
});

const CATALOGUE_REQUIRED_COLUMNS = Object.freeze({
  fleet_assets: [
    "hire_location_id",
    "equipment_category",
    "model_year",
    "chassis_number",
    "engine_number",
    "colour",
    "capacity_description",
    "condition_status",
    "operational_purpose",
    "sale_status",
    "acquisition_date",
    "acquisition_cost",
    "target_selling_price",
    "standard_hire_rate",
    "supplier_name",
    "acquisition_reference",
    "main_image_url",
    "sale_reserved_until",
    "sold_at",
  ],
  sms_log: [
    "workspace_code",
    "business_unit_id",
    "hire_location_id",
    "entity_type",
    "entity_id",
    "template_code",
    "deduplication_key",
    "scheduled_for",
    "consent_basis",
  ],
  equipment_media: [
    "asset_id",
    "hire_location_id",
    "media_category",
    "evidence_type",
    "file_url",
    "storage_key",
    "thumbnail_url",
    "file_name",
    "mime_type",
    "file_size_bytes",
    "caption",
    "is_primary",
    "sort_order",
    "captured_at",
    "created_by",
    "archived_at",
    "archived_by",
    "archive_reason",
    "created_at",
    "updated_at",
  ],
  equipment_asset_sale_locks: [
    "asset_id",
    "agreement_id",
    "hire_location_id",
    "lock_status",
    "lock_reason",
    "locked_at",
    "expires_at",
    "released_at",
    "released_by",
    "release_reason",
    "created_by",
    "updated_at",
  ],
});

const REQUIRED_FOUNDATION_TABLES = Object.freeze([
  "equipment_sales_enquiries",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_sale_agreements",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
  "equipment_legacy_installment_migrations",
]);

const REQUIRED_COMMERCIAL_COLUMNS = Object.freeze({
  equipment_sales_enquiries: [
    "enquiry_number",
    "hire_location_id",
    "customer_id",
    "status",
  ],
  equipment_sales_quotations: [
    "quotation_number",
    "hire_location_id",
    "customer_id",
    "status",
    "total_amount",
  ],
  equipment_sales_quotation_items: [
    "quotation_id",
    "hire_location_id",
    "asset_id",
    "line_total",
  ],
  equipment_sale_agreements: [
    "agreement_number",
    "hire_location_id",
    "quotation_item_id",
    "customer_id",
    "asset_id",
    "agreement_status",
    "outstanding_balance",
    "overdue_amount",
  ],
  equipment_installment_schedule: [
    "agreement_id",
    "due_date",
    "scheduled_amount",
    "schedule_status",
  ],
  equipment_sale_payments: [
    "agreement_id",
    "payment_number",
    "receipt_number",
    "amount",
    "payment_category",
  ],
  equipment_sale_payment_allocations: [
    "payment_id",
    "schedule_id",
    "allocated_amount",
  ],
  equipment_deliveries: [
    "agreement_id",
    "delivery_number",
    "hire_location_id",
    "status",
  ],
  equipment_ownership_transfers: [
    "agreement_id",
    "transfer_number",
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
    "source_snapshot_json",
  ],
});

let lastSchemaStatus = null;

if (!equipmentSalesRoutes.__chalin03FinalizationMounted) {
  equipmentSalesRoutes.use(equipmentSalesFinalizationRoutes);
  Object.defineProperty(equipmentSalesRoutes, "__chalin03FinalizationMounted", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function loadColumns(connection, tableNames) {
  if (!tableNames.length) return new Map();
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

function missingColumns(columnsByTable, requirements) {
  const missing = [];
  for (const [tableName, requiredColumns] of Object.entries(requirements)) {
    const actual = columnsByTable.get(tableName) || new Set();
    for (const columnName of requiredColumns) {
      if (!actual.has(columnName)) missing.push(`${tableName}.${columnName}`);
    }
  }
  return missing;
}

async function verifyCatalogueCore(connection) {
  const requirements = {
    fleet_assets: CATALOGUE_REQUIRED_COLUMNS.fleet_assets,
    business_locations: ["id", "business_unit_id", "is_active"],
    business_units: ["id", "code", "is_enabled"],
    users: ["id", "is_active"],
    sms_log: CATALOGUE_REQUIRED_COLUMNS.sms_log,
    equipment_media: CATALOGUE_REQUIRED_COLUMNS.equipment_media,
    equipment_asset_sale_locks:
      CATALOGUE_REQUIRED_COLUMNS.equipment_asset_sale_locks,
  };
  const tableNames = Object.keys(requirements);
  const columnsByTable = await loadColumns(connection, tableNames);
  const missingTables = tableNames.filter(
    (tableName) => (columnsByTable.get(tableName) || new Set()).size === 0
  );
  const missing = missingColumns(columnsByTable, requirements).filter(
    (item) => !missingTables.some((tableName) => item.startsWith(`${tableName}.`))
  );

  if (missingTables.length || missing.length) {
    const error = new Error(
      `Equipment Catalogue schema is not ready. Missing tables: ${
        missingTables.join(", ") || "none"
      }. Missing columns: ${missing.join(", ") || "none"}.`
    );
    error.code = "EQUIPMENT_CATALOGUE_CORE_NOT_READY";
    error.missingTables = missingTables;
    error.missingColumns = missing;
    throw error;
  }

  return { ready: true, missing_tables: [], missing_columns: [] };
}

async function verifyFullFoundation(connection) {
  const columnsByTable = await loadColumns(
    connection,
    Object.keys(REQUIRED_COMMERCIAL_COLUMNS)
  );
  const missingTables = REQUIRED_FOUNDATION_TABLES.filter(
    (tableName) => (columnsByTable.get(tableName) || new Set()).size === 0
  );
  const columns = missingColumns(columnsByTable, REQUIRED_COMMERCIAL_COLUMNS).filter(
    (item) => !missingTables.some((tableName) => item.startsWith(`${tableName}.`))
  );
  return {
    ready: missingTables.length === 0 && columns.length === 0,
    missing_tables: missingTables,
    missing_columns: columns,
  };
}

async function verifyFoundationSafety(connection) {
  if (!(await tableExists(connection, "hire_contract_assets"))) {
    return {
      ready: false,
      skipped: true,
      missing: [],
      reason: "hire_contract_assets_not_installed",
    };
  }

  const expectedTriggers = [
    "trg_hire_contract_asset_sale_guard_before_insert",
    "trg_hire_contract_asset_sale_guard_before_update",
    "trg_equipment_sale_agreement_hire_guard_before_insert",
    "trg_equipment_sale_agreement_hire_guard_before_update",
  ];
  const placeholders = expectedTriggers.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${placeholders})`,
    expectedTriggers
  );
  const installed = new Set(rows.map((row) => row.TRIGGER_NAME));
  const missing = expectedTriggers.filter((name) => !installed.has(name));
  return {
    ready: missing.length === 0,
    skipped: false,
    missing,
    reason: missing.length ? "database_triggers_pending" : null,
  };
}

async function verifyRetirement(connection) {
  const expectedTriggers = ["trg_spare_parts_installment_retired_sales_insert"];
  if (await tableExists(connection, "installment_agreements")) {
    expectedTriggers.push("trg_spare_parts_installment_retired_agreement_insert");
  }
  const placeholders = expectedTriggers.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${placeholders})`,
    expectedTriggers
  );
  const installed = new Set(rows.map((row) => row.TRIGGER_NAME));
  const missing = expectedTriggers.filter((name) => !installed.has(name));
  return { ready: missing.length === 0, missing };
}

async function verifyFoundation(connection) {
  return {
    core: await verifyCatalogueCore(connection),
    full: await verifyFullFoundation(connection),
    safety: await verifyFoundationSafety(connection),
    retirement: await verifyRetirement(connection),
  };
}

async function assertEquipmentSalesSchemaReady({ requireFull = true } = {}) {
  const connection = await pool.getConnection();
  try {
    const status = await verifyFoundation(connection);
    if (requireFull && !status.full.ready) {
      const error = new Error(
        `Equipment Sales schema is incomplete. Missing tables: ${
          status.full.missing_tables.join(", ") || "none"
        }. Missing columns: ${status.full.missing_columns.join(", ") || "none"}.`
      );
      error.code = "EQUIPMENT_SALES_SCHEMA_NOT_READY";
      error.missingTables = status.full.missing_tables;
      error.missingColumns = status.full.missing_columns;
      throw error;
    }

    lastSchemaStatus = {
      core_ready: status.core.ready,
      full_ready: status.full.ready,
      safety: status.safety,
      retirement: status.retirement,
      checked_at: new Date().toISOString(),
      runtime_mutation_disabled: true,
    };

    if (status.full.ready) startEquipmentSalesReminderScheduler();
    return lastSchemaStatus;
  } finally {
    connection.release();
  }
}

async function ensureEquipmentSalesSchema(options = {}) {
  return assertEquipmentSalesSchemaReady({
    requireFull: options.requireFull !== false,
  });
}

function getEquipmentSalesSchemaStatus() {
  return lastSchemaStatus;
}

module.exports = {
  CATALOGUE_REQUIRED_COLUMNS,
  CORE_REPAIR_MIGRATION_NAME,
  FOUNDATION_MIGRATION,
  MIGRATION_FILE,
  MIGRATION_NAME,
  REQUIRED_COMMERCIAL_COLUMNS,
  REQUIRED_FOUNDATION_TABLES,
  RETIREMENT_MIGRATION,
  RETIREMENT_MIGRATION_FILE,
  RETIREMENT_MIGRATION_NAME,
  assertEquipmentSalesSchemaReady,
  ensureEquipmentSalesSchema,
  getEquipmentSalesSchemaStatus,
  tableExists,
  verifyCatalogueCore,
  verifyFoundation,
  verifyFoundationCore: verifyCatalogueCore,
  verifyFoundationSafety,
  verifyFullFoundation,
  verifyRetirement,
};
