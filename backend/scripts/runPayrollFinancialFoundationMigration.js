const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_FILE = "20260810_payroll_financial_foundation.sql";
const VERIFY_FILE = "20260810_payroll_financial_foundation_verify.sql";
const MIGRATION_LOCK = "chalin03:payroll-financial-foundation:20260810";
const PACKAGED_MIGRATION_DIR = path.resolve(__dirname, "../migrations");

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function sslConfig() {
  if (!enabled(process.env.DB_SSL)) return undefined;
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) return { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase()) };
}

function assertAuthorization() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    if (!enabled(process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED)) {
      throw new Error("Set CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED=true only for the approved payroll foundation release.");
    }
    if (!enabled(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
      throw new Error("A fresh signed full-system backup must be validated before the payroll foundation migration.");
    }
    if (String(process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE || "") !== "20260810_PAYROLL_FOUNDATION") {
      throw new Error("Set CHALIN03_PAYROLL_MIGRATION_RELEASE=20260810_PAYROLL_FOUNDATION for this exact migration.");
    }
  }
}

function splitSql(sqlText) {
  return String(sqlText || "")
    .replace(/\r\n/g, "\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function migrationPath(filename) {
  const resolved = path.resolve(PACKAGED_MIGRATION_DIR, filename);
  if (!resolved.startsWith(`${PACKAGED_MIGRATION_DIR}${path.sep}`)) {
    throw new Error("Payroll migration filename escaped the packaged migration directory.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Packaged payroll migration file is missing: ${resolved}`);
  }
  return resolved;
}

function assertPackagedMigrationReady() {
  for (const filename of [MIGRATION_FILE, VERIFY_FILE]) {
    const resolved = migrationPath(filename);
    const sql = fs.readFileSync(resolved, "utf8");
    if (!sql.trim()) throw new Error(`Packaged payroll migration file is empty: ${resolved}`);
  }
}

async function execute(connection, filename) {
  const sql = fs.readFileSync(migrationPath(filename), "utf8");
  const resultSets = [];
  for (const statement of splitSql(sql)) {
    const [rows] = await connection.query(statement);
    if (Array.isArray(rows)) resultSets.push(rows);
  }
  return resultSets;
}

async function run() {
  assertAuthorization();
  assertPackagedMigrationReady();
  const connection = await mysql.createConnection({
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslConfig(),
    multipleStatements: false,
    timezone: "Z",
  });
  let locked = false;
  try {
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [MIGRATION_LOCK]);
    locked = Number(lockRow?.acquired) === 1;
    if (!locked) throw new Error("Could not acquire the payroll foundation migration lock.");
    await execute(connection, MIGRATION_FILE);
    const results = await execute(connection, VERIFY_FILE);
    const migrationRow = results.find((rows) => rows.some((row) => row.migration_name === "20260810_payroll_financial_foundation"));
    const missingTableRow = results.flat().find((row) => Object.hasOwn(row, "missing_payroll_tables"));
    const violationRows = results.flat().filter((row) => Object.keys(row).some((key) => key.endsWith("_mismatches") || key.startsWith("self_approved_")));
    if (!migrationRow || Number(missingTableRow?.missing_payroll_tables) !== 0) {
      throw new Error("Payroll foundation migration verification did not confirm all required tables.");
    }
    for (const row of violationRows) {
      for (const value of Object.values(row)) {
        if (Number(value) !== 0) throw new Error("Payroll foundation verification found category or maker/checker violations.");
      }
    }
    console.log("Payroll financial foundation migration and verification passed.");
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_FILE,
  PACKAGED_MIGRATION_DIR,
  VERIFY_FILE,
  assertAuthorization,
  assertPackagedMigrationReady,
  migrationPath,
  splitSql,
  run,
};
