require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { pool } = require("../config/db");
const { APP_VERSION } = require("../config/version");
const {
  assertBranchSchemaReady,
} = require("../services/branchSchemaReadinessService");
const {
  ensureWorkerHrLetterSchema,
} = require("../services/workerHrLetterSchemaService");
const {
  ensureEmploymentDocumentSchema,
} = require("../services/employmentDocumentSchemaService");
const {
  ensurePasskeySchema,
} = require("../services/passkeySchemaService");
const {
  ensureConfigurationTables,
} = require("../services/groupConfigurationService");
const {
  verifyFoundation,
} = require("../services/equipmentSalesSchemaService");
const {
  loadCanonicalContract,
} = require("../services/fullSystemBackupService");
const {
  readProductionAttestationEnvironment,
  verifyProductionBackupAttestation,
} = require("../services/migrationBackupAttestationService");

const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_DIR = path.join(REPO_ROOT, "database", "migrations");
const MANIFEST_PATH = path.join(MIGRATION_DIR, "controlled-manifest.json");
const HISTORY_TABLE = "controlled_migration_history";
const LOCK_NAME = "chalin03_controlled_migrations_v1";
const WRITE_PATTERN =
  /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|EXECUTE|PREPARE|DEALLOCATE|SET)\b/i;
const SAFE_NAME = /^\d{8}_[a-z0-9][a-z0-9_]*$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseArguments(argv) {
  const options = {
    mode: "plan",
    deployment: false,
  };

  for (const argument of argv) {
    if (argument === "--plan") options.mode = "plan";
    else if (argument === "--apply") options.mode = "apply";
    else if (argument === "--deployment") {
      options.mode = "apply";
      options.deployment = true;
    } else {
      throw new Error(`Unknown migration argument: ${argument}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveMigrationFile(fileName) {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName || safeName !== fileName) {
    throw new Error(`Unsafe migration manifest path: ${fileName}`);
  }
  return path.join(MIGRATION_DIR, safeName);
}

function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  const manifest = readJson(manifestPath);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Controlled migration manifest must be a JSON object.");
  }
  if (!Array.isArray(manifest.migrations)) {
    throw new Error("Controlled migration manifest must contain a migrations array.");
  }

  const names = new Set();
  const migrations = manifest.migrations.map((entry, index) => {
    const name = cleanText(entry?.name, 180);
    const mode = cleanText(entry?.mode || "sql", 20).toLowerCase();
    if (!SAFE_NAME.test(name)) {
      throw new Error(`Manifest migration ${index + 1} has an invalid name: ${name}`);
    }
    if (names.has(name)) {
      throw new Error(`Manifest contains duplicate migration name: ${name}`);
    }
    names.add(name);
    if (!["sql", "baseline"].includes(mode)) {
      throw new Error(`Migration ${name} has unsupported mode ${mode}.`);
    }

    const verifyFile = cleanText(entry.verify_file, 255);
    if (!verifyFile || !verifyFile.endsWith("_verify.sql")) {
      throw new Error(`Migration ${name} requires a matching *_verify.sql file.`);
    }
    const verifyPath = resolveMigrationFile(verifyFile);
    if (!fs.existsSync(verifyPath)) {
      throw new Error(`Verification file is missing for ${name}: ${verifyFile}`);
    }

    let migrationFile = null;
    let migrationPath = null;
    if (mode === "sql") {
      migrationFile = cleanText(entry.migration_file, 255);
      if (!migrationFile || migrationFile.endsWith("_verify.sql")) {
        throw new Error(`SQL migration ${name} requires migration_file.`);
      }
      migrationPath = resolveMigrationFile(migrationFile);
      if (!fs.existsSync(migrationPath)) {
        throw new Error(`Migration file is missing for ${name}: ${migrationFile}`);
      }
    }

    const verifySource = fs.readFileSync(verifyPath, "utf8");
    if (WRITE_PATTERN.test(stripSqlComments(verifySource))) {
      throw new Error(`Verification SQL for ${name} is not read-only.`);
    }

    const migrationSource =
      mode === "sql"
        ? fs.readFileSync(migrationPath, "utf8")
        : `BASELINE:${name}:${cleanText(entry.description, 2000)}`;

    return {
      name,
      mode,
      description: cleanText(entry.description, 2000),
      backupRequired: Boolean(entry.backup_required),
      migrationFile,
      migrationPath,
      verifyFile,
      verifyPath,
      migrationSource,
      verifySource,
      migrationChecksum: sha256(migrationSource),
      verificationChecksum: sha256(verifySource),
    };
  });

  return {
    manifestVersion: cleanText(manifest.manifest_version || "1", 40),
    migrations,
  };
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of String(sqlText || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "");
      continue;
    }

    buffer += `${rawLine}\n`;
    if (!buffer.trimEnd().endsWith(delimiter)) continue;
    const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function historyTableExists(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = ?
     LIMIT 1`,
    [HISTORY_TABLE]
  );
  return rows.length === 1;
}

async function assertHistoryTableReady(connection) {
  if (!(await historyTableExists(connection))) {
    const error = new Error(
      "Controlled migration history is missing. Apply migrations only through scripts/runControlledDeployment.js so backup evidence is verified before the ledger is created."
    );
    error.code = "CONTROLLED_MIGRATION_HISTORY_REQUIRED";
    throw error;
  }

  const requiredColumns = [
    "migration_name",
    "migration_mode",
    "migration_checksum_sha256",
    "verification_checksum_sha256",
    "manifest_version",
    "backup_attestation_sha256",
    "backup_source",
    "backup_reference",
    "backup_created_at",
    "approved_by",
    "change_ticket",
    "verification_status",
    "verification_summary",
    "applied_at",
  ];
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [HISTORY_TABLE]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  const missing = requiredColumns.filter((column) => !existing.has(column));
  if (missing.length) {
    const error = new Error(
      `Controlled migration history is incomplete: ${missing.join(", ")}.`
    );
    error.code = "CONTROLLED_MIGRATION_HISTORY_SCHEMA_INCOMPLETE";
    error.missingColumns = missing.map((column) => `${HISTORY_TABLE}.${column}`);
    throw error;
  }
}

async function loadHistory(connection) {
  if (!(await historyTableExists(connection))) return new Map();
  const [rows] = await connection.query(
    `SELECT * FROM controlled_migration_history ORDER BY id ASC`
  );
  return new Map(rows.map((row) => [row.migration_name, row]));
}

function assertHistoryIntegrity(entry, historyRow) {
  if (!historyRow) return;
  if (historyRow.migration_checksum_sha256 !== entry.migrationChecksum) {
    throw new Error(
      `Applied migration ${entry.name} no longer matches its immutable checksum.`
    );
  }
  if (historyRow.verification_checksum_sha256 !== entry.verificationChecksum) {
    throw new Error(
      `Verification file for applied migration ${entry.name} has changed.`
    );
  }
  if (String(historyRow.verification_status).toLowerCase() !== "passed") {
    throw new Error(
      `Applied migration ${entry.name} does not have a passed verification record.`
    );
  }
}

function verificationRowProblems(rows) {
  const problems = [];
  for (const row of rows) {
    const status = cleanText(row.status, 40).toUpperCase();
    if (status && !["PASS", "READY", "OK", "SUCCESS"].includes(status)) {
      problems.push(row);
      continue;
    }
    for (const key of [
      "problem_count",
      "missing_count",
      "error_count",
      "orphan_count",
    ]) {
      if (row[key] !== undefined && Number(row[key] || 0) !== 0) {
        problems.push(row);
        break;
      }
    }
    if (row.ready !== undefined && ![true, 1, "1"].includes(row.ready)) {
      problems.push(row);
    }
  }
  return problems;
}

async function executeVerification(connection, entry) {
  const statements = splitSqlStatements(entry.verifySource);
  if (!statements.length) {
    throw new Error(`Verification file for ${entry.name} contains no SQL statements.`);
  }

  const resultSets = [];
  for (const statement of statements) {
    if (WRITE_PATTERN.test(stripSqlComments(statement))) {
      throw new Error(`Verification statement for ${entry.name} is not read-only.`);
    }
    const [rows] = await connection.query(statement);
    if (Array.isArray(rows)) resultSets.push(rows);
  }

  const problems = resultSets.flatMap(verificationRowProblems);
  if (problems.length) {
    const error = new Error(
      `Read-only verification failed for ${entry.name}: ${JSON.stringify(problems).slice(
        0,
        3000
      )}`
    );
    error.code = "CONTROLLED_MIGRATION_VERIFICATION_FAILED";
    error.verificationProblems = problems;
    throw error;
  }

  return {
    statement_count: statements.length,
    result_set_count: resultSets.length,
    checked_row_count: resultSets.reduce((sum, rows) => sum + rows.length, 0),
  };
}

async function runApplicationSchemaReadiness(connection) {
  await assertBranchSchemaReady(connection);
  await ensureConfigurationTables(connection);
  await ensureWorkerHrLetterSchema(connection);
  await ensureEmploymentDocumentSchema(connection);
  await ensurePasskeySchema(connection);

  const equipment = await verifyFoundation(connection);
  if (!equipment.core?.ready || !equipment.commercial?.ready) {
    const error = new Error(
      "Equipment Catalogue or Equipment Sales schema readiness failed."
    );
    error.code = "EQUIPMENT_SCHEMA_NOT_READY";
    error.missingTables = equipment.commercial?.missing_tables || [];
    error.missingColumns = equipment.commercial?.missing_columns || [];
    throw error;
  }
  if (!equipment.safety?.ready || !equipment.retirement?.ready) {
    const error = new Error(
      "Equipment transaction or Spare Parts retirement database safeguards are incomplete."
    );
    error.code = "DATABASE_SAFETY_TRIGGERS_NOT_READY";
    error.missingTriggers = [
      ...(equipment.safety?.missing || []),
      ...(equipment.retirement?.missing || []),
    ];
    throw error;
  }

  const recoveryContract = await loadCanonicalContract(connection);
  return {
    canonical_table_count: recoveryContract.canonicalTables.length,
    schema_fingerprint_sha256: recoveryContract.schemaFingerprintSha256,
    equipment_core_ready: true,
    equipment_commercial_ready: true,
    biometric_ready: true,
    worker_documents_ready: true,
    configuration_ready: true,
  };
}

function productionApproval(entry) {
  const environment = readProductionAttestationEnvironment(entry);
  return {
    backupAttestation: environment.checksum,
    backupSource: environment.source,
    backupReference: environment.reference,
    backupCreatedAt: environment.createdAt,
    approvedBy: environment.approvedBy,
    changeTicket: environment.changeTicket,
  };
}

async function executeSqlMigration(connection, entry) {
  const statements = splitSqlStatements(entry.migrationSource);
  if (!statements.length) {
    throw new Error(`Migration ${entry.name} contains no SQL statements.`);
  }

  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      const wrapped = new Error(
        `Migration ${entry.name} failed at statement ${index + 1}: ${error.message}`
      );
      wrapped.code = error.code || "CONTROLLED_MIGRATION_STATEMENT_FAILED";
      wrapped.statementIndex = index + 1;
      throw wrapped;
    }
  }

  return statements.length;
}

