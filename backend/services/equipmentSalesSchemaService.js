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
const LOCK_NAME = "chalin03_equipment_sales_finalization_v2";
const RUNTIME_BOOT_DELAY_MS = 15 * 1000;
const RUNTIME_RETRY_DELAY_MS = 5 * 60 * 1000;

const MIGRATIONS = [
  {
    name: MIGRATION_NAME,
    file: MIGRATION_FILE,
    verify: verifyFoundation,
  },
  {
    name: RETIREMENT_MIGRATION_NAME,
    file: RETIREMENT_MIGRATION_FILE,
    verify: verifyRetirement,
  },
];

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

async function migrationsTableExists(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
  );
  return Number(rows[0]?.total || 0) === 1;
}

async function migrationApplied(connection, migrationName) {
  if (!(await migrationsTableExists(connection))) return false;

  const [rows] = await connection.query(
    "SELECT id FROM schema_migrations WHERE migration_name = ? LIMIT 1",
    [migrationName]
  );
  return rows.length > 0;
}

async function verifyFoundation(connection) {
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
    throw new Error("Equipment Sales foundation verification found missing tables.");
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
    throw new Error("Equipment Sales foundation verification found missing columns.");
  }

  const expectedTriggers = [
    "trg_hire_contract_asset_sale_guard_before_insert",
    "trg_hire_contract_asset_sale_guard_before_update",
    "trg_equipment_sale_agreement_hire_guard_before_insert",
    "trg_equipment_sale_agreement_hire_guard_before_update",
  ];
  const [triggerRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${expectedTriggers.map(() => "?").join(",")})`,
    expectedTriggers
  );
  if (Number(triggerRows[0]?.total || 0) !== expectedTriggers.length) {
    throw new Error("Equipment Sales foundation verification found missing sale/Hire guards.");
  }
}

async function verifyRetirement(connection) {
  const expectedTriggers = [
    "trg_spare_parts_installment_retired_sales_insert",
    "trg_spare_parts_installment_retired_agreement_insert",
  ];

  const [triggerRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (?, ?)`,
    expectedTriggers
  );

  if (Number(triggerRows[0]?.total || 0) !== expectedTriggers.length) {
    throw new Error("Spare Parts installment retirement verification found missing guards.");
  }

  if (!(await migrationApplied(connection, RETIREMENT_MIGRATION_NAME))) {
    throw new Error("Spare Parts installment retirement migration marker is missing.");
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

async function executeMigration(connection, migration) {
  if (!fs.existsSync(migration.file)) {
    throw new Error(`Required migration file is missing: ${migration.file}`);
  }

  const statements = splitSqlStatements(fs.readFileSync(migration.file, "utf8"));
  if (statements.length < 4) {
    throw new Error(`Migration ${migration.name} did not contain the expected statements.`);
  }

  for (const statement of statements) {
    await connection.query(statement);
  }

  await migration.verify(connection);
  return statements.length;
}

async function ensureOneMigration(connection, migration) {
  const alreadyApplied = await migrationApplied(connection, migration.name);

  if (alreadyApplied) {
    try {
      await migration.verify(connection);
      return { name: migration.name, applied: false, repaired: false, statement_count: 0 };
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
      throw new Error("Could not acquire the Equipment Sales finalization migration lock.");
    }

    await removeAnsiQuotesForMigration(connection);

    const results = [];
    for (const migration of MIGRATIONS) {
      results.push(await ensureOneMigration(connection, migration));
    }

    await verifyFoundation(connection);
    await verifyRetirement(connection);
    startEquipmentSalesReminderScheduler();

    const applied = results.some((result) => result.applied || result.repaired);
    if (applied) {
      console.log(
        `Equipment Sales finalization migrations verified: ${results
          .map((result) => `${result.name}:${result.applied ? "applied" : result.repaired ? "repaired" : "ready"}`)
          .join(", ")}.`
      );
    }

    return {
      applied,
      skipped: !applied,
      reason: applied ? null : "already_applied",
      migrations: results,
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
  removeAnsiQuotesForMigration,
  scheduleEquipmentSalesRuntimeBootstrap,
  splitSqlStatements,
  verifyFoundation,
  verifyRetirement,
};
