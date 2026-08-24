const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260729_EQUIPMENT_FINANCE_COMPLETE";
const MIGRATION_LOCK_NAME =
  "chalin03:production-migrations:20260729-equipment-finance";

const PRODUCTION_MIGRATION_PLAN = Object.freeze([
  {
    name: "20260729_equipment_credit_application_foundation",
    migration: "20260729_equipment_credit_application_foundation.sql",
    verifier: "20260729_equipment_credit_application_foundation_verify.sql",
    migrationRecord: "20260729_equipment_credit_application_foundation",
    expectedProblems: [
      "missing_credit_tables",
      "missing_credit_columns",
      "invalid_credit_application_rows",
      "orphan_credit_evidence_rows",
    ],
    verificationType: "numeric-problems",
  },
  {
    name: "20260729_equipment_finance_agreement_activation",
    migration: "20260729_equipment_finance_agreement_activation.sql",
    verifier: "20260729_equipment_finance_agreement_activation_verify.sql",
    migrationRecord: "20260729_equipment_finance_agreement_activation",
    expectedProblems: [
      "missing_activation_columns",
      "missing_activation_indexes",
      "missing_activation_foreign_keys",
      "missing_activation_triggers",
      "duplicate_credit_application_agreement_links",
      "invalid_activated_credit_applications",
      "invalid_linked_finance_agreements",
      "forbidden_hire_link_columns",
      "activation_migration_record_missing",
    ],
    verificationType: "numeric-problems",
  },
  {
    name: "20260729_equipment_finance_deposit_reservation",
    migration: "20260729_equipment_finance_deposit_reservation.sql",
    verifier: "20260729_equipment_finance_deposit_reservation_verify.sql",
    migrationRecord: "20260729_equipment_finance_deposit_reservation",
    expectedProblems: [
      "missing_deposit_reservation_columns",
      "missing_deposit_reservation_indexes",
      "missing_deposit_reservation_foreign_keys",
      "missing_deposit_reservation_triggers",
      "bypassed_controlled_finance_payments",
      "invalid_opening_deposit_payments",
      "invalid_controlled_deposit_balances",
      "invalid_reserved_finance_agreements",
      "invalid_controlled_finance_sale_locks",
      "reserved_finance_assets_active_on_hire",
      "forbidden_deposit_hire_link_columns",
      "deposit_reservation_migration_record_missing",
    ],
    verificationType: "numeric-problems",
  },
  {
    name: "20260805_equipment_finance_opening_deposit_foundation_repair",
    migration: "20260805_equipment_finance_opening_deposit_foundation_repair.sql",
    verifier: "20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql",
    migrationRecord: "20260805_equipment_finance_opening_deposit_foundation_repair",
    expectedProblems: [
      "missing_opening_deposit_columns",
      "missing_opening_deposit_indexes",
      "duplicate_opening_deposit_idempotency_keys",
    ],
    verificationType: "numeric-problems",
  },
  {
    name: "20260803_equipment_finance_phase4_deposit_reservation_integrity",
    migration: "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql",
    verifier: "20260803_equipment_finance_phase4_deposit_reservation_integrity_verify.sql",
    migrationRecord: "20260803_equipment_finance_phase4_deposit_reservation_integrity",
    expectedProblems: ["invalid_controlled_reservations"],
    verificationType: "phase4",
  },
  {
    name: "20260729_equipment_finance_final_lifecycle",
    migration: "20260729_equipment_finance_final_lifecycle.sql",
    verifier: "20260729_equipment_finance_final_lifecycle_verify.sql",
    expectedProblems: [
      "missing_final_lifecycle_columns",
      "missing_final_lifecycle_indexes",
      "missing_final_lifecycle_foreign_keys",
      "missing_final_lifecycle_triggers",
      "bypassed_controlled_finance_payments",
      "invalid_controlled_finance_collections",
      "invalid_controlled_finance_deliveries",
      "invalid_controlled_finance_ownership_transfers",
      "uncontrolled_finance_delivery_statuses",
      "uncontrolled_finance_ownership_statuses",
      "controlled_finance_assets_active_on_hire",
    ],
    verificationType: "numeric-problems",
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

function assertReleaseGates(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Finance migration runner requires NODE_ENV=production.");
  }
  if (!booleanValue(env.CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED)) {
    throw new Error(
      "Set CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=true only for the controlled Finance migration operation."
    );
  }
  if (!booleanValue(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error(
      "Confirm the verified signed Professional Backup before enabling Finance migrations."
    );
  }
  if (!booleanValue(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
    throw new Error(
      "Confirm the separate verified SQL backup before enabling Finance migrations."
    );
  }
  if (
    String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact approved Finance migration plan.`
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
  if (buffer.trim()) throw new Error("SQL script ended with an incomplete statement.");
  return statements;
}

function migrationDirectory() {
  return path.resolve(__dirname, "../../..", "database/migrations");
}

function readSqlFile(filename) {
  const resolved = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Approved Finance SQL file is missing: ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

function assertZeroProblemResult(rows, key, migrationName) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${migrationName} verifier did not return one ${key} row.`);
  }
  const value = Number(rows[0]?.[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`${migrationName} verifier did not return numeric ${key}.`);
  }
  if (value !== 0) {
    throw new Error(`${migrationName} verifier returned ${key}=${value}; expected 0.`);
  }
}

function assertMigrationRecord(rows, migrationName) {
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.migration_name !== migrationName
  ) {
    throw new Error(`${migrationName} migration record was not verified.`);
  }
}

function assertExactNames(rows, key, requiredNames, label) {
  const actual = new Set((rows || []).map((row) => String(row[key] || "")));
  const missing = requiredNames.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(`${label} is missing: ${missing.join(", ")}.`);
  }
}

function validatePhaseFourVerifier(results, migrationName) {
  if (results.length !== 4) {
    throw new Error(
      `${migrationName} verifier returned ${results.length} result sets instead of 4.`
    );
  }

  const [migrationRows, triggerRows, indexRows, invalidReservationRows] = results;
  assertMigrationRecord(migrationRows, migrationName);
  assertExactNames(
    triggerRows,
    "TRIGGER_NAME",
    [
      "trg_equipment_finance_payment_gate_before_insert",
      "trg_equipment_finance_reservation_gate_before_insert",
      "trg_equipment_finance_commitment_gate_before_update",
    ],
    "Phase 4 Finance triggers"
  );
  assertExactNames(
    indexRows,
    "INDEX_NAME",
    ["uq_equipment_finance_payment_idempotency"],
    "Phase 4 Finance payment idempotency index"
  );
  assertZeroProblemResult(
    invalidReservationRows,
    "invalid_controlled_reservations",
    migrationName
  );
}

function validateVerifierResults(planItem, results) {
  const expectedLength = planItem.expectedProblems.length + 1;
  if (results.length !== expectedLength) {
    throw new Error(
      `${planItem.name} verifier returned ${results.length} result sets instead of ${expectedLength}.`
    );
  }

  if (planItem.verificationType === "phase4") {
    validatePhaseFourVerifier(results, planItem.name);
    return;
  }

  assertMigrationRecord(results[0], planItem.migrationRecord);
  planItem.expectedProblems.forEach((key, index) => {
    assertZeroProblemResult(results[index + 1], key, planItem.name);
  });
}

async function executeStatements(connection, statements, labelText) {
  const resultSets = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      resultSets.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${labelText} failed at statement ${index + 1} of ${
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

async function runEquipmentFinanceProductionMigrations() {
  assertReleaseGates();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = String(databaseRow?.database_name || "").trim();
    if (!databaseName) throw new Error("No production database is selected.");

    const expectedDatabase = String(
      process.env.CHALIN03_EXPECTED_DATABASE || ""
    ).trim();
    if (!expectedDatabase) {
      throw new Error(
        "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
      );
    }
    if (expectedDatabase !== databaseName) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Finance production migration lock.");
    }

    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Finance migration release: ${RELEASE_CONFIRMATION}`);

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
      const results = await executeStatements(
        connection,
        verifierStatements,
        `Verifier ${planItem.name}`
      );
      validateVerifierResults(planItem, results);
      console.log(`Verified ${planItem.name}.`);
    }

    console.log("All approved Equipment Finance migrations and verifiers passed.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [
          MIGRATION_LOCK_NAME,
        ]);
      } catch (error) {
        console.error("Warning: Finance migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceProductionMigrations().catch((error) => {
    console.error("Equipment Finance production migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_LOCK_NAME,
  PRODUCTION_MIGRATION_PLAN,
  RELEASE_CONFIRMATION,
  assertReleaseGates,
  splitSqlScript,
  validateVerifierResults,
};