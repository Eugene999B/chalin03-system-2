const fs = require("fs");
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
  "20260723_equipment_catalogue_core_compatibility_repair_v1";
const LOCK_NAME = "chalin03_equipment_sales_finalization_v3";
const RUNTIME_BOOT_DELAY_MS = 15 * 1000;
const RUNTIME_RETRY_DELAY_MS = 5 * 60 * 1000;

const FOUNDATION_MIGRATION = {
  name: MIGRATION_NAME,
  file: MIGRATION_FILE,
  required: true,
};
const RETIREMENT_MIGRATION = {
  name: RETIREMENT_MIGRATION_NAME,
  file: RETIREMENT_MIGRATION_FILE,
  required: false,
};

const REQUIRED_FOUNDATION_TABLES = [
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

const FLEET_ASSET_COLUMNS = [
  ["hire_location_id", "INT NULL"],
  ["equipment_category", "VARCHAR(80) NULL"],
  ["model_year", "SMALLINT UNSIGNED NULL"],
  ["chassis_number", "VARCHAR(120) NULL"],
  ["engine_number", "VARCHAR(120) NULL"],
  ["colour", "VARCHAR(60) NULL"],
  ["capacity_description", "VARCHAR(120) NULL"],
  [
    "condition_status",
    "ENUM('new','excellent','good','fair','poor','damaged','under_inspection') NOT NULL DEFAULT 'good'",
  ],
  [
    "operational_purpose",
    "ENUM('hire_only','sale_only','sale_or_hire','company_operations') NOT NULL DEFAULT 'hire_only'",
  ],
  [
    "sale_status",
    "ENUM('not_for_sale','available','reserved','installment_active','sold','cancelled') NOT NULL DEFAULT 'not_for_sale'",
  ],
  ["acquisition_date", "DATE NULL"],
  ["acquisition_cost", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
  ["target_selling_price", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
  ["standard_hire_rate", "DECIMAL(14,2) NOT NULL DEFAULT 0.00"],
  ["supplier_name", "VARCHAR(150) NULL"],
  ["acquisition_reference", "VARCHAR(120) NULL"],
  ["main_image_url", "LONGTEXT NULL"],
  ["sale_reserved_until", "DATETIME NULL"],
  ["sold_at", "DATETIME NULL"],
];

const SMS_LOG_COLUMNS = [
  ["workspace_code", "VARCHAR(50) NULL"],
  ["business_unit_id", "INT NULL"],
  ["hire_location_id", "INT NULL"],
  ["entity_type", "VARCHAR(80) NULL"],
  ["entity_id", "BIGINT NULL"],
  ["template_code", "VARCHAR(100) NULL"],
  ["deduplication_key", "VARCHAR(190) NULL"],
  ["scheduled_for", "DATETIME NULL"],
  ["consent_basis", "VARCHAR(120) NULL"],
];

const EQUIPMENT_MEDIA_COLUMNS = [
  ["storage_key", "VARCHAR(500) NULL"],
  ["thumbnail_url", "LONGTEXT NULL"],
  ["file_name", "VARCHAR(255) NULL"],
  ["mime_type", "VARCHAR(120) NULL"],
  ["file_size_bytes", "BIGINT UNSIGNED NULL"],
  ["caption", "VARCHAR(500) NULL"],
  ["is_primary", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["sort_order", "INT NOT NULL DEFAULT 0"],
  ["captured_at", "DATETIME NULL"],
  ["created_by", "INT NULL"],
  ["archived_at", "DATETIME NULL"],
  ["archived_by", "INT NULL"],
  ["archive_reason", "VARCHAR(500) NULL"],
  ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  [
    "updated_at",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  ],
];

let runtimeBootstrapTimer = null;
let runtimeBootstrapReady = false;
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

function cleanIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    const error = new Error("Unsafe database identifier.");
    error.code = "UNSAFE_DATABASE_IDENTIFIER";
    throw error;
  }
  return identifier;
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of String(sqlText || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "");
      continue;
    }

    buffer += `${rawLine}\n`;

    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = "";
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
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

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function ensureMigrationRegistryShape(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INT AUTO_INCREMENT PRIMARY KEY,
       migration_name VARCHAR(150) NOT NULL UNIQUE,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       description TEXT NULL,
       INDEX idx_schema_migration_name (migration_name),
       INDEX idx_schema_migration_applied_at (applied_at)
     )`
  );

  if (!(await columnExists(connection, "schema_migrations", "description"))) {
    await connection.query(
      "ALTER TABLE schema_migrations ADD COLUMN description TEXT NULL"
    );
  }
}

async function migrationApplied(connection, migrationName) {
  await ensureMigrationRegistryShape(connection);
  const [rows] = await connection.query(
    "SELECT id FROM schema_migrations WHERE migration_name = ? LIMIT 1",
    [migrationName]
  );
  return rows.length > 0;
}

async function recordMigration(connection, migrationName, description) {
  await ensureMigrationRegistryShape(connection);
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       description = VALUES(description),
       applied_at = applied_at`,
    [migrationName, description]
  );
}

