const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_LOCK = "chalin03:equipment-finance:phase4";
const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_asset_returns",
  "equipment_finance_correction_policies",
  "equipment_finance_correction_policy_history",
  "equipment_finance_correction_requests",
  "equipment_finance_ledger_entries",
]);
const RELEASES = Object.freeze([
  {
    record: "equipment_finance_phase4_corrections_settlements",
    migration: "20260801_equipment_finance_phase4_corrections_settlements.sql",
    verifier: "20260801_equipment_finance_phase4_corrections_settlements_verify.sql",
    validate: validateCorrectionSchema,
  },
  {
    record: "equipment_finance_phase4_balance_guard",
    migration: "20260801_equipment_finance_phase4_balance_guard.sql",
    verifier: "20260801_equipment_finance_phase4_balance_guard_verify.sql",
    validate: validateBalanceGuard,
  },
  {
    record: "20260803_equipment_finance_phase4_deposit_reservation_integrity",
    migration: "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql",
    verifier: "20260803_equipment_finance_phase4_deposit_reservation_integrity_verify.sql",
    validate: validateDepositReservationIntegrity,
  },
]);

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  const disabled = ["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return { rejectUnauthorized: !disabled };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function hasExecutableSql(sqlText) {
  return String(sqlText || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:--|#).*$/, ""))
    .join("\n")
    .trim().length > 0;
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (hasExecutableSql(buffer)) {
        throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      }
      buffer = "";
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }

  if (hasExecutableSql(buffer)) {
    throw new Error("SQL script ended with an incomplete statement.");
  }
  return statements;
}

function readMigrationFile(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved Phase 4 SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function migrationRecordExists(connection, record) {
  const [[tableRow]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
  );
  if (Number(tableRow?.present || 0) !== 1) return false;
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [record]
  );
  return Number(row?.applied || 0) === 1;
}

async function executeStatements(connection, statements, label) {
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

function validateCorrectionSchema(results, record) {
  if (results.length !== 5) {
    throw new Error(`Phase 4 correction verifier returned ${results.length} result sets instead of 5.`);
  }
  const [migrationRows, tableRows, policyRows, columnRows, orphanRows] = results;
  if (migrationRows.length !== 1 || migrationRows[0].migration_name !== record) {
    throw new Error("Phase 4 correction migration record was not verified.");
  }
  const tables = new Set(tableRows.map((row) => String(row.TABLE_NAME || "")));
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`Phase 4 tables are missing: ${missing.join(", ")}.`);
  if (Number(policyRows[0]?.policy_rows || 0) !== 1) {
    throw new Error("The Phase 4 correction policy singleton was not verified.");
  }
  if (columnRows.length < 35) {
    throw new Error("The Phase 4 correction ledger columns are incomplete.");
  }
  if (Number(orphanRows[0]?.orphan_ledger_entries || 0) !== 0) {
    throw new Error("The Phase 4 verifier found orphan ledger entries.");
  }
}

function validateBalanceGuard(results, record) {
  if (results.length !== 3) {
    throw new Error(`Phase 4 balance verifier returned ${results.length} result sets instead of 3.`);
  }
  const [migrationRows, triggerRows, invalidRows] = results;
  if (migrationRows.length !== 1 || migrationRows[0].migration_name !== record) {
    throw new Error("Phase 4 balance-guard migration record was not verified.");
  }
  if (
    triggerRows.length !== 1 ||
    triggerRows[0].TRIGGER_NAME !== "trg_equipment_finance_phase4_balance_guard_before_update" ||
    triggerRows[0].EVENT_MANIPULATION !== "UPDATE" ||
    triggerRows[0].ACTION_TIMING !== "BEFORE"
  ) {
    throw new Error("The Phase 4 ledger-aware agreement balance guard is missing.");
  }
  if (Number(invalidRows[0]?.invalid_controlled_balances || 0) !== 0) {
    throw new Error("The Phase 4 verifier found controlled agreements with stale balances.");
  }
}

