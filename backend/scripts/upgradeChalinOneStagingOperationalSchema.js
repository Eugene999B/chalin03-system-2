"use strict";

const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const { pool } = require("../config/db");
const { executeSqlScript } = require("./sqlScriptRunner");
const {
  assertDedicatedRailwayStaging,
} = require("./completeChalinOneFullStagingDatabase");

const LOCK_NAME = "chalin03:chalin-one:staging-operational-schema:v1";
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_ROOT = path.join(REPOSITORY_ROOT, "database", "migrations");

const STAGING_OPERATIONAL_MIGRATIONS = Object.freeze([
  Object.freeze({
    record: "20260810_payroll_financial_foundation",
    file: "20260810_payroll_financial_foundation.sql",
    verify: "20260810_payroll_financial_foundation_verify.sql",
    zero_fields: Object.freeze([
      "missing_payroll_tables",
      "compensation_worker_workspace_mismatches",
      "entry_worker_workspace_mismatches",
      "payment_worker_workspace_mismatches",
      "self_approved_compensation_profiles",
      "self_approved_payroll_periods",
    ]),
  }),
  Object.freeze({
    record: "20260810_inventory_traceability_foundation",
    file: "20260810_inventory_traceability_foundation.sql",
    verify: "20260810_inventory_traceability_foundation_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260810_inventory_loss_detection_foundation",
    file: "20260810_inventory_loss_detection_foundation.sql",
    verify: "20260810_inventory_loss_detection_foundation_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260810_inventory_count_snapshot_hardening",
    file: "20260810_inventory_count_snapshot_hardening.sql",
    verify: "20260810_inventory_count_snapshot_hardening_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260811_inventory_transfer_traceability",
    file: "20260811_inventory_transfer_traceability.sql",
    verify: "20260811_inventory_transfer_traceability_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
]);

class ChalinOneStagingOperationalSchemaError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_FAILED") {
    super(message);
    this.name = "ChalinOneStagingOperationalSchemaError";
    this.code = code;
  }
}

function readRequiredFile(fileName) {
  const filePath = path.join(MIGRATION_ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Required staging migration source file is missing: ${fileName}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_SOURCE_MISSING"
    );
  }
  return fs.readFileSync(filePath, "utf8");
}

async function migrationRecorded(connection, record) {
  const [rows] = await connection.query(
    `SELECT migration_name
       FROM schema_migrations
      WHERE migration_name = ?
      LIMIT 1`,
    [record]
  );
  return Boolean(rows[0]);
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
    LOCK_NAME,
  ]);
  if (Number(row?.acquired || 0) !== 1) {
    throw new ChalinOneStagingOperationalSchemaError(
      "Could not acquire the CHALIN ONE staging operational-schema lock.",
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_LOCK_UNAVAILABLE"
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
    // The database connection also releases this advisory lock on close.
  }
}

function assertVerifierZeroResults(resultSets, migration) {
  const expectedFields = new Set(migration.zero_fields || []);
  const observedFields = new Set();
  const failures = [];

  for (const rows of resultSets || []) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      for (const field of expectedFields) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
        observedFields.add(field);
        const value = Number(row[field]);
        if (!Number.isFinite(value) || value !== 0) {
          failures.push(`${field}=${String(row[field])}`);
        }
      }
    }
  }

  const missingFields = [...expectedFields].filter(
    (field) => !observedFields.has(field)
  );
  if (missingFields.length > 0) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Verifier for ${migration.record} did not return required zero-result fields: ${missingFields.join(", ")}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_INCOMPLETE"
    );
  }
  if (failures.length > 0) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Verifier for ${migration.record} reported problems: ${failures.join(", ")}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_FAILED"
    );
  }
}

async function applyStagingMigration(connection, migration) {
  const migrationSql = readRequiredFile(migration.file);
  const verifierSql = readRequiredFile(migration.verify);
  const recordedBefore = await migrationRecorded(connection, migration.record);

  if (!recordedBefore) {
    console.log(`CHALIN ONE staging operational migration applying: ${migration.record}.`);
    await executeSqlScript(
      connection,
      migrationSql,
      `CHALIN ONE staging operational migration ${migration.record}`
    );
  } else {
    console.log(`CHALIN ONE staging operational migration already recorded: ${migration.record}.`);
  }

  if (!(await migrationRecorded(connection, migration.record))) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Migration ${migration.record} did not create its schema_migrations record.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_RECORD_MISSING"
    );
  }

  const verification = await executeSqlScript(
    connection,
    verifierSql,
    `CHALIN ONE staging operational verification ${migration.record}`
  );
  assertVerifierZeroResults(verification, migration);

  return Object.freeze({
    record: migration.record,
    applied: !recordedBefore,
    verified: true,
  });
}

async function upgradeChalinOneStagingOperationalSchema({ env = process.env } = {}) {
  const safety = assertDedicatedRailwayStaging(env);
  const connection = await pool.getConnection();
  let locked = false;

  try {
    await acquireLock(connection);
    locked = true;

    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    if (!databaseName) {
      throw new ChalinOneStagingOperationalSchemaError(
        "The staging operational-schema connection has no selected database.",
        "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_DATABASE_NOT_SELECTED"
      );
    }

    const reports = [];
    for (const migration of STAGING_OPERATIONAL_MIGRATIONS) {
      reports.push(await applyStagingMigration(connection, migration));
    }

    const result = Object.freeze({
      safe: true,
      database: databaseName,
      railway_environment: safety.railway_environment,
      migrations: Object.freeze(reports),
      production_runner_used: false,
    });
    console.log("CHALIN ONE staging Payroll + Inventory operational schema verified safely.");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (locked) await releaseLock(connection);
    connection.release();
  }
}

if (require.main === module) {
  upgradeChalinOneStagingOperationalSchema()
    .catch((error) => {
      console.error(
        `CHALIN ONE staging operational-schema upgrade failed: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  LOCK_NAME,
  STAGING_OPERATIONAL_MIGRATIONS,
  ChalinOneStagingOperationalSchemaError,
  applyStagingMigration,
  assertVerifierZeroResults,
  upgradeChalinOneStagingOperationalSchema,
};