async function ensureColumn(connection, tableName, columnName, definition) {
  if (await columnExists(connection, tableName, columnName)) return false;
  const safeTable = cleanIdentifier(tableName);
  const safeColumn = cleanIdentifier(columnName);
  await connection.query(
    `ALTER TABLE \`${safeTable}\` ADD COLUMN \`${safeColumn}\` ${definition}`
  );
  return true;
}

async function ensureIndex(connection, tableName, indexName, columnsSql) {
  if (await indexExists(connection, tableName, indexName)) return false;
  const safeTable = cleanIdentifier(tableName);
  const safeIndex = cleanIdentifier(indexName);
  await connection.query(
    `ALTER TABLE \`${safeTable}\` ADD INDEX \`${safeIndex}\` (${columnsSql})`
  );
  return true;
}

function normalizeFoundationSqlForProduction(sqlText) {
  return String(sqlText || "")
    // Removing AFTER clauses makes the additive migration compatible with
    // older but valid production schemas.
    .replace(/\s+AFTER\s+`?[A-Za-z0-9_]+`?/gi, "")
    // The legacy mapping table must never make the catalogue depend on the
    // retired Spare Parts installment module.
    .replace(
      /CONSTRAINT\s+fk_equipment_legacy_migration_legacy[\s\S]*?ON\s+DELETE\s+RESTRICT\s*,/i,
      ""
    );
}

function stripForeignKeysFromCreateTable(statement) {
  return String(statement || "").replace(
    /,\s*CONSTRAINT\s+`?[A-Za-z0-9_]+`?\s+FOREIGN\s+KEY[\s\S]*?(?=,\s*CONSTRAINT|\n\))/gi,
    ""
  );
}

function foundationCreateTableStatements(sqlText) {
  return splitSqlStatements(normalizeFoundationSqlForProduction(sqlText))
    .filter((statement) =>
      /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:`?equipment_|`?schema_migrations)/i.test(
        statement
      )
    )
    .map(stripForeignKeysFromCreateTable);
}

