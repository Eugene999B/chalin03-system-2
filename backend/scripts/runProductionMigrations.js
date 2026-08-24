const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260725_PHASE1_POST_PHASE1";
const MIGRATION_LOCK_NAME = "chalin03:production-migrations:20260725";

const PRODUCTION_MIGRATION_PLAN = Object.freeze([
  {
    name: "20260725_phase1_financial_control_hardening",
    migration: "20260725_phase1_financial_control_hardening.sql",
    verifier: "20260725_phase1_financial_control_hardening_verify.sql",
    verificationType: "financial-control",
  },
  {
    name: "20260725_post_phase1_audit_signoff_readiness",
    migration: "20260725_post_phase1_audit_signoff_readiness.sql",
    verifier: "20260725_post_phase1_audit_signoff_readiness_verify.sql",
    verificationType: "audit-readiness",
  },
  {
    name: "20260805_equipment_finance_opening_deposit_foundation_repair",
    migration: "20260805_equipment_finance_opening_deposit_foundation_repair.sql",
    verifier: "20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql",
    verificationType: "opening-deposit-foundation",
  },
  {
    name: "20260803_equipment_finance_phase4_deposit_reservation_integrity",
    migration: "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql",
    verifier: "20260803_equipment_finance_phase4_deposit_reservation_integrity_verify.sql",
    verificationType: "phase4-deposit-reservation",
  },
]);

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  const enabled = String(env.DB_SSL || "").trim().toLowerCase();
  if (enabled === "false") return undefined;
  if (enabled !== "true") return undefined;

  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }

  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
        .trim()
        .toLowerCase()
    ),
  };
}

function assertProductionConfirmation(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error(
      "Production migration runner requires NODE_ENV=production."
    );
  }

  if (!booleanValue(env.CHALIN03_PRODUCTION_MIGRATIONS_ENABLED)) {
    throw new Error(
      "Set CHALIN03_PRODUCTION_MIGRATIONS_ENABLED=true only for the controlled production release."
    );
  }

  if (!booleanValue(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error(
      "Set CHALIN03_SIGNED_BACKUP_CONFIRMED=true only after downloading and validating a fresh signed full-system backup."
    );
  }

  if (
    String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact approved migration set.`
    );
  }
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (buffer.trim()) {
        throw new Error(
          "SQL DELIMITER directive appeared before the previous statement was complete."
        );
      }
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

  if (buffer.trim()) {
    throw new Error("SQL script ended with an incomplete statement.");
  }

  return statements;
}

function migrationDirectory() {
  return path.resolve(__dirname, "../../database/migrations");
}

function readSqlFile(filename) {
  const resolved = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Approved SQL file is missing: ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

function getNumericValue(rows, key) {
  const value = rows?.[0]?.[key];
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Verifier did not return a numeric ${key} value.`);
  }
  return number;
}

function assertExactNames(rows, key, requiredNames, label) {
  const actual = new Set((rows || []).map((row) => String(row[key] || "")));
  const missing = requiredNames.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(`${label} is missing: ${missing.join(", ")}.`);
  }
}

function verifyFinancialControlResults(results, migrationName) {
  if (results.length !== 5) {
    throw new Error(
      `Financial-control verifier returned ${results.length} result sets instead of 5.`
    );
  }

  const [migrationRows, columnRows, indexRows, invalidVoidRows, invalidReversalRows] =
    results;

  if (
    migrationRows.length !== 1 ||
    migrationRows[0].migration_name !== migrationName
  ) {
    throw new Error(`Migration record ${migrationName} was not verified.`);
  }

  assertExactNames(
    columnRows,
    "COLUMN_NAME",
    [
      "is_voided",
      "void_reason",
      "void_reference",
      "voided_by",
      "voided_at",
      "void_approved_by",
      "void_approved_at",
      "is_reversal",
      "reversal_of_expense_id",
      "reversal_reference",
    ],
    "Expense void/reversal columns"
  );

  assertExactNames(
    indexRows,
    "INDEX_NAME",
    [
      "idx_expense_void_status",
      "uq_expense_void_reference",
      "idx_expense_void_approval",
      "uq_expense_reversal_source",
      "uq_expense_reversal_reference",
    ],
    "Expense void/reversal indexes"
  );

  if (getNumericValue(invalidVoidRows, "invalid_void_rows") !== 0) {
    throw new Error("Financial verifier found invalid voided expense rows.");
  }
  if (getNumericValue(invalidReversalRows, "invalid_reversal_rows") !== 0) {
    throw new Error("Financial verifier found invalid reversal expense rows.");
  }
}

function verifyAuditReadinessResults(results, migrationName) {
  if (results.length !== 4) {
    throw new Error(
      `Audit-readiness verifier returned ${results.length} result sets instead of 4.`
    );
  }

  const [migrationRows, missingColumnRows, missingIndexRows, detailRows] = results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0].migration_name !== migrationName
  ) {
    throw new Error(`Migration record ${migrationName} was not verified.`);
  }

  if (
    getNumericValue(
      missingColumnRows,
      "missing_audit_readiness_columns"
    ) !== 0
  ) {
    throw new Error("Audit readiness verifier found missing columns.");
  }
  if (
    getNumericValue(missingIndexRows, "missing_audit_readiness_indexes") !== 0
  ) {
    throw new Error("Audit readiness verifier found missing indexes.");
  }

  assertExactNames(
    detailRows.filter((row) => row.TABLE_NAME === "audit_signoffs"),
    "COLUMN_NAME",
    [
      "branch_id",
      "purchases_checked",
      "returns_checked",
      "transfers_checked",
      "sms_checked",
      "stock_ledger_checked",
      "backup_checked",
      "maintenance_checked",
    ],
    "Audit Sign-Off readiness columns"
  );
  assertExactNames(
    detailRows.filter((row) => row.TABLE_NAME === "audit_reapproval_log"),
    "COLUMN_NAME",
    ["branch_id"],
    "Audit re-approval readiness columns"
  );
}

