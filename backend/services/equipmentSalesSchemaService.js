const { pool } = require("../config/db");
const equipmentSalesRoutes = require("../routes/equipmentSalesRoutes");
const equipmentSalesFinalizationRoutes = require("../routes/equipmentSalesFinalizationRoutes");
const {
  startEquipmentSalesReminderScheduler,
} = require("./equipmentSalesReminderService");
const {
  COMMERCIAL_REPAIR_MIGRATION_NAME,
  verifyCommercialSalesSchema,
} = require("./equipmentSalesCommercialRepairService");

const MIGRATION_NAME = "20260722_equipment_sales_installments_foundation";
const RETIREMENT_MIGRATION_NAME = "20260722_retire_spare_parts_installments";
const CORE_REPAIR_MIGRATION_NAME =
  "20260723_equipment_catalogue_core_compatibility_repair_v2";

const CORE_TABLE_COLUMNS = Object.freeze({
  fleet_assets: [
    "id",
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
  business_locations: ["id", "business_unit_id", "code", "name", "is_active"],
  business_units: ["id", "code", "name", "is_enabled"],
  users: ["id", "username", "is_active"],
  equipment_media: [
    "id",
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

const SAFETY_TRIGGERS = Object.freeze([
  "trg_hire_contract_asset_sale_guard_before_insert",
  "trg_hire_contract_asset_sale_guard_before_update",
  "trg_equipment_sale_agreement_hire_guard_before_insert",
  "trg_equipment_sale_agreement_hire_guard_before_update",
]);

const RETIREMENT_TRIGGERS = Object.freeze([
  "trg_spare_parts_installment_retired_sales_insert",
]);

let readinessPromise = null;
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

function readinessError(code, message, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 503;
  Object.assign(error, metadata);
  return error;
}

async function loadTablesAndColumns(connection, tableNames) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
    tableNames
  );
  const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
    tableNames
  );
  const columnsByTable = new Map(
    tableNames.map((tableName) => [tableName, new Set()])
  );
  for (const row of columnRows) {
    columnsByTable.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
  }
  return { existingTables, columnsByTable };
}

async function verifyCatalogueCore(connection = pool) {
  const tableNames = Object.keys(CORE_TABLE_COLUMNS);
  const { existingTables, columnsByTable } = await loadTablesAndColumns(
    connection,
    tableNames
  );
  const missingTables = tableNames.filter(
    (tableName) => !existingTables.has(tableName)
  );
  const missingColumns = [];

  for (const [tableName, columns] of Object.entries(CORE_TABLE_COLUMNS)) {
    if (!existingTables.has(tableName)) continue;
    for (const columnName of columns) {
      if (!columnsByTable.get(tableName)?.has(columnName)) {
        missingColumns.push(`${tableName}.${columnName}`);
      }
    }
  }

  if (missingTables.length || missingColumns.length) {
    throw readinessError(
      "EQUIPMENT_CATALOGUE_CORE_NOT_READY",
      "The approved Equipment Catalogue migration is incomplete.",
      { missingTables, missingColumns }
    );
  }

  return { ready: true, missing_tables: [], missing_columns: [] };
}

async function verifyNamedTriggers(connection, triggerNames) {
  if (!triggerNames.length) return { ready: true, missing: [] };
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${triggerNames.map(() => "?").join(", ")})`,
    triggerNames
  );
  const existing = new Set(rows.map((row) => row.TRIGGER_NAME));
  const missing = triggerNames.filter((name) => !existing.has(name));
  return { ready: missing.length === 0, missing };
}

async function verifyFoundationSafety(connection = pool) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = 'hire_contract_assets'`
  );
  if (!tableRows.length) {
    return {
      ready: false,
      skipped: true,
      missing: [],
      reason: "hire_contract_assets_not_installed",
    };
  }

  const result = await verifyNamedTriggers(connection, SAFETY_TRIGGERS);
  return {
    ...result,
    skipped: false,
    reason: result.ready ? null : "database_triggers_pending",
  };
}

async function verifyRetirement(connection = pool) {
  const result = await verifyNamedTriggers(connection, RETIREMENT_TRIGGERS);
  if (!result.ready) {
    throw readinessError(
      "SPARE_PARTS_RETIREMENT_GUARDS_PENDING",
      "Spare Parts installment retirement guards are incomplete.",
      { missingTriggers: result.missing }
    );
  }
  return result;
}

async function verifyFoundation(connection = pool) {
  const core = await verifyCatalogueCore(connection);
  const commercial = await verifyCommercialSalesSchema(connection);
  const safety = await verifyFoundationSafety(connection);
  let retirement;
  try {
    retirement = await verifyRetirement(connection);
  } catch (error) {
    retirement = {
      ready: false,
      missing: error.missingTriggers || [],
      code: error.code,
    };
  }

  return {
    core,
    full: commercial,
    commercial,
    safety,
    retirement,
  };
}

async function ensureEquipmentSalesSchema(connection = pool) {
  if (connection === pool && readinessPromise) return readinessPromise;

  const verify = async () => {
    const status = await verifyFoundation(connection);
    lastSchemaStatus = {
      applied: false,
      skipped: true,
      core_ready: Boolean(status.core?.ready),
      full_ready: Boolean(status.commercial?.ready),
      migrations: {
        catalogue_core: CORE_REPAIR_MIGRATION_NAME,
        commercial_foundation: MIGRATION_NAME,
        commercial_columns: COMMERCIAL_REPAIR_MIGRATION_NAME,
        installment_retirement: RETIREMENT_MIGRATION_NAME,
      },
      ...status,
    };

    if (lastSchemaStatus.full_ready) {
      startEquipmentSalesReminderScheduler();
    }
    return lastSchemaStatus;
  };

  if (connection !== pool) return verify();
  readinessPromise = verify().catch((error) => {
    readinessPromise = null;
    lastSchemaStatus = {
      core_ready: false,
      full_ready: false,
      error: {
        code: error?.code || "EQUIPMENT_SCHEMA_NOT_READY",
        missing_tables: error?.missingTables || [],
        missing_columns: error?.missingColumns || [],
      },
    };
    throw error;
  });
  return readinessPromise;
}

function getEquipmentSalesSchemaStatus() {
  return lastSchemaStatus;
}

module.exports = {
  CORE_REPAIR_MIGRATION_NAME,
  CORE_TABLE_COLUMNS,
  MIGRATION_NAME,
  RETIREMENT_MIGRATION_NAME,
  SAFETY_TRIGGERS,
  ensureEquipmentSalesSchema,
  getEquipmentSalesSchemaStatus,
  verifyCatalogueCore,
  verifyFoundation,
  verifyFoundationSafety,
  verifyRetirement,
};