async function ensureCatalogueCoreTables(connection) {
  if (!(await tableExists(connection, "equipment_media"))) {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS equipment_media (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         asset_id INT NOT NULL,
         hire_location_id INT NULL,
         media_category ENUM('photo','video','document') NOT NULL DEFAULT 'photo',
         evidence_type ENUM(
           'main','front','rear','left_side','right_side','cabin','engine',
           'serial_plate','chassis_plate','attachment','inspection','damage',
           'delivery','return','registration','insurance','ownership','other'
         ) NOT NULL DEFAULT 'other',
         file_url LONGTEXT NOT NULL,
         storage_key VARCHAR(500) NULL,
         thumbnail_url LONGTEXT NULL,
         file_name VARCHAR(255) NULL,
         mime_type VARCHAR(120) NULL,
         file_size_bytes BIGINT UNSIGNED NULL,
         caption VARCHAR(500) NULL,
         is_primary BOOLEAN NOT NULL DEFAULT FALSE,
         sort_order INT NOT NULL DEFAULT 0,
         captured_at DATETIME NULL,
         created_by INT NULL,
         archived_at DATETIME NULL,
         archived_by INT NULL,
         archive_reason VARCHAR(500) NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         INDEX idx_equipment_media_asset (asset_id, archived_at, sort_order),
         INDEX idx_equipment_media_location (hire_location_id, created_at),
         INDEX idx_equipment_media_type (asset_id, evidence_type, archived_at),
         INDEX idx_equipment_media_primary (asset_id, is_primary, archived_at)
       )`
    );
  }

  if (!(await tableExists(connection, "equipment_asset_sale_locks"))) {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS equipment_asset_sale_locks (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         asset_id INT NOT NULL,
         agreement_id BIGINT NULL,
         hire_location_id INT NULL,
         lock_status ENUM('reserved','installment_active','sold') NOT NULL DEFAULT 'reserved',
         locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         expires_at DATETIME NULL,
         released_at DATETIME NULL,
         released_by INT NULL,
         release_reason VARCHAR(500) NULL,
         created_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         INDEX idx_equipment_sale_lock_asset (asset_id, released_at),
         INDEX idx_equipment_sale_lock_agreement (agreement_id),
         INDEX idx_equipment_sale_lock_location (hire_location_id, lock_status)
       )`
    );
  }

  for (const [columnName, definition] of EQUIPMENT_MEDIA_COLUMNS) {
    await ensureColumn(connection, "equipment_media", columnName, definition);
  }
}

async function ensureCatalogueCoreSchema(connection) {
  for (const baseTable of [
    "fleet_assets",
    "business_locations",
    "business_units",
    "users",
    "sms_log",
  ]) {
    if (!(await tableExists(connection, baseTable))) {
      const error = new Error(
        `Required base table ${baseTable} is missing from the production database.`
      );
      error.code = "EQUIPMENT_CATALOGUE_BASE_TABLE_MISSING";
      error.tableName = baseTable;
      throw error;
    }
  }

  const changes = [];

  for (const [columnName, definition] of FLEET_ASSET_COLUMNS) {
    if (await ensureColumn(connection, "fleet_assets", columnName, definition)) {
      changes.push(`fleet_assets.${columnName}`);
    }
  }

  for (const [columnName, definition] of SMS_LOG_COLUMNS) {
    if (await ensureColumn(connection, "sms_log", columnName, definition)) {
      changes.push(`sms_log.${columnName}`);
    }
  }

  await ensureCatalogueCoreTables(connection);

  for (const [tableName, indexName, columnsSql] of [
    ["fleet_assets", "idx_fleet_asset_hire_location", "`hire_location_id`, `is_active`"],
    [
      "fleet_assets",
      "idx_fleet_asset_purpose_status",
      "`operational_purpose`, `current_status`, `sale_status`",
    ],
    ["fleet_assets", "idx_fleet_asset_make_model", "`make`, `model`, `model_year`"],
  ]) {
    try {
      await ensureIndex(connection, tableName, indexName, columnsSql);
    } catch (error) {
      console.warn(
        `Equipment Catalogue optional index ${indexName} remains pending:`,
        error.message
      );
    }
  }

  await recordMigration(
    connection,
    CORE_REPAIR_MIGRATION_NAME,
    "Idempotent production compatibility repair for Equipment Catalogue columns and core tables."
  );

  return { changed: changes.length > 0, changes };
}

async function verifyCatalogueCore(connection) {
  const requiredColumns = [
    ...FLEET_ASSET_COLUMNS.map(([name]) => ["fleet_assets", name]),
    ...SMS_LOG_COLUMNS.map(([name]) => ["sms_log", name]),
    ...EQUIPMENT_MEDIA_COLUMNS.map(([name]) => ["equipment_media", name]),
  ];

  const missingTables = [];
  for (const tableName of [
    "fleet_assets",
    "business_locations",
    "business_units",
    "users",
    "sms_log",
    "equipment_media",
    "equipment_asset_sale_locks",
  ]) {
    if (!(await tableExists(connection, tableName))) missingTables.push(tableName);
  }

  const missingColumns = [];
  for (const [tableName, columnName] of requiredColumns) {
    if (
      !missingTables.includes(tableName) &&
      !(await columnExists(connection, tableName, columnName))
    ) {
      missingColumns.push(`${tableName}.${columnName}`);
    }
  }

  if (missingTables.length || missingColumns.length) {
    const error = new Error(
      `Equipment Catalogue core verification failed. Missing tables: ${
        missingTables.join(", ") || "none"
      }. Missing columns: ${missingColumns.join(", ") || "none"}.`
    );
    error.code = "EQUIPMENT_CATALOGUE_CORE_NOT_READY";
    error.missingTables = missingTables;
    error.missingColumns = missingColumns;
    throw error;
  }

  return { ready: true, missing_tables: [], missing_columns: [] };
}

