const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_NAME = "20260826_customer_feature_controls";
const LOCK_NAME = "chalin03:customer-feature-controls:20260826";

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return String(value).trim();
}

function connectionOptions() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase();
  let ssl;
  if (sslEnabled === "true") {
    const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
    ssl = ca
      ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true }
      : { rejectUnauthorized: true };
  }

  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

function migrationSql() {
  return fs.readFileSync(
    path.resolve(__dirname, "../../database/migrations/20260826_customer_feature_controls.sql"),
    "utf8"
  );
}

async function main() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Customer feature controls production migration requires NODE_ENV=production.");
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(databaseRow?.database_name || "").trim();
    const expected = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();

    if (!databaseName || (expected && databaseName !== expected)) {
      throw new Error(
        `Refusing customer feature controls migration: connected database ${databaseName || "<none>"} does not match ${expected || "the configured production database"}.`
      );
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) throw new Error("Could not acquire customer feature controls migration lock.");

    await connection.query(migrationSql());

    const [columns] = await connection.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'customer_feature_controls'
         AND COLUMN_NAME IN ('branch_id','customer_identity_editing_enabled','customer_merge_enabled','created_at','updated_at')`
    );

    if (columns.length !== 5) {
      throw new Error(`Customer feature controls migration verification failed: expected 5 columns, found ${columns.length}.`);
    }

    console.log(`Customer feature controls migration ${MIGRATION_NAME} verified on ${databaseName}.`);
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]);
      } catch (error) {
        console.error("Warning: customer feature controls migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Customer feature controls production migration failed:", error);
  process.exit(1);
});
