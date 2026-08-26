const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:commitment-trigger-finalization";
const TRIGGER_NAME = "trg_equipment_finance_commitment_gate_before_update";

function env(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function options() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase());
  return {
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    ssl: sslEnabled ? (ca ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true } : { rejectUnauthorized }) : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

function splitSql(sql) {
  const out = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sql || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) { if (buffer.trim()) throw new Error("Incomplete SQL statement before DELIMITER."); delimiter = match[1]; continue; }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) out.push(statement);
    buffer = "";
  }
  if (buffer.trim()) throw new Error("SQL script ended with an incomplete statement.");
  return out;
}

async function main() {
  const db = await mysql.createConnection(options());
  let locked = false;
  try {
    const [[identity]] = await db.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
    if (!databaseName || databaseName !== expected) throw new Error(`Connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`);

    const [[lockRow]] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance commitment trigger finalization lock.");

    const sqlPath = path.resolve(__dirname, "../../database/migrations/20260826_equipment_finance_commitment_gate_finalization.sql");
    if (!fs.existsSync(sqlPath)) throw new Error(`Approved commitment trigger finalization SQL is missing: ${sqlPath}`);
    for (const statement of splitSql(fs.readFileSync(sqlPath, "utf8"))) await db.query(statement);

    const [[trigger]] = await db.query(
      `SELECT TRIGGER_NAME, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
      [TRIGGER_NAME]
    );
    const action = String(trigger?.ACTION_STATEMENT || "");
    const valid = /OLD\.equipment_commitment_status\s*<>\s*['\"]reserved['\"]/i.test(action)
      && /NEW\.equipment_commitment_status\s*=\s*['\"]reserved['\"]/i.test(action)
      && /NEW\.agreement_status\s+IN\s*\(/i.test(action);
    if (!valid) throw new Error("Finance commitment trigger did not reach the canonical final definition.");

    console.log(JSON.stringify({ verified: true, database_name: databaseName, trigger: TRIGGER_NAME }, null, 2));
  } finally {
    if (locked) { try { await db.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {} }
    await db.end();
  }
}

main().catch((error) => { console.error("Finance commitment trigger finalization failed."); console.error(error.message); process.exit(1); });