async function recordMigration(
  connection,
  manifestVersion,
  entry,
  approval,
  verification
) {
  await connection.query(
    `INSERT INTO controlled_migration_history (
       migration_name, migration_mode, migration_checksum_sha256,
       verification_checksum_sha256, manifest_version, application_version,
       backup_attestation_sha256, backup_source, backup_reference,
       backup_created_at, approved_by, change_ticket,
       verification_status, verification_summary, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, NOW())`,
    [
      entry.name,
      entry.mode,
      entry.migrationChecksum,
      entry.verificationChecksum,
      manifestVersion,
      APP_VERSION,
      approval.backupAttestation,
      approval.backupSource,
      approval.backupReference,
      approval.backupCreatedAt,
      approval.approvedBy,
      approval.changeTicket,
      JSON.stringify(verification),
    ]
  );

  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [entry.name, entry.description || "Controlled Chalin 03 migration."]
  );
}

async function planMigrations(connection, manifest) {
  const history = await loadHistory(connection);
  return manifest.migrations.map((entry) => {
    const historyRow = history.get(entry.name);
    assertHistoryIntegrity(entry, historyRow);
    return {
      name: entry.name,
      mode: entry.mode,
      status: historyRow ? "applied" : "pending",
      backup_required: entry.backupRequired,
      migration_checksum_sha256: entry.migrationChecksum,
      verification_checksum_sha256: entry.verificationChecksum,
    };
  });
}

