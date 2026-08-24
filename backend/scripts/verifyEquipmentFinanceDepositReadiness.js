const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const REQUIRED_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "deposit_required",
    "deposit_received",
    "reservation_activated_at",
    "reservation_activated_by",
  ],
  equipment_sale_payments: [
    "credit_application_id",
    "payment_stage",
    "payment_category",
    "idempotency_key",
    "reservation_effect",
  ],
});

const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
]);

const REQUIRED_MIGRATION = "20260803_equipment_finance_phase4_deposit_reservation_integrity";

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`);
  return value;
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: String(process.env.DB_SSL || "").trim().toLowerCase() === "true" ? { rejectUnauthorized: true } : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

async function main() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    const [[dbRow]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(dbRow?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
    if (!databaseName || !expected || databaseName !== expected) {
      throw new Error(`Production database identity check failed: connected=${databaseName || "<none>"}, expected=${expected || "<none>"}.`);
    }

    const tableNames = Object.keys(REQUIRED_COLUMNS);
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tableNames.map(() => "?").join(",")})`,
      tableNames
    );
    const foundColumns = new Set(columnRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    const missingColumns = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const column of columns) if (!foundColumns.has(`${table}.${column}`)) missingColumns.push(`${table}.${column}`);
    }

    const [triggerRows] = await connection.query(
      `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME IN (${REQUIRED_TRIGGERS.map(() => "?").join(",")})`,
      REQUIRED_TRIGGERS
    );
    const installedTriggers = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
    const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !installedTriggers.has(name));

    const [[schemaMigrationsTable]] = await connection.query(
      `SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'`
    );
    let missingMigrations = [];
    if (Number(schemaMigrationsTable?.present || 0) !== 1) {
      missingMigrations = [REQUIRED_MIGRATION];
    } else {
      const [[migrationRow]] = await connection.query("SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?", [REQUIRED_MIGRATION]);
      if (Number(migrationRow?.applied || 0) !== 1) missingMigrations = [REQUIRED_MIGRATION];
    }

    const ready = missingColumns.length === 0 && missingTriggers.length === 0 && missingMigrations.length === 0;
    console.log(JSON.stringify({ ready, database_name: databaseName, missing_columns: missingColumns, missing_triggers: missingTriggers, missing_migrations: missingMigrations }, null, 2));
    if (!ready) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Deposit readiness verification failed: ${error.message}`);
  process.exit(1);
});
