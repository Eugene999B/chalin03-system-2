"use strict";

const mysql = require("mysql2/promise");
require("dotenv").config();

const ACCEPTANCE_DATABASE_PATTERN = /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i;
const LEGACY_TABLES = Object.freeze([
  "products",
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "mining_sites",
  "fleet_assets",
  "hire_contracts",
  "equipment_sale_agreements",
]);

function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!String(value || "").trim()) {
    throw new Error(`Missing ${name}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function assertSafeAcceptanceTarget(env = process.env) {
  const database = String(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || ""
  ).trim();
  const environment = String(env.NODE_ENV || "test").trim().toLowerCase();

  if (environment === "production") {
    throw new Error("Acceptance preparation may never run with NODE_ENV=production.");
  }
  if (!ACCEPTANCE_DATABASE_PATTERN.test(database)) {
    throw new Error(
      "Acceptance preparation requires a dedicated database named chalin_one_acceptance or chalin_one_acceptance_<suffix>."
    );
  }

  return database;
}

function connectionOptions() {
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    timezone: "Z",
    multipleStatements: false,
  };
}

async function createLegacyFixture(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS users (
       id INT NOT NULL,
       full_name VARCHAR(180) NOT NULL,
       role VARCHAR(50) NOT NULL DEFAULT 'admin',
       PRIMARY KEY (id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await connection.query(
    `INSERT INTO users (id, full_name, role) VALUES
       (1, 'Acceptance Author', 'admin'),
       (2, 'Acceptance Reviewer', 'manager'),
       (3, 'Acceptance Publisher', 'admin')
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name),
       role = VALUES(role)`
  );

  for (const tableName of LEGACY_TABLES) {
    if (!/^[a-z0-9_]+$/i.test(tableName)) {
      throw new Error(`Unsafe acceptance table name: ${tableName}`);
    }
    await connection.query(
      `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
         id INT NOT NULL,
         acceptance_marker VARCHAR(100) NOT NULL,
         PRIMARY KEY (id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await connection.query(
      `INSERT INTO \`${tableName}\` (id, acceptance_marker)
       VALUES (1, 'legacy-row-must-survive')
       ON DUPLICATE KEY UPDATE acceptance_marker = VALUES(acceptance_marker)`
    );
  }
}

async function verifyFixture(connection) {
  const counts = {};
  for (const tableName of ["users", ...LEGACY_TABLES]) {
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS row_count FROM \`${tableName}\``
    );
    counts[tableName] = Number(row?.row_count || 0);
    if (counts[tableName] < 1) {
      throw new Error(`Acceptance fixture table ${tableName} is empty.`);
    }
  }
  return counts;
}

async function prepareChalinOneAcceptanceDatabase() {
  const database = assertSafeAcceptanceTarget();
  const connection = await mysql.createConnection(connectionOptions());
  try {
    await createLegacyFixture(connection);
    const counts = await verifyFixture(connection);
    console.log(
      `Prepared isolated CHALIN ONE acceptance database ${database}: ${Object.keys(counts).length} legacy fixture tables verified.`
    );
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  prepareChalinOneAcceptanceDatabase().catch((error) => {
    console.error(`CHALIN ONE acceptance database preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACCEPTANCE_DATABASE_PATTERN,
  LEGACY_TABLES,
  assertSafeAcceptanceTarget,
  createLegacyFixture,
  prepareChalinOneAcceptanceDatabase,
  verifyFixture,
};