async function verifyFoundationCore(connection) {
  return verifyCatalogueCore(connection);
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
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${expectedTriggers.map(() => "?").join(",")})`,
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

async function verifyFullFoundation(connection) {
  const missing = [];
  for (const tableName of REQUIRED_FOUNDATION_TABLES) {
    if (!(await tableExists(connection, tableName))) missing.push(tableName);
  }
  return { ready: missing.length === 0, missing_tables: missing };
}

async function verifyFoundation(connection) {
  const core = await verifyCatalogueCore(connection);
  const full = await verifyFullFoundation(connection);
  const safety = await verifyFoundationSafety(connection);
  return { core, full, safety };
}

async function verifyRetirement(connection) {
  const expectedTriggers = ["trg_spare_parts_installment_retired_sales_insert"];
  if (await tableExists(connection, "installment_agreements")) {
    expectedTriggers.push("trg_spare_parts_installment_retired_agreement_insert");
  }

  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${expectedTriggers.map(() => "?").join(",")})`,
    expectedTriggers
  );
  const installed = new Set(rows.map((row) => row.TRIGGER_NAME));
  const missing = expectedTriggers.filter((name) => !installed.has(name));

  if (missing.length) {
    const error = new Error(
      `Spare Parts installment retirement verification found missing guards: ${missing.join(", ")}.`
    );
    error.code = "SPARE_PARTS_RETIREMENT_GUARDS_PENDING";
    throw error;
  }

  return { ready: true, missing: [] };
}

async function removeAnsiQuotesForMigration(connection) {
  const [rows] = await connection.query("SELECT @@SESSION.sql_mode AS sql_mode");
  const modes = String(rows[0]?.sql_mode || "")
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean)
    .filter((mode) => mode.toUpperCase() !== "ANSI_QUOTES");

  await connection.query("SET SESSION sql_mode = ?", [modes.join(",")]);
}

function wrapMigrationError(error, migration, statementIndex) {
  const wrapped = new Error(
    `${migration.name} failed at statement ${statementIndex + 1}: ${error.message}`
  );
  wrapped.code = error.code || "EQUIPMENT_SALES_MIGRATION_STATEMENT_FAILED";
  wrapped.migrationName = migration.name;
  wrapped.statementIndex = statementIndex + 1;
  wrapped.originalError = error;
  return wrapped;
}

function isIgnorableCreateError(error) {
  return new Set([
    "ER_TABLE_EXISTS_ERROR",
    "ER_DUP_FIELDNAME",
    "ER_DUP_KEYNAME",
    "ER_FK_DUP_NAME",
  ]).has(error?.code);
}

async function executeMigration(connection, migration) {
  if (!fs.existsSync(migration.file)) {
    const error = new Error(`Required migration file is missing: ${migration.file}`);
    error.code = "EQUIPMENT_SALES_MIGRATION_FILE_MISSING";
    throw error;
  }

  const sqlText = fs.readFileSync(migration.file, "utf8");
  const statements = foundationCreateTableStatements(sqlText);

  if (statements.length < REQUIRED_FOUNDATION_TABLES.length) {
    const error = new Error(
      `Migration ${migration.name} did not contain the expected equipment table statements.`
    );
    error.code = "EQUIPMENT_SALES_MIGRATION_INCOMPLETE";
    throw error;
  }

  const failures = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      if (isIgnorableCreateError(error)) continue;
      failures.push(wrapMigrationError(error, migration, index));
    }
  }

  const full = await verifyFullFoundation(connection);
  if (!full.ready) {
    const error =
      failures[0] ||
      new Error(`Equipment Sales tables still missing: ${full.missing_tables.join(", ")}.`);
    error.code = error.code || "EQUIPMENT_SALES_TABLES_MISSING";
    error.missingTables = full.missing_tables;
    throw error;
  }

  await recordMigration(
    connection,
    migration.name,
    "Equipment Sales & Hire tables created with production-compatible application safeguards."
  );

  return {
    statement_count: statements.length,
    warnings: failures.map((failure) => ({
      code: failure.code,
      statement_index: failure.statementIndex,
    })),
  };
}