async function applyMigrations(
  connection,
  manifest,
  { authorizedApply = false } = {}
) {
  if (!authorizedApply) {
    const error = new Error(
      "Direct migration apply is disabled. Use scripts/runControlledDeployment.js so production backup evidence and migration-ledger bootstrap are verified first."
    );
    error.code = "CONTROLLED_DEPLOYMENT_WRAPPER_REQUIRED";
    throw error;
  }

  const [lockRows] = await connection.query(
    "SELECT GET_LOCK(?, 60) AS acquired",
    [LOCK_NAME]
  );
  if (Number(lockRows[0]?.acquired || 0) !== 1) {
    throw new Error("Could not acquire the controlled migration advisory lock.");
  }

  try {
    await assertHistoryTableReady(connection);
    const history = await loadHistory(connection);
    const applied = [];
    const skipped = [];

    for (const entry of manifest.migrations) {
      const historyRow = history.get(entry.name);
      if (historyRow) {
        assertHistoryIntegrity(entry, historyRow);
        skipped.push(entry.name);
        continue;
      }

      const approval = await verifyProductionBackupAttestation(connection, entry);
      const statementCount =
        entry.mode === "sql" ? await executeSqlMigration(connection, entry) : 0;
      const sqlVerification = await executeVerification(connection, entry);
      const applicationReadiness = await runApplicationSchemaReadiness(connection);
      const verification = {
        migration_statement_count: statementCount,
        sql: sqlVerification,
        application: applicationReadiness,
        backup_evidence: {
          required: approval.required,
          source: approval.backupSource,
          reference: approval.backupReference,
          created_at: approval.backupCreatedAt,
          verified_at: approval.backupVerifiedAt,
          schema_fingerprint_sha256:
            approval.backupSchemaFingerprintSha256,
        },
      };

      await recordMigration(
        connection,
        manifest.manifestVersion,
        entry,
        approval,
        verification
      );
      applied.push(entry.name);
    }

    return { applied, skipped };
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]);
    } catch {
      // Connection is released by the caller.
    }
  }
}

