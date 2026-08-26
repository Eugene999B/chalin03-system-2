const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:opening-deposit-foundation-repair";
const SQL_FILE = "20260825_equipment_finance_opening_deposit_reservation_gate_fix.sql";

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`);
  }
  return value;
}

function connectionOptions() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslEnabled
      ? encodedCa
        ? { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true }
        : { rejectUnauthorized }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (buffer.trim()) throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      delimiter = match[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }
  if (buffer.trim()) throw new Error("SQL script ended with an incomplete statement.");
  return statements;
}

async function finalize() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
    if (!databaseName || !expected || databaseName !== expected) {
      throw new Error(`Connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`);
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Opening Deposit trigger finalization lock.");

    const sqlPath = path.resolve(__dirname, "../../database/migrations", SQL_FILE);
    if (!fs.existsSync(sqlPath)) throw new Error(`Approved Opening Deposit trigger fix is missing: ${sqlPath}`);
    for (const statement of splitSqlScript(fs.readFileSync(sqlPath, "utf8"))) {
      await connection.query(statement);
    }

    const [[trigger]] = await connection.query(
      `SELECT TRIGGER_NAME, ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME = 'trg_equipment_finance_reservation_gate_before_insert'`
    );
    const action = String(trigger?.ACTION_STATEMENT || "");
    if (!/v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/i.test(action)) {
      throw new Error("The Opening Deposit reservation trigger did not reach the approved final definition.");
    }

    console.log(JSON.stringify({ verified: true, database_name: databaseName, trigger: trigger.TRIGGER_NAME }, null, 2));
    return { verified: true, database_name: databaseName, trigger: trigger.TRIGGER_NAME };
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  finalize().catch((error) => {
    console.error("Opening Deposit reservation trigger finalization failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { finalize };