async function ensureOneMigration(connection, migration) {
  const alreadyApplied = await migrationApplied(connection, migration.name);
  const fullBefore = await verifyFullFoundation(connection);

  if (alreadyApplied && fullBefore.ready) {
    return {
      name: migration.name,
      applied: false,
      repaired: false,
      pending: false,
      statement_count: 0,
    };
  }

  if (alreadyApplied && !fullBefore.ready) {
    console.warn(
      `Migration ${migration.name} was marked applied but verification failed; reapplying idempotently.`
    );
  }

  const result = await executeMigration(connection, migration);
  return {
    name: migration.name,
    applied: !alreadyApplied,
    repaired: alreadyApplied,
    pending: false,
    statement_count: result.statement_count,
    warnings: result.warnings,
  };
}

async function ensureOptionalMigration(connection, migration) {
  try {
    if (!(await migrationApplied(connection, migration.name))) {
      return {
        name: migration.name,
        applied: false,
        repaired: false,
        pending: true,
        code: "OPTIONAL_MIGRATION_PENDING",
        statement_count: 0,
      };
    }

    await verifyRetirement(connection);
    return {
      name: migration.name,
      applied: false,
      repaired: false,
      pending: false,
      statement_count: 0,
    };
  } catch (error) {
    console.error(
      `Optional migration ${migration.name} is pending and will not block Equipment Catalogue:`,
      error.message
    );
    return {
      name: migration.name,
      applied: false,
      repaired: false,
      pending: true,
      code: error.code || "OPTIONAL_MIGRATION_PENDING",
      statement_count: 0,
    };
  }
}

async function acquireMigrationLock(connection) {
  const [rows] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [
    LOCK_NAME,
  ]);
  return Number(rows[0]?.acquired || 0) === 1;
}

function safeStatusError(error) {
  return {
    code: error?.code || "EQUIPMENT_SCHEMA_REPAIR_PENDING",
    migration_name: error?.migrationName || null,
    statement_index: error?.statementIndex || null,
    missing_tables: error?.missingTables || [],
    missing_columns: error?.missingColumns || [],
  };
}

