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
const LOCK_NAME = "chalin03_equipment_sales_finalization_v3";
const RUNTIME_BOOT_DELAY_MS = 15 * 1000;
const RUNTIME_RETRY_DELAY_MS = 5 * 60 * 1000;

const FOUNDATION_MIGRATION = {
  name: MIGRATION_NAME,
  file: MIGRATION_FILE,
  verify: verifyFoundation,
  required: true,
};
const RETIREMENT_MIGRATION = {
  name: RETIREMENT_MIGRATION_NAME,
  file: RETIREMENT_MIGRATION_FILE,
  verify: verifyRetirement,
  required: false,
};

let runtimeBootstrapTimer = null;
let runtimeBootstrapReady = false;

if (!equipmentSalesRoutes.__chalin03FinalizationMounted) {
  equipmentSalesRoutes.use(equipmentSalesFinalizationRoutes);
  Object.defineProperty(equipmentSalesRoutes, "__chalin03FinalizationMounted", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
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

function removeTriggerBlock(sqlText, triggerName) {
  const escaped = triggerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(sqlText || "").replace(
    new RegExp(
      `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${escaped}\\s*\\$\\$[\\s\\S]*?END\\s*\\$\\$`,
      "i"
    ),
    `-- ${triggerName} skipped because its dependency table is not installed.`
  );
}

function normalizeFoundationSqlForProduction(sqlText) {
  return String(sqlText || "")
    // Column order is presentation-only. Removing AFTER clauses makes the
    // additive migration compatible with older but valid production schemas.
    .replace(/\s+AFTER\s+`?[A-Za-z0-9_]+`?/gi, "")
    // The legacy mapping table is useful even when the retired Spare Parts
    // installment module was never installed. Keep the source id as evidence
    // without making the new catalogue depend on the optional legacy table.
    .replace(
      /CONSTRAINT\s+fk_equipment_legacy_migration_legacy[\s\S]*?ON\s+DELETE\s+RESTRICT\s*,/i,
      ""
    );
}

async function preparedMigrationSql(connection, migration) {
  if (!fs.existsSync(migration.file)) {
    const error = new Error(`Required migration file is missing: ${migration.file}`);
    error.code = "EQUIPMENT_SALES_MIGRATION_FILE_MISSING";
    throw error;
  }

  let sqlText = fs.readFileSync(migration.file, "utf8");

  if (migration.name === MIGRATION_NAME) {
    sqlText = normalizeFoundationSqlForProduction(sqlText);

    if (!(await tableExists(connection, "hire_contract_assets"))) {
      for (const triggerName of [
        "trg_hire_contract_asset_sale_guard_before_insert",
        "trg_hire_contract_asset_sale_guard_before_update",
        "trg_equipment_sale_agreement_hire_guard_before_insert",
        "trg_equipment_sale_agreement_hire_guard_before_update",
      ]) {
        sqlText = removeTriggerBlock(sqlText, triggerName);
      }
    }
  }

  if (
    migration.name === RETIREMENT_MIGRATION_NAME &&
    !(await tableExists(connection, "installment_agreements"))
  ) {
    sqlText = removeTriggerBlock(
      sqlText,
      "trg_spare_parts_installment_retired_agreement_insert"
    );
  }

  return sqlText;
}

async function verifyFoundationCore(connection) {
  const expectedTables = [
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

  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${expectedTables.map(() => "?").join(",")})`,
    expectedTables
  );

  if (Number(tableRows[0]?.total || 0) !== expectedTables.length) {
    const error = new Error("Equipment Sales foundation verification found missing tables.");
    error.code = "EQUIPMENT_SALES_TABLES_MISSING";
    throw error;
  }

  const [columnRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (
         (TABLE_NAME = 'fleet_assets' AND COLUMN_NAME IN (
           'hire_location_id','operational_purpose','sale_status',
           'target_selling_price','standard_hire_rate','main_image_url'
         ))
         OR
         (TABLE_NAME = 'sms_log' AND COLUMN_NAME IN (
           'workspace_code','hire_location_id','entity_type','entity_id',
           'template_code','deduplication_key'
         ))
       )`
  );

  if (Number(columnRows[0]?.total || 0) !== 12) {
    const error = new Error("Equipment Sales foundation verification found missing columns.");
    error.code = "EQUIPMENT_SALES_COLUMNS_MISSING";
    throw error;
  }
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
  const [triggerRows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${expectedTriggers.map(() => "?").join(",")})`,
    expectedTriggers
  );
  const installed = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
  const missing = expectedTriggers.filter((name) => !installed.has(name));

  return {
    ready: missing.length === 0,
    skipped: false,
    missing,
    reason: missing.length ? "database_triggers_pending" : null,
  };
}

async function verifyFoundation(connection) {
  await verifyFoundationCore(connection);
  const safety = await verifyFoundationSafety(connection);

  if (!safety.ready && !safety.skipped) {
    console.warn(
      `Equipment Sales application safeguards are active, but database trigger reinforcement is pending: ${safety.missing.join(", ")}.`
    );
  }

  return safety;
}

async function verifyRetirement(connection) {
  const expectedTriggers = ["trg_spare_parts_installment_retired_sales_insert"];

  if (await tableExists(connection, "installment_agreements")) {
    expectedTriggers.push("trg_spare_parts_installment_retired_agreement_insert");
  }

  const [triggerRows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${expectedTriggers.map(() => "?").join(",")})`,
    expectedTriggers
  );
  const installed = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
  const missing = expectedTriggers.filter((name) => !installed.has(name));

  if (missing.length) {
    const error = new Error(
      `Spare Parts installment retirement verification found missing guards: ${missing.join(", ")}.`
    );
    error.code = "SPARE_PARTS_RETIREMENT_GUARDS_PENDING";
    throw error;
  }

  if (!(await migrationApplied(connection, RETIREMENT_MIGRATION_NAME))) {
    const error = new Error("Spare Parts installment retirement migration marker is missing.");
    error.code = "SPARE_PARTS_RETIREMENT_MARKER_MISSING";
    throw error;
  }
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

async function executeMigration(connection, migration) {
  const sqlText = await preparedMigrationSql(connection, migration);
  const statements = splitSqlStatements(sqlText);
  if (statements.length < 4) {
    const error = new Error(
      `Migration ${migration.name} did not contain the expected statements.`
    );
    error.code = "EQUIPMENT_SALES_MIGRATION_INCOMPLETE";
    throw error;
  }

  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      throw wrapMigrationError(error, migration, index);
    }
  }

  await migration.verify(connection);
  return statements.length;
}

