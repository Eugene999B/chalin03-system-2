const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260811_INVENTORY_LOSS_PREVENTION_TRACEABILITY";
const MIGRATION_LOCK_NAME =
  "chalin03:production-migrations:20260811-inventory-traceability";

const APPROVED_SQL_ARTIFACTS = Object.freeze({
  traceabilityFoundationMigration: Object.freeze({
    filename: "20260810_inventory_traceability_foundation.sql",
    gitBlobSha: "22b66097a919d44cf0221212aca170d47a4ba299",
  }),
  traceabilityFoundationVerifier: Object.freeze({
    filename: "20260810_inventory_traceability_foundation_verify.sql",
    gitBlobSha: "48aa76b615c28ddecd474496610069500cacf720",
  }),
  lossDetectionFoundationMigration: Object.freeze({
    filename: "20260810_inventory_loss_detection_foundation.sql",
    gitBlobSha: "6ff8f7197b6a0e70bbf77a381b8f2cd2c0dfd9df",
  }),
  lossDetectionFoundationVerifier: Object.freeze({
    filename: "20260810_inventory_loss_detection_foundation_verify.sql",
    gitBlobSha: "5ce6b41f6c15bd30396de7b26498fdf88faf092a",
  }),
  countSnapshotMigration: Object.freeze({
    filename: "20260810_inventory_count_snapshot_hardening.sql",
    gitBlobSha: "1a24c9c59a566b9731fe86a9cdb41335d9e23186",
  }),
  countSnapshotVerifier: Object.freeze({
    filename: "20260810_inventory_count_snapshot_hardening_verify.sql",
    gitBlobSha: "9c5657d53188dd7691a18a5c07a086b72b2d8cce",
  }),
  transferTraceabilityMigration: Object.freeze({
    filename: "20260811_inventory_transfer_traceability.sql",
    gitBlobSha: "c4e042f0c50cd990e59bbda1026870e18e97e7a0",
  }),
  transferTraceabilityVerifier: Object.freeze({
    filename: "20260811_inventory_transfer_traceability_verify.sql",
    gitBlobSha: "662159125b5ac9beac3aea1a3a025c01c49bbe4d",
  }),
});

