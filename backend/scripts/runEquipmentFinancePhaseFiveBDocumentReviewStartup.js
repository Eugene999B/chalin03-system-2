const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_LOCK = "chalin03:equipment-finance:phase5b-document-review";
const MIGRATION_RECORD = "equipment_finance_phase5b_document_review";
const MIGRATION_FILE =
  "20260802_equipment_finance_phase5b_document_review.sql";
const VERIFIER_FILE =
  "20260802_equipment_finance_phase5b_document_review_verify.sql";
const REQUIRED_REVIEW_CATEGORIES = Object.freeze([
  "kyc_identity",
  "guarantor_identity",
  "agreement_attachment",
]);

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
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  const disabled = ["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
      .trim()
      .toLowerCase()
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

function bufferHasExecutableSql(buffer) {
  return String(buffer || "")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--") && !trimmed.startsWith("#");
    });
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (bufferHasExecutableSql(buffer)) {
        throw new Error(
          "SQL DELIMITER appeared before the previous statement was complete."
        );
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
  if (bufferHasExecutableSql(buffer)) {
    throw new Error("SQL script ended with an incomplete statement.");
  }
  return statements;
}

function readSqlFile(filename) {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    filename
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved Phase 5B SQL file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(
    process.env.CHALIN03_EXPECTED_DATABASE || ""
  ).trim();
  if (!databaseName || !expected) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expected) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
  }
  return databaseName;
}

async function migrationRecordExists(connection) {
  const [[tableRow]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'`
  );
  if (Number(tableRow?.present || 0) !== 1) return false;
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
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
      error.message = `${label} failed at statement ${index + 1} of ${
        statements.length
      }: ${error.message}`;
      throw error;
    }
  }
  return results;
}

function policyRowHasReviewControls(policyRow) {
  if (
    !policyRow ||
    !String(policyRow.policy_version || "").trim() ||
    Number(policyRow.independent_document_review_required) !== 1 ||
    Number(policyRow.separate_document_approval_required) !== 1
  ) {
    return false;
  }

  let categories;
  try {
    categories = JSON.parse(
      String(policyRow.required_document_categories_json || "")
    );
  } catch {
    return false;
  }
  if (!Array.isArray(categories)) return false;
  const configured = new Set(categories.map((category) => String(category)));
  return REQUIRED_REVIEW_CATEGORIES.every((category) => configured.has(category));
}

async function applyForwardCompatiblePolicyVerification(connection, results) {
  if (!Array.isArray(results) || results.length !== 5) return results;
  const [policyRows] = await connection.query(
    `SELECT policy_version, required_document_categories_json,
            independent_document_review_required,
            separate_document_approval_required
       FROM equipment_finance_document_delivery_policy
      WHERE id = 1`
  );
  const validPolicy =
    Array.isArray(policyRows) &&
    policyRows.length === 1 &&
    policyRowHasReviewControls(policyRows[0]);
  const normalized = [...results];
  normalized[3] = [{ invalid_review_policy: validPolicy ? 0 : 1 }];
  return normalized;
}

function validateVerifierResults(results) {
  if (results.length !== 5) {
    throw new Error(
      `Phase 5B verifier returned ${results.length} result sets instead of 5.`
    );
  }
  const [migrationRows, columnRows, historyRows, policyRows, decisionRows] =
    results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0].migration_name !== MIGRATION_RECORD
  ) {
    throw new Error("The Phase 5B migration record was not verified.");
  }
  if (Number(columnRows[0]?.missing_review_columns || 0) !== 0) {
    throw new Error("The Phase 5B document review columns are incomplete.");
  }
  if (Number(historyRows[0]?.missing_history_table || 0) !== 0) {
    throw new Error("The Phase 5B decision-history table is missing.");
  }
  if (Number(policyRows[0]?.invalid_review_policy || 0) !== 0) {
    throw new Error("The Phase 5B document review policy is invalid.");
  }
  if (Number(decisionRows[0]?.invalid_document_decisions || 0) !== 0) {
    throw new Error(
      "The Phase 5B verifier found a document decision that violates independent review controls."
    );
  }
}

async function runEquipmentFinancePhaseFiveBDocumentReviewStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let applied = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK]
    );
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Phase 5B migration lock.");
    }

    if (!(await migrationRecordExists(connection))) {
      await executeStatements(
        connection,
        splitSqlScript(readSqlFile(MIGRATION_FILE)),
        "Equipment Finance Phase 5B migration"
      );
      applied = true;
      console.log(`Applied ${MIGRATION_RECORD} on ${databaseName}.`);
    }

    const historicalVerifierResults = await executeStatements(
      connection,
      splitSqlScript(readSqlFile(VERIFIER_FILE)),
      "Equipment Finance Phase 5B verifier"
    );
    const verifierResults = await applyForwardCompatiblePolicyVerification(
      connection,
      historicalVerifierResults
    );
    validateVerifierResults(verifierResults);
    console.log(`Verified ${MIGRATION_RECORD} on ${databaseName}.`);
    return {
      applied,
      database_name: databaseName,
      migration: MIGRATION_RECORD,
    };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
      } catch {
        // Closing the connection also releases the advisory lock.
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseFiveBDocumentReviewStartup().catch((error) => {
    console.error(
      "Equipment Finance Phase 5B document review Railway startup gate failed."
    );
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_FILE,
  MIGRATION_LOCK,
  MIGRATION_RECORD,
  VERIFIER_FILE,
  REQUIRED_REVIEW_CATEGORIES,
  applyForwardCompatiblePolicyVerification,
  bufferHasExecutableSql,
  executeStatements,
  migrationRecordExists,
  policyRowHasReviewControls,
  runEquipmentFinancePhaseFiveBDocumentReviewStartup,
  splitSqlScript,
  validateVerifierResults,
  verifyDatabaseIdentity,
};