async function ensureOneMigration(connection, migration) {
  const alreadyApplied = await migrationApplied(connection, migration.name);

  if (alreadyApplied) {
    try {
      await migration.verify(connection);
      return {
        name: migration.name,
        applied: false,
        repaired: false,
        statement_count: 0,
      };
    } catch (error) {
      console.warn(
        `Migration ${migration.name} was marked applied but verification failed; reapplying idempotently: ${error.message}`
      );
      const statementCount = await executeMigration(connection, migration);
      return {
        name: migration.name,
        applied: false,
        repaired: true,
        statement_count: statementCount,
      };
    }
  }

  const statementCount = await executeMigration(connection, migration);
  return {
    name: migration.name,
    applied: true,
    repaired: false,
    statement_count: statementCount,
  };
}

async function ensureOptionalMigration(connection, migration) {
  try {
    return await ensureOneMigration(connection, migration);
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

async function ensureEquipmentSalesSchema() {
  if (
    String(process.env.DISABLE_EQUIPMENT_SALES_STARTUP_MIGRATION || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    console.warn("Equipment Sales startup migrations are disabled by environment configuration.");
    return { applied: false, skipped: true, reason: "disabled", migrations: [] };
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [
      LOCK_NAME,
    ]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      const error = new Error(
        "Could not acquire the Equipment Sales finalization migration lock."
      );
      error.code = "EQUIPMENT_SALES_MIGRATION_LOCK_TIMEOUT";
      throw error;
    }

    await removeAnsiQuotesForMigration(connection);
    await ensureMigrationRegistryShape(connection);

    const foundationResult = await ensureOneMigration(
      connection,
      FOUNDATION_MIGRATION
    );
    await verifyFoundationCore(connection);

    const retirementResult = await ensureOptionalMigration(
      connection,
      RETIREMENT_MIGRATION
    );
    const safety = await verifyFoundationSafety(connection);

    if (!safety.ready && !safety.skipped) {
      console.warn(
        `Equipment Sales database trigger reinforcement remains pending: ${safety.missing.join(", ")}. Application transaction guards remain active.`
      );
    }

    startEquipmentSalesReminderScheduler();

    const results = [foundationResult, retirementResult];
    const applied = results.some(
      (result) => result.applied || result.repaired
    );

    console.log(
      `Equipment Sales catalogue foundation ready: ${results
        .map((result) =>
          `${result.name}:${
            result.pending
              ? "pending_optional"
              : result.applied
                ? "applied"
                : result.repaired
                  ? "repaired"
                  : "ready"
          }`
        )
        .join(", ")}.`
    );

    return {
      applied,
      skipped: !applied,
      reason: applied ? null : "already_applied",
      migrations: results,
      safety,
    };
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
    String(process.env.DISABLE_EQUIPMENT_SALES_STARTUP_MIGRATION || "")
      .trim()
      .toLowerCase() === "true" ||
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
      await ensureEquipmentSalesSchema();
      runtimeBootstrapReady = true;
      console.log("Equipment Sales finalization runtime is ready.");
    } catch (error) {
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

scheduleEquipmentSalesRuntimeBootstrap();

module.exports = {
  MIGRATION_NAME,
  MIGRATION_FILE,
  RETIREMENT_MIGRATION_NAME,
  RETIREMENT_MIGRATION_FILE,
  ensureEquipmentSalesSchema,
  ensureMigrationRegistryShape,
  normalizeFoundationSqlForProduction,
  removeAnsiQuotesForMigration,
  scheduleEquipmentSalesRuntimeBootstrap,
  splitSqlStatements,
  tableExists,
  verifyFoundation,
  verifyFoundationCore,
  verifyFoundationSafety,
  verifyRetirement,
};