function verifyOpeningDepositFoundationResults(results, migrationName) {
  if (results.length !== 4) {
    throw new Error(
      `Opening Deposit verifier returned ${results.length} result sets instead of 4.`
    );
  }
  const [migrationRows, columnRows, indexRows, duplicateRows] = results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0]?.migration_name !== migrationName
  ) {
    throw new Error(`Migration record ${migrationName} was not verified.`);
  }
  if (getNumericValue(columnRows, "missing_opening_deposit_columns") !== 0) {
    throw new Error("Opening Deposit verifier found missing columns.");
  }
  if (getNumericValue(indexRows, "missing_opening_deposit_indexes") !== 0) {
    throw new Error("Opening Deposit verifier found missing indexes.");
  }
  if (getNumericValue(duplicateRows, "duplicate_opening_deposit_idempotency_keys") !== 0) {
    throw new Error("Opening Deposit verifier found duplicate idempotency keys.");
  }
}

function verifyPhaseFourDepositReservationResults(results, migrationName) {
  if (results.length !== 4) {
    throw new Error(
      `Phase 4 deposit-reservation verifier returned ${results.length} result sets instead of 4.`
    );
  }
  const [migrationRows, triggerRows, indexRows, invalidRows] = results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0]?.migration_name !== migrationName
  ) {
    throw new Error(`Migration record ${migrationName} was not verified.`);
  }

  const expectedTriggers = [
    "trg_equipment_finance_payment_gate_before_insert",
    "trg_equipment_finance_reservation_gate_before_insert",
    "trg_equipment_finance_commitment_gate_before_update",
  ];
  assertExactNames(
    triggerRows,
    "TRIGGER_NAME",
    expectedTriggers,
    "Phase 4 deposit-reservation triggers"
  );

  if (
    indexRows.length !== 1 ||
    Number(indexRows[0]?.NON_UNIQUE) !== 0 ||
    indexRows[0]?.INDEX_NAME !== "uq_equipment_finance_payment_idempotency" ||
    indexRows[0]?.indexed_columns !== "idempotency_key"
  ) {
    throw new Error("Phase 4 verifier found an invalid or missing deposit idempotency index.");
  }

  if (getNumericValue(invalidRows, "invalid_controlled_reservations") !== 0) {
    throw new Error("Phase 4 verifier found invalid controlled reservations.");
  }
}

function validateVerifierResults(planItem, results) {
  if (planItem.verificationType === "financial-control") {
    verifyFinancialControlResults(results, planItem.name);
    return;
  }
  if (planItem.verificationType === "audit-readiness") {
    verifyAuditReadinessResults(results, planItem.name);
    return;
  }
  if (planItem.verificationType === "opening-deposit-foundation") {
    verifyOpeningDepositFoundationResults(results, planItem.name);
    return;
  }
  if (planItem.verificationType === "phase4-deposit-reservation") {
    verifyPhaseFourDepositReservationResults(results, planItem.name);
    return;
  }
  throw new Error(`Unknown verifier type: ${planItem.verificationType}`);
}

async function executeStatements(connection, statements, label) {
  const resultSets = [];
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    try {
      const [rows] = await connection.query(statement);
      resultSets.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${
        statements.length
      }: ${error.message}`;
      throw error;
    }
  }
  return resultSets;
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

async function runProductionMigrations() {
  assertProductionConfirmation();

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = String(databaseRow?.database_name || "").trim();
    if (!databaseName) throw new Error("No production database is selected.");

    const expectedDatabase = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();
    if (expectedDatabase && expectedDatabase !== databaseName) {
      throw new Error(
        `Connected database ${databaseName} does not match the configured production database ${expectedDatabase}.`
      );
    }

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the production migration lock.");
    }

    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Release: ${RELEASE_CONFIRMATION}`);

    for (const planItem of PRODUCTION_MIGRATION_PLAN) {
      const migrationStatements = splitSqlScript(readSqlFile(planItem.migration));
      const verifierStatements = splitSqlScript(readSqlFile(planItem.verifier));

      console.log(`Applying ${planItem.name}...`);
      await executeStatements(
        connection,
        migrationStatements,
        `Migration ${planItem.name}`
      );

      console.log(`Verifying ${planItem.name}...`);
      const verifierResults = await executeStatements(
        connection,
        verifierStatements,
        `Verifier ${planItem.name}`
      );
      validateVerifierResults(planItem, verifierResults);
      console.log(`Verified ${planItem.name}.`);
    }

    console.log("All approved production migrations and verifiers passed.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [
          MIGRATION_LOCK_NAME,
        ]);
      } catch (error) {
        console.error("Warning: migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runProductionMigrations().catch((error) => {
    console.error("Production migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_LOCK_NAME,
  PRODUCTION_MIGRATION_PLAN,
  RELEASE_CONFIRMATION,
  assertProductionConfirmation,
  getSslConfig,
  splitSqlScript,
  validateVerifierResults,
};