function validateDepositReservationIntegrity(results, record) {
  if (results.length !== 4) {
    throw new Error(
      `Phase 4 deposit-reservation verifier returned ${results.length} result sets instead of 4.`
    );
  }
  const [migrationRows, triggerRows, indexRows, invalidRows] = results;
  if (migrationRows.length !== 1 || migrationRows[0].migration_name !== record) {
    throw new Error("Phase 4 deposit-reservation migration record was not verified.");
  }

  const expectedTriggers = new Map([
    ["trg_equipment_finance_payment_gate_before_insert", "INSERT"],
    ["trg_equipment_finance_reservation_gate_before_insert", "INSERT"],
    ["trg_equipment_finance_commitment_gate_before_update", "UPDATE"],
  ]);
  if (triggerRows.length !== expectedTriggers.size) {
    throw new Error("The three controlled Phase 4 deposit-reservation triggers are not installed.");
  }
  for (const row of triggerRows) {
    const expectedEvent = expectedTriggers.get(row.TRIGGER_NAME);
    if (
      !expectedEvent ||
      row.EVENT_MANIPULATION !== expectedEvent ||
      row.ACTION_TIMING !== "BEFORE"
    ) {
      throw new Error(`Invalid Phase 4 deposit-reservation trigger ${row.TRIGGER_NAME}.`);
    }
    const action = String(row.ACTION_STATEMENT || "").toLowerCase();
    if (action.includes("kyc_status") || action.includes("affordability_status")) {
      throw new Error("Optional KYC or affordability guidance was made a mandatory deposit gate.");
    }
  }

  const combinedActions = triggerRows
    .map((row) => String(row.ACTION_STATEMENT || "").toLowerCase())
    .join("\n");
  for (const evidence of [
    "application_status",
    "idempotency_key",
    "hire_contract_assets",
    "opening_deposit",
    "<=>",
  ]) {
    if (!combinedActions.includes(evidence)) {
      throw new Error(`Phase 4 trigger evidence is missing ${evidence}.`);
    }
  }

  if (
    indexRows.length !== 1 ||
    Number(indexRows[0].NON_UNIQUE) !== 0 ||
    indexRows[0].indexed_columns !== "idempotency_key"
  ) {
    throw new Error("The unique opening-deposit idempotency index is missing.");
  }
  if (Number(invalidRows[0]?.invalid_controlled_reservations || 0) !== 0) {
    throw new Error("The Phase 4 verifier found invalid controlled reservations.");
  }
}

async function runEquipmentFinancePhaseFourStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Phase 4 migration lock.");

    for (const release of RELEASES) {
      const applied = await migrationRecordExists(connection, release.record);
      if (!applied) {
        console.log(`Applying ${release.record} on ${databaseName}.`);
        await executeStatements(
          connection,
          splitSqlScript(readMigrationFile(release.migration)),
          `Equipment Finance Phase 4 migration ${release.record}`
        );
      }
      const verifierResults = await executeStatements(
        connection,
        splitSqlScript(readMigrationFile(release.verifier)),
        `Equipment Finance Phase 4 verifier ${release.record}`
      );
      release.validate(verifierResults, release.record);
      console.log(`Verified ${release.record} on ${databaseName}.`);
    }

    return { applied: true, database_name: databaseName, releases: RELEASES.map((item) => item.record) };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
      } catch {
        // Connection close will release the advisory lock.
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseFourStartup().catch((error) => {
    console.error("Equipment Finance Phase 4 Railway startup gate failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_LOCK,
  RELEASES,
  REQUIRED_TABLES,
  executeStatements,
  hasExecutableSql,
  migrationRecordExists,
  runEquipmentFinancePhaseFourStartup,
  splitSqlScript,
  validateBalanceGuard,
  validateCorrectionSchema,
  validateDepositReservationIntegrity,
  verifyDatabaseIdentity,
};