async function run(options = parseArguments(process.argv.slice(2))) {
  const manifest = loadManifest();
  const connection = await pool.getConnection();

  try {
    if (options.mode === "plan") {
      const plan = await planMigrations(connection, manifest);
      console.log(JSON.stringify({ status: "success", mode: "plan", plan }, null, 2));
      return { mode: "plan", plan };
    }

    if (!options.authorizedApply) {
      const error = new Error(
        "Apply mode must be launched through scripts/runControlledDeployment.js."
      );
      error.code = "CONTROLLED_DEPLOYMENT_WRAPPER_REQUIRED";
      throw error;
    }

    const result = await applyMigrations(connection, manifest, {
      authorizedApply: true,
    });
    console.log(
      JSON.stringify(
        {
          status: "success",
          mode: options.deployment ? "deployment" : "apply",
          ...result,
        },
        null,
        2
      )
    );
    return result;
  } finally {
    connection.release();
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error("Controlled migration failed:", {
      code: error?.code,
      message: error?.message,
      statement_index: error?.statementIndex,
      missing_tables: error?.missingTables,
      missing_columns: error?.missingColumns,
      missing_triggers: error?.missingTriggers,
      verification_problems: error?.verificationProblems,
    });
    try {
      await pool.end();
    } catch {
      // Process is already failing closed.
    }
    process.exitCode = 1;
  });
}

module.exports = {
  HISTORY_TABLE,
  LOCK_NAME,
  MANIFEST_PATH,
  WRITE_PATTERN,
  applyMigrations,
  assertHistoryIntegrity,
  assertHistoryTableReady,
  executeVerification,
  historyTableExists,
  loadManifest,
  parseArguments,
  planMigrations,
  productionApproval,
  runApplicationSchemaReadiness,
  sha256,
  splitSqlStatements,
  stripSqlComments,
  verificationRowProblems,
};
