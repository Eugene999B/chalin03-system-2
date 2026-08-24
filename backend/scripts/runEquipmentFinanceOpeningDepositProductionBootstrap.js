const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE = "20260729_EQUIPMENT_FINANCE_COMPLETE";
const LOCK = "chalin03:equipment-finance:opening-deposit-bootstrap";

const PLAN = Object.freeze([
  {
    name: "20260729_equipment_credit_application_foundation",
    migration: "20260729_equipment_credit_application_foundation.sql",
    verifier: "20260729_equipment_credit_application_foundation_verify.sql",
  },
  {
    name: "20260729_equipment_finance_agreement_activation",
    migration: "20260729_equipment_finance_agreement_activation.sql",
    verifier: "20260729_equipment_finance_agreement_activation_verify.sql",
  },
  {
    name: "20260729_equipment_finance_deposit_reservation",
    migration: "20260729_equipment_finance_deposit_reservation.sql",
    verifier: "20260729_equipment_finance_deposit_reservation_verify.sql",
  },
  {
    name: "20260805_equipment_finance_opening_deposit_foundation_repair",
    migration: "20260805_equipment_finance_opening_deposit_foundation_repair.sql",
    verifier: "20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql",
  },
  {
    name: "20260803_equipment_finance_phase4_deposit_reservation_integrity",
    migration: "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql",
    verifier: "20260803_equipment_finance_phase4_deposit_reservation_integrity_verify.sql",
  },
]);

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function required(name, fallback) {
  const value = process.env[name] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function ssl() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (ca) return { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true };
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
}

function gate() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Finance opening-deposit bootstrap requires NODE_ENV=production.");
  }
  if (!enabled(process.env.CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED)) {
    throw new Error("CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=true is required.");
  }
  if (!enabled(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("CHALIN03_SIGNED_BACKUP_CONFIRMED=true is required.");
  }
  if (!enabled(process.env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
    throw new Error("CHALIN03_SQL_BACKUP_CONFIRMED=true is required.");
  }
  if (String(process.env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE) {
    throw new Error(`CHALIN03_MIGRATION_RELEASE=${RELEASE} is required.`);
  }
}

function migrationDirectory() {
  const candidates = [
    path.resolve(__dirname, "../../database/migrations"),
    path.resolve(__dirname, "../database/migrations"),
  ];
  const directory = candidates.find((candidate) => fs.existsSync(candidate));
  if (!directory) throw new Error(`Finance migration directory is missing. Checked: ${candidates.join(", ")}`);
  return directory;
}

function readSql(filename) {
  const filePath = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved Finance SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function hasExecutableSql(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:--|#).*$/, ""))
    .join("\n")
    .trim().length > 0;
}

function splitSql(text) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (hasExecutableSql(buffer)) throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      buffer = "";
      delimiter = match[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (hasExecutableSql(statement)) statements.push(statement);
    buffer = "";
  }
  if (hasExecutableSql(buffer)) throw new Error("SQL script ended with an incomplete statement.");
  return statements;
}

async function execute(connection, statements, label) {
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${statements.length}: ${error.message}`;
      throw error;
    }
  }
  return results;
}

function verifyGeneric(plan, results) {
  if (!results.length) throw new Error(`${plan.name} verifier returned no result sets.`);
  const migrationRows = results[0];
  if (!migrationRows.length || migrationRows[0]?.migration_name !== plan.name) {
    throw new Error(`${plan.name} migration record was not verified.`);
  }
  for (let index = 1; index < results.length; index += 1) {
    const row = results[index]?.[0];
    if (!row) throw new Error(`${plan.name} verifier returned an empty result set at position ${index + 1}.`);
    const numericProblems = Object.entries(row).filter(([, value]) => {
      const number = Number(value);
      return Number.isFinite(number);
    });
    for (const [key, value] of numericProblems) {
      if (Number(value) !== 0) {
        throw new Error(`${plan.name} verifier returned ${key}=${value}; expected 0.`);
      }
    }
  }
}

async function main() {
  gate();
  const connection = await mysql.createConnection({
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    ssl: ssl(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  });

  let locked = false;
  try {
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    if (!expected || databaseName !== expected) {
      throw new Error(`Connected database ${databaseName || "(unknown)"} does not match CHALIN03_EXPECTED_DATABASE=${expected || "(unset)"}.`);
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance opening-deposit bootstrap lock.");

    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Finance opening-deposit bootstrap release: ${RELEASE}`);

    for (const plan of PLAN) {
      const verifier = splitSql(readSql(plan.verifier));
      let ready = false;
      try {
        const existing = await execute(connection, verifier, `Verifier ${plan.name}`);
        verifyGeneric(plan, existing);
        ready = true;
      } catch (error) {
        console.log(`Applying approved idempotent repair for ${plan.name}: ${error.message}`);
      }

      if (!ready) {
        await execute(connection, splitSql(readSql(plan.migration)), `Migration ${plan.name}`);
        const verified = await execute(connection, verifier, `Verifier ${plan.name}`);
        verifyGeneric(plan, verified);
      }

      console.log(`Verified ${plan.name}.`);
    }

    console.log("Opening Deposit production bootstrap completed successfully.");
  } finally {
    if (locked) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK]); } catch (_) {}
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Equipment Finance Opening Deposit production bootstrap failed.");
  console.error(error.message);
  process.exit(1);
});