async function ensureEquipmentSalesSchema() {
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    lockAcquired = await acquireMigrationLock(connection);

    if (!lockAcquired) {
      try {
        const core = await verifyCatalogueCore(connection);
        const full = await verifyFullFoundation(connection);
        lastSchemaStatus = {
          core_ready: true,
          full_ready: full.ready,
          lock_pending: true,
          core,
          full,
        };
        return lastSchemaStatus;
      } catch {
        const error = new Error(
          "Could not acquire the Equipment Sales finalization migration lock."
        );
        error.code = "EQUIPMENT_SALES_MIGRATION_LOCK_TIMEOUT";
        throw error;
      }
    }

    await removeAnsiQuotesForMigration(connection);
    await ensureMigrationRegistryShape(connection);

    const coreRepair = await ensureCatalogueCoreSchema(connection);
    const core = await verifyCatalogueCore(connection);

    let foundationResult;
    let foundationError = null;
    try {
      foundationResult = await ensureOneMigration(connection, FOUNDATION_MIGRATION);
    } catch (error) {
      foundationError = error;
      foundationResult = {
        name: FOUNDATION_MIGRATION.name,
        applied: false,
        repaired: false,
        pending: true,
        code: error.code || "EQUIPMENT_SALES_FULL_FOUNDATION_PENDING",
        statement_count: 0,
      };
      console.error(
        "Equipment Sales full commercial foundation remains pending; Equipment Catalogue core will stay available:",
        error.message
      );
    }

    const retirementResult = await ensureOptionalMigration(
      connection,
      RETIREMENT_MIGRATION
    );
    const full = await verifyFullFoundation(connection);
    const safety = await verifyFoundationSafety(connection);

    if (!safety.ready && !safety.skipped) {
      console.warn(
        `Equipment Sales database trigger reinforcement remains pending: ${safety.missing.join(", ")}. Application transaction guards remain active.`
      );
    }

    if (full.ready) startEquipmentSalesReminderScheduler();

    lastSchemaStatus = {
      applied: Boolean(coreRepair.changed || foundationResult.applied),
      skipped: !coreRepair.changed && !foundationResult.applied,
      reason:
        coreRepair.changed || foundationResult.applied ? null : "already_applied",
      core_ready: core.ready,
      full_ready: full.ready,
      core_repair: coreRepair,
      migrations: [foundationResult, retirementResult],
      safety,
      full,
      warning: foundationError ? safeStatusError(foundationError) : null,
    };

    console.log(
      `Equipment Catalogue core ready; Equipment Sales commercial foundation ${
        full.ready ? "ready" : "pending"
      }.`
    );

    return lastSchemaStatus;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
      } catch (error) {
        console.warn("Could not release Equipment Sales migration lock:", error.message);
      }
    }
    connection.release();
  }
}

function runtimeBootstrapDisabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "test" ||
    String(process.env.DISABLE_EQUIPMENT_SALES_RUNTIME_BOOTSTRAP || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function scheduleEquipmentSalesRuntimeBootstrap(delayMs = RUNTIME_BOOT_DELAY_MS) {
  if (runtimeBootstrapDisabled() || runtimeBootstrapReady || runtimeBootstrapTimer) {
    return false;
  }

  runtimeBootstrapTimer = setTimeout(async () => {
    runtimeBootstrapTimer = null;

    try {
      const status = await ensureEquipmentSalesSchema();
      runtimeBootstrapReady = Boolean(status?.core_ready);
      console.log(
        `Equipment Sales finalization runtime is ready for catalogue=${
          status?.core_ready ? "yes" : "no"
        }, commercial=${status?.full_ready ? "yes" : "pending"}.`
      );

      if (!status?.full_ready) {
        scheduleEquipmentSalesRuntimeBootstrap(RUNTIME_RETRY_DELAY_MS);
      }
    } catch (error) {
      runtimeBootstrapReady = false;
      lastSchemaStatus = {
        core_ready: false,
        full_ready: false,
        error: safeStatusError(error),
      };
      console.error(
        "Equipment Sales finalization runtime bootstrap failed; existing workspaces remain available:",
        error.message
      );
      scheduleEquipmentSalesRuntimeBootstrap(RUNTIME_RETRY_DELAY_MS);
    }
  }, Math.max(1000, Number(delayMs) || RUNTIME_BOOT_DELAY_MS));

  runtimeBootstrapTimer.unref?.();
  return true;
}

function getEquipmentSalesSchemaStatus() {
  return lastSchemaStatus;
}

scheduleEquipmentSalesRuntimeBootstrap();

module.exports = {
  MIGRATION_NAME,
  MIGRATION_FILE,
  RETIREMENT_MIGRATION_NAME,
  RETIREMENT_MIGRATION_FILE,
  CORE_REPAIR_MIGRATION_NAME,
  FOUNDATION_MIGRATION,
  RETIREMENT_MIGRATION,
  ensureEquipmentSalesSchema,
  ensureMigrationRegistryShape,
  ensureCatalogueCoreSchema,
  executeMigration,
  getEquipmentSalesSchemaStatus,
  normalizeFoundationSqlForProduction,
  removeAnsiQuotesForMigration,
  scheduleEquipmentSalesRuntimeBootstrap,
  splitSqlStatements,
  tableExists,
  verifyCatalogueCore,
  verifyFoundation,
  verifyFoundationCore,
  verifyFoundationSafety,
  verifyRetirement,
};