const PRODUCTION_MIGRATION_PLAN = Object.freeze([
  Object.freeze({
    name: "20260810_inventory_traceability_foundation",
    migrationArtifact: "traceabilityFoundationMigration",
    verifierArtifact: "traceabilityFoundationVerifier",
    migrationRecord: "20260810_inventory_traceability_foundation",
  }),
  Object.freeze({
    name: "20260810_inventory_loss_detection_foundation",
    migrationArtifact: "lossDetectionFoundationMigration",
    verifierArtifact: "lossDetectionFoundationVerifier",
    migrationRecord: "20260810_inventory_loss_detection_foundation",
  }),
  Object.freeze({
    name: "20260810_inventory_count_snapshot_hardening",
    migrationArtifact: "countSnapshotMigration",
    verifierArtifact: "countSnapshotVerifier",
    migrationRecord: "20260810_inventory_count_snapshot_hardening",
  }),
  Object.freeze({
    name: "20260811_inventory_transfer_traceability",
    migrationArtifact: "transferTraceabilityMigration",
    verifierArtifact: "transferTraceabilityVerifier",
    migrationRecord: "20260811_inventory_transfer_traceability",
  }),
]);

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName, env = process.env) {
  const value = env[primaryName] || (fallbackName ? env[fallbackName] : undefined);
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
    throw new Error("Inventory migration runner requires NODE_ENV=production.");
  }
  if (!booleanValue(env.CHALIN03_INVENTORY_MIGRATIONS_ENABLED)) {
    throw new Error(
      "Set CHALIN03_INVENTORY_MIGRATIONS_ENABLED=true only for the controlled Inventory migration operation."
    );
  }
  if (!booleanValue(env.CHALIN03_INVENTORY_RELEASE_AUTHORIZED)) {
    throw new Error(
      "Inventory production migration requires explicit owner release authorization."
    );
  }
  if (!booleanValue(env.CHALIN03_INVENTORY_MIGRATION_REHEARSAL_CONFIRMED)) {
    throw new Error(
      "Confirm the final disposable MySQL Inventory migration rehearsal before production migration."
    );
  }
  if (!booleanValue(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error(
      "Confirm the fresh verified Professional Backup before enabling Inventory migrations."
    );
  }
  if (!booleanValue(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
    throw new Error(
      "Confirm the separate fresh verified SQL/database backup before enabling Inventory migrations."
    );
  }
  if (String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE_CONFIRMATION) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact approved Inventory migration plan.`
    );
  }
  if (!String(env.CHALIN03_EXPECTED_DATABASE || "").trim()) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact approved production database name."
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
  return path.resolve(__dirname, "../../database/migrations");
}

function gitBlobSha(contentBuffer) {
  if (!Buffer.isBuffer(contentBuffer)) {
    throw new TypeError("gitBlobSha requires a Buffer.");
  }
  const header = Buffer.from(`blob ${contentBuffer.length}\0`, "utf8");
  return crypto
    .createHash("sha1")
    .update(header)
    .update(contentBuffer)
    .digest("hex");
}

function assertApprovedBlobIdentity(contentBuffer, expectedSha, label) {
  if (!/^[0-9a-f]{40}$/.test(String(expectedSha || ""))) {
    throw new Error(`${label} has an invalid approved Git blob SHA.`);
  }
  const actualSha = gitBlobSha(contentBuffer);
  if (actualSha !== expectedSha) {
    throw new Error(
      `${label} content changed after release review. Expected Git blob ${expectedSha}, received ${actualSha}. Review and repin before migration.`
    );
  }
  return actualSha;
}

function readApprovedSqlArtifact(artifactKey) {
  if (!Object.prototype.hasOwnProperty.call(APPROVED_SQL_ARTIFACTS, artifactKey)) {
    throw new Error(`Unknown Inventory SQL artifact: ${artifactKey}`);
  }
  const artifact = APPROVED_SQL_ARTIFACTS[artifactKey];
  const filename = artifact.filename;
  if (
    path.basename(filename) !== filename ||
    !/^[A-Za-z0-9._-]+\.sql$/.test(filename)
  ) {
    throw new Error(`Approved Inventory SQL filename is unsafe: ${filename}`);
  }

  const approvedRoot = fs.realpathSync(migrationDirectory());
  const candidatePath = path.resolve(approvedRoot, filename);
  if (path.dirname(candidatePath) !== approvedRoot) {
    throw new Error(`Approved Inventory SQL path escaped its directory: ${filename}`);
  }
  if (!fs.existsSync(candidatePath)) {
    throw new Error(`Approved Inventory SQL file is missing: ${filename}`);
  }
  const fileStat = fs.lstatSync(candidatePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`Approved Inventory SQL artifact must be a regular file: ${filename}`);
  }
  const realPath = fs.realpathSync(candidatePath);
  if (path.dirname(realPath) !== approvedRoot) {
    throw new Error(`Approved Inventory SQL real path escaped its directory: ${filename}`);
  }

  const contentBuffer = fs.readFileSync(realPath);
  assertApprovedBlobIdentity(contentBuffer, artifact.gitBlobSha, filename);
  return contentBuffer.toString("utf8");
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

function validateVerifierResults(results, expectedDatabase, migrationName) {
  if (!Array.isArray(results) || results.length < 2) {
    throw new Error(`${migrationName} verifier returned insufficient result sets.`);
  }

  const metadataRows = results[0];
  if (!Array.isArray(metadataRows) || metadataRows.length !== 1) {
    throw new Error(`${migrationName} verifier did not return one database metadata row.`);
  }
  const selectedDatabase = String(metadataRows[0]?.selected_database || "").trim();
  if (selectedDatabase !== expectedDatabase) {
    throw new Error(
      `${migrationName} verifier ran against ${selectedDatabase || "no database"}; expected ${expectedDatabase}.`
    );
  }

  for (let index = 1; index < results.length; index += 1) {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(
        `${migrationName} verifier result ${index} did not return exactly one row.`
      );
    }
    const problemCount = Number(rows[0]?.problem_count);
    const result = String(rows[0]?.result || "").trim().toUpperCase();
    if (!Number.isFinite(problemCount)) {
      throw new Error(
        `${migrationName} verifier result ${index} did not return numeric problem_count.`
      );
    }
    if (problemCount !== 0 || result !== "PASS") {
      throw new Error(
        `${migrationName} verifier result ${index} returned problem_count=${problemCount}, result=${result || "missing"}.`
      );
    }
  }
}

function connectionOptions(env = process.env) {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", env),
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", env),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", env),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", env),
    ssl: getSslConfig(env),
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

async function migrationMarkerCount(connection, migrationRecord) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS marker_count
     FROM schema_migrations
     WHERE migration_name = ?`,
    [migrationRecord]
  );
  const count = Number(rows[0]?.marker_count);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Unable to verify migration marker ${migrationRecord}.`);
  }
  return count;
}

async function applyPlanItem(connection, planItem, expectedDatabase) {
  const priorMarkerCount = await migrationMarkerCount(
    connection,
    planItem.migrationRecord
  );
  if (priorMarkerCount > 1) {
    throw new Error(
      `${planItem.name} has ${priorMarkerCount} schema_migrations markers; expected at most one.`
    );
  }

  if (priorMarkerCount === 0) {
    console.log(`Applying ${planItem.name}...`);
    const migrationStatements = splitSqlScript(
      readApprovedSqlArtifact(planItem.migrationArtifact)
    );
    await executeStatements(
      connection,
      migrationStatements,
      `Migration ${planItem.name}`
    );
    const markerAfterApply = await migrationMarkerCount(
      connection,
      planItem.migrationRecord
    );
    if (markerAfterApply !== 1) {
      throw new Error(
        `${planItem.name} did not create exactly one schema_migrations marker.`
      );
    }
  } else {
    console.log(`Skipping already-applied migration ${planItem.name}; verifier will still run.`);
  }

  console.log(`Verifying ${planItem.name}...`);
  const verifierStatements = splitSqlScript(
    readApprovedSqlArtifact(planItem.verifierArtifact)
  );
  const verifierResults = await executeStatements(
    connection,
    verifierStatements,
    `Verifier ${planItem.name}`
  );
  validateVerifierResults(verifierResults, expectedDatabase, planItem.name);
  console.log(`Verified ${planItem.name}.`);
}

async function runInventoryLossPreventionProductionMigrations(env = process.env) {
  assertReleaseGates(env);
  const expectedDatabase = String(env.CHALIN03_EXPECTED_DATABASE || "").trim();
  const connection = await mysql.createConnection(connectionOptions(env));
  let lockAcquired = false;

  try {
    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = String(databaseRow?.database_name || "").trim();
    if (!databaseName) throw new Error("No database is selected.");
    if (databaseName !== expectedDatabase) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }

    const [[markerTableRow]] = await connection.query(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'schema_migrations'`
    );
    if (Number(markerTableRow?.table_count) !== 1) {
      throw new Error(
        "The approved production database must already contain schema_migrations before Inventory release."
      );
    }

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Inventory production migration lock.");
    }

    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Inventory migration release: ${RELEASE_CONFIRMATION}`);

    for (const planItem of PRODUCTION_MIGRATION_PLAN) {
      await applyPlanItem(connection, planItem, expectedDatabase);
    }

    console.log("All approved Inventory migrations and verifiers passed.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [
          MIGRATION_LOCK_NAME,
        ]);
      } catch (error) {
        console.error(
          "Warning: Inventory migration lock release failed:",
          error.message
        );
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runInventoryLossPreventionProductionMigrations().catch((error) => {
    console.error("Inventory Loss Prevention production migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  APPROVED_SQL_ARTIFACTS,
  MIGRATION_LOCK_NAME,
  PRODUCTION_MIGRATION_PLAN,
  RELEASE_CONFIRMATION,
  applyPlanItem,
  assertApprovedBlobIdentity,
  assertReleaseGates,
  connectionOptions,
  gitBlobSha,
  migrationMarkerCount,
  readApprovedSqlArtifact,
  runInventoryLossPreventionProductionMigrations,
  splitSqlScript,
  validateVerifierResults,
};
