const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:opening-deposit-deploy-repair";
const FOUNDATION_FILE = "20260805_equipment_finance_opening_deposit_foundation_repair.sql";
const INTEGRITY_FILE = "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql";
const REQUIRED_TRIGGERS = Object.freeze([
  ["trg_equipment_finance_payment_gate_before_insert", "INSERT", "BEFORE"],
  ["trg_equipment_finance_reservation_gate_before_insert", "INSERT", "BEFORE"],
  ["trg_equipment_finance_commitment_gate_before_update", "UPDATE", "BEFORE"],
]);

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function sslConfig() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) return { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true };
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function commentFree(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(?:--|#).*$/gm, "")
    .trim();
}

function splitSql(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (commentFree(buffer)) {
        throw new Error("Opening Deposit SQL contained an unfinished statement before DELIMITER.");
      }
      buffer = "";
      delimiter = match[1];
      continue;
    }

    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;

    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement && commentFree(statement)) statements.push(statement);
    buffer = "";
  }

  if (commentFree(buffer)) {
    throw new Error("Opening Deposit SQL ended with an unfinished statement.");
  }
  return statements;
}

function migrationDirectory() {
  const candidates = [
    path.resolve(__dirname, "../database/migrations"),
    path.resolve(__dirname, "../../database/migrations"),
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw new Error(`Opening Deposit migration directory missing. Checked: ${candidates.join(", ")}`);
  }
  return existing;
}

function readMigration(filename) {
  const filePath = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Opening Deposit migration missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function executeStatements(connection, statements, label) {
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1}/${statements.length}: ${error.message}`;
      throw error;
    }
  }
}

async function assertDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const actual = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!actual || !expected || actual !== expected) {
    throw new Error(`Opening Deposit production database identity check failed: ${actual || "unknown"}.`);
  }
  return actual;
}

async function ensureAgreementActivationPrerequisites(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_sale_agreements'
        AND COLUMN_NAME IN ('credit_application_id','activation_source','equipment_commitment_status')`
  );
  const present = new Set(rows.map((row) => row.COLUMN_NAME));

  const definitions = new Map([
    ["credit_application_id", "BIGINT NULL AFTER agreement_number"],
    [
      "activation_source",
      "ENUM('legacy','approved_credit_application') NOT NULL DEFAULT 'legacy' AFTER credit_application_id",
    ],
    [
      "equipment_commitment_status",
      "ENUM('not_reserved','reserved','locked','released') NOT NULL DEFAULT 'not_reserved' AFTER activation_source",
    ],
  ]);

  for (const [column, definition] of definitions) {
    if (present.has(column)) continue;
    await connection.query(
      `ALTER TABLE equipment_sale_agreements ADD COLUMN ${column} ${definition}`
    );
  }
}

async function verify(connection) {
  const [columns] = await connection.query(`
    SELECT TABLE_NAME, COLUMN_NAME
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'equipment_sale_agreements' AND COLUMN_NAME IN ('credit_application_id','activation_source','equipment_commitment_status','deposit_completed_at','deposit_completed_by','reservation_activated_at','reservation_activated_by'))
         OR (TABLE_NAME = 'equipment_sale_payments' AND COLUMN_NAME IN ('credit_application_id','payment_stage','reservation_effect','idempotency_key')))
  `);
  const requiredColumns = [
    ["equipment_sale_agreements", "credit_application_id"],
    ["equipment_sale_agreements", "activation_source"],
    ["equipment_sale_agreements", "equipment_commitment_status"],
    ["equipment_sale_agreements", "deposit_completed_at"],
    ["equipment_sale_agreements", "deposit_completed_by"],
    ["equipment_sale_agreements", "reservation_activated_at"],
    ["equipment_sale_agreements", "reservation_activated_by"],
    ["equipment_sale_payments", "idempotency_key"],
    ["equipment_sale_payments", "credit_application_id"],
    ["equipment_sale_payments", "payment_stage"],
    ["equipment_sale_payments", "reservation_effect"],
  ];
  const columnSet = new Set(columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const missingColumns = requiredColumns.filter(([table, column]) => !columnSet.has(`${table}.${column}`));
  if (missingColumns.length) {
    throw new Error(`Opening Deposit columns still missing: ${missingColumns.map(([t,c]) => `${t}.${c}`).join(", ")}`);
  }

  const [indexes] = await connection.query(`
    SELECT TABLE_NAME, INDEX_NAME
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'equipment_sale_agreements' AND INDEX_NAME = 'idx_equipment_finance_deposit_reservation')
         OR (TABLE_NAME = 'equipment_sale_payments' AND INDEX_NAME IN ('uq_equipment_finance_payment_idempotency','idx_equipment_finance_payment_stage','idx_equipment_finance_payment_application')))
  `);
  const indexSet = new Set(indexes.map((row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`));
  const requiredIndexes = [
    ["equipment_sale_agreements", "idx_equipment_finance_deposit_reservation"],
    ["equipment_sale_payments", "uq_equipment_finance_payment_idempotency"],
    ["equipment_sale_payments", "idx_equipment_finance_payment_stage"],
    ["equipment_sale_payments", "idx_equipment_finance_payment_application"],
  ];
  const missingIndexes = requiredIndexes.filter(([table, index]) => !indexSet.has(`${table}.${index}`));
  if (missingIndexes.length) throw new Error(`Opening Deposit indexes still missing: ${missingIndexes.map(([t,i]) => `${t}.${i}`).join(", ")}`);

  const [triggers] = await connection.query(`
    SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING
      FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${REQUIRED_TRIGGERS.map(() => "?").join(",")})
  `, REQUIRED_TRIGGERS.map(([name]) => name));
  const triggerMap = new Map(triggers.map((row) => [row.TRIGGER_NAME, row]));
  for (const [name, event, timing] of REQUIRED_TRIGGERS) {
    const row = triggerMap.get(name);
    if (!row) throw new Error(`Opening Deposit trigger missing: ${name}.`);
    if (row.EVENT_MANIPULATION !== event || row.ACTION_TIMING !== timing) {
      throw new Error(`Opening Deposit trigger ${name} has invalid timing.`);
    }
  }
}

async function main() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await assertDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire Opening Deposit deployment lock.");

    await ensureAgreementActivationPrerequisites(connection);
    await executeStatements(connection, splitSql(readMigration(FOUNDATION_FILE)), "Opening Deposit foundation");
    await executeStatements(connection, splitSql(readMigration(INTEGRITY_FILE)), "Opening Deposit integrity");
    await verify(connection);
    console.log(`Opening Deposit deployment repair verified on ${databaseName}.`);
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Opening Deposit deployment repair failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { commentFree, splitSql, main, ensureAgreementActivationPrerequisites };
