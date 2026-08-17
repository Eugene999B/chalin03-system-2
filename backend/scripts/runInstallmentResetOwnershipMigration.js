const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE = "20260729_EQUIPMENT_FINANCE_COMPLETE";
const MIGRATION = "20260817_installment_reset_ownership";
const LOCK = "chalin03:installment-reset-ownership-migration";

function enabled(value) { return ["1","true","yes","on"].includes(String(value || "").trim().toLowerCase()); }
function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}
function ssl() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  return ca ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true } : { rejectUnauthorized: !["0","false","no","off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
}
function statements(text) {
  return String(text || "").split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
}
function gate() {
  if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") throw new Error("Installment ownership migration requires NODE_ENV=production.");
  if (!enabled(process.env.CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED)) throw new Error("CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=true is required.");
  if (!enabled(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) throw new Error("CHALIN03_SIGNED_BACKUP_CONFIRMED=true is required.");
  if (!enabled(process.env.CHALIN03_SQL_BACKUP_CONFIRMED)) throw new Error("CHALIN03_SQL_BACKUP_CONFIRMED=true is required.");
  if (String(process.env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE) throw new Error(`CHALIN03_MIGRATION_RELEASE=${RELEASE} is required.`);
}
async function main() {
  gate();
  const db = await mysql.createConnection({ host: required("DB_HOST","MYSQLHOST"), port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306), user: required("DB_USER","MYSQLUSER"), password: required("DB_PASSWORD","MYSQLPASSWORD"), database: required("DB_NAME","MYSQLDATABASE"), ssl: ssl(), connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000), multipleStatements: false, timezone: "Z" });
  let locked = false;
  try {
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
    const [[current]] = await db.query("SELECT DATABASE() AS database_name");
    const actual = String(current?.database_name || "").trim();
    if (!expected || expected !== actual) throw new Error(`Connected database ${actual} does not match CHALIN03_EXPECTED_DATABASE.`);
    const [[lock]] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK]);
    locked = Number(lock?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire Installment ownership migration lock.");

    const migrationPath = path.resolve(__dirname, "../../database/migrations/20260817_installment_reset_ownership.sql");
    const verifyPath = path.resolve(__dirname, "../../database/migrations/20260817_installment_reset_ownership_verify.sql");
    for (const statement of statements(fs.readFileSync(migrationPath,"utf8"))) await db.query(statement);
    const results = [];
    for (const statement of statements(fs.readFileSync(verifyPath,"utf8"))) { const [rows] = await db.query(statement); results.push(rows); }
    if (!results[0]?.[0] || results[0][0].migration_name !== MIGRATION) throw new Error("Ownership migration record was not verified.");
    if (Number(results[1]?.[0]?.missing_ownership_columns || 1) !== 0) throw new Error("Ownership registry columns are incomplete.");
    if (Number(results[2]?.[0]?.missing_ownership_indexes || 1) !== 0) throw new Error("Ownership registry indexes are incomplete.");
    console.log(`Verified ${MIGRATION} on ${actual}.`);
  } finally {
    if (locked) { try { await db.query("SELECT RELEASE_LOCK(?)", [LOCK]); } catch (_) {} }
    await db.end();
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });
