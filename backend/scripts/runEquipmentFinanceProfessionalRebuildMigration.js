const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260731_EQUIPMENT_FINANCE_PROFESSIONAL";
const MIGRATION_RECORD = "20260731_equipment_finance_professional_rebuild";
const MIGRATION_LOCK_NAME =
  "chalin03:production-migrations:20260731-equipment-finance-professional";
const MIGRATION_FILE = "20260731_equipment_finance_professional_rebuild.sql";
const VERIFIER_FILE =
  "20260731_equipment_finance_professional_rebuild_verify.sql";
const SNAPSHOT_MANIFEST_TABLE = "chalin03_migration_safety_snapshots";
const SNAPSHOT_TABLES = Object.freeze([
  Object.freeze({
    source: "fleet_assets",
    snapshot: "chalin03_snap_20260731_fin_fleet_assets",
  }),
  Object.freeze({
    source: "equipment_sale_agreements",
    snapshot: "chalin03_snap_20260731_fin_sale_agreements",
  }),
  Object.freeze({
    source: "schema_migrations",
    snapshot: "chalin03_snap_20260731_fin_schema_migrations",
  }),
]);
const EXPECTED_PROBLEMS = Object.freeze([
  "missing_professional_finance_tables",
  "missing_professional_finance_columns",
  "missing_professional_finance_indexes",
  "missing_professional_finance_foreign_keys",
  "invalid_professional_finance_settings",
  "duplicate_professional_finance_settings",
  "invalid_professional_finance_documents",
  "invalid_professional_finance_signatures",
  "invalid_professional_finance_payment_alerts",
  "professional_finance_migration_record_missing",
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

function quoteIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
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
    throw new Error("Professional Finance migration requires NODE_ENV=production.");
  }
  if (!booleanValue(env.CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED)) {
    throw new Error(
      "Set CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED=true only for the controlled migration operation."
    );
  }
  if (!booleanValue(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Confirm the verified signed Professional Backup first.");
  }
  if (
    String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact release.`
    );
  }
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (buffer.trim()) {
        throw new Error("SQL DELIMITER appeared before the previous statement ended.");
      }
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

function readSql(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function execute(connection, statements, label) {
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

function validateVerifierResults(results) {
  if (results.length !== EXPECTED_PROBLEMS.length) {
    throw new Error(
      `Professional Finance verifier returned ${results.length} result sets; expected ${EXPECTED_PROBLEMS.length}.`
    );
  }
  EXPECTED_PROBLEMS.forEach((key, index) => {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(`Verifier did not return exactly one ${key} row.`);
    }
    const value = Number(rows[0]?.[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Verifier did not return numeric ${key}.`);
    }
    if (value !== 0) {
      throw new Error(`Verifier returned ${key}=${value}; expected 0.`);
    }
  });
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

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.present || 0) === 1;
}

async function tableRowCount(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`
  );
  return Number(rows[0]?.row_count || 0);
}

async function migrationAlreadyApplied(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS applied
     FROM schema_migrations
     WHERE migration_name = ?`,
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function ensureSnapshotManifest(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(SNAPSHOT_MANIFEST_TABLE)} (
      release_id VARCHAR(100) NOT NULL PRIMARY KEY,
      database_name VARCHAR(150) NOT NULL,
      snapshot_status ENUM('creating','ready') NOT NULL DEFAULT 'creating',
      fleet_assets_rows BIGINT NOT NULL DEFAULT 0,
      sale_agreements_rows BIGINT NOT NULL DEFAULT 0,
      schema_migrations_rows BIGINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME NULL
    )`
  );
}

async function verifyReadySafetySnapshot(connection, manifest) {
  const expectedCounts = {
    chalin03_snap_20260731_fin_fleet_assets: Number(
      manifest.fleet_assets_rows || 0
    ),
    chalin03_snap_20260731_fin_sale_agreements: Number(
      manifest.sale_agreements_rows || 0
    ),
    chalin03_snap_20260731_fin_schema_migrations: Number(
      manifest.schema_migrations_rows || 0
    ),
  };

  for (const { snapshot } of SNAPSHOT_TABLES) {
    if (!(await tableExists(connection, snapshot))) {
      throw new Error(`Required database-side safety snapshot ${snapshot} is missing.`);
    }
    const actual = await tableRowCount(connection, snapshot);
    if (actual !== expectedCounts[snapshot]) {
      throw new Error(
        `Safety snapshot ${snapshot} has ${actual} rows; expected ${expectedCounts[snapshot]}.`
      );
    }
  }
}

async function createOrVerifySafetySnapshot(connection, databaseName) {
  await ensureSnapshotManifest(connection);
  const [manifestRows] = await connection.query(
    `SELECT *
     FROM ${quoteIdentifier(SNAPSHOT_MANIFEST_TABLE)}
     WHERE release_id = ?
     LIMIT 1`,
    [RELEASE_CONFIRMATION]
  );
  const existing = manifestRows[0];
  if (existing?.snapshot_status === "ready") {
    if (String(existing.database_name || "") !== databaseName) {
      throw new Error("Safety snapshot database identity does not match the connected database.");
    }
    await verifyReadySafetySnapshot(connection, existing);
    console.log("Existing database-side Professional Finance safety snapshot verified.");
    return;
  }

  await connection.query(
    `INSERT INTO ${quoteIdentifier(SNAPSHOT_MANIFEST_TABLE)} (
      release_id,
      database_name,
      snapshot_status
    ) VALUES (?, ?, 'creating')
    ON DUPLICATE KEY UPDATE
      database_name = VALUES(database_name),
      snapshot_status = 'creating'`,
    [RELEASE_CONFIRMATION, databaseName]
  );

  const counts = {};
  for (const { source, snapshot } of SNAPSHOT_TABLES) {
    if (!(await tableExists(connection, source))) {
      throw new Error(`Cannot snapshot missing source table ${source}.`);
    }
    if (!(await tableExists(connection, snapshot))) {
      await connection.query(
        `CREATE TABLE ${quoteIdentifier(snapshot)} LIKE ${quoteIdentifier(source)}`
      );
    } else {
      await connection.query(`TRUNCATE TABLE ${quoteIdentifier(snapshot)}`);
    }
    await connection.query(
      `INSERT INTO ${quoteIdentifier(snapshot)} SELECT * FROM ${quoteIdentifier(source)}`
    );
    const sourceCount = await tableRowCount(connection, source);
    const snapshotCount = await tableRowCount(connection, snapshot);
    if (sourceCount !== snapshotCount) {
      throw new Error(
        `Safety snapshot ${snapshot} copied ${snapshotCount} of ${sourceCount} rows.`
      );
    }
    counts[snapshot] = snapshotCount;
  }

  await connection.query(
    `UPDATE ${quoteIdentifier(SNAPSHOT_MANIFEST_TABLE)}
     SET snapshot_status = 'ready',
         fleet_assets_rows = ?,
         sale_agreements_rows = ?,
         schema_migrations_rows = ?,
         verified_at = CURRENT_TIMESTAMP
     WHERE release_id = ?`,
    [
      counts.chalin03_snap_20260731_fin_fleet_assets,
      counts.chalin03_snap_20260731_fin_sale_agreements,
      counts.chalin03_snap_20260731_fin_schema_migrations,
      RELEASE_CONFIRMATION,
    ]
  );

  const [readyRows] = await connection.query(
    `SELECT *
     FROM ${quoteIdentifier(SNAPSHOT_MANIFEST_TABLE)}
     WHERE release_id = ? AND snapshot_status = 'ready'
     LIMIT 1`,
    [RELEASE_CONFIRMATION]
  );
  if (!readyRows[0]) {
    throw new Error("Database-side Professional Finance safety snapshot was not finalised.");
  }
  await verifyReadySafetySnapshot(connection, readyRows[0]);
  console.log("Database-side Professional Finance safety snapshot created and verified.");
}

async function runEquipmentFinanceProfessionalRebuildMigration() {
  assertReleaseGates();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = String(databaseRow?.database_name || "").trim();
    const expectedDatabase = String(
      process.env.CHALIN03_EXPECTED_DATABASE || ""
    ).trim();
    if (!databaseName || !expectedDatabase) {
      throw new Error(
        "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
      );
    }
    if (databaseName !== expectedDatabase) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }

    const [[prerequisite]] = await connection.query(
      `SELECT COUNT(*) AS ready
       FROM schema_migrations
       WHERE migration_name IN (
         '20260729_equipment_credit_application_foundation',
         '20260729_equipment_finance_agreement_activation',
         '20260729_equipment_finance_deposit_reservation',
         '20260729_equipment_finance_final_lifecycle'
       )`
    );
    if (Number(prerequisite?.ready || 0) !== 4) {
      throw new Error(
        "The four approved 20260729 Equipment Finance prerequisite migrations are not all recorded."
      );
    }

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Professional Finance migration lock.");
    }

    const alreadyApplied = await migrationAlreadyApplied(connection);
    if (!alreadyApplied) {
      await createOrVerifySafetySnapshot(connection, databaseName);
    } else {
      console.log("Professional Finance migration record already exists; verifying release state.");
    }

    const migrationStatements = splitSqlScript(readSql(MIGRATION_FILE));
    const verifierStatements = splitSqlScript(readSql(VERIFIER_FILE));
    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Professional Finance release: ${RELEASE_CONFIRMATION}`);
    console.log(`Applying ${MIGRATION_FILE}...`);
    await execute(connection, migrationStatements, "Professional Finance migration");
    console.log(`Verifying ${VERIFIER_FILE}...`);
    const results = await execute(
      connection,
      verifierStatements,
      "Professional Finance verifier"
    );
    validateVerifierResults(results);
    console.log("Professional Equipment Installment Finance migration verified successfully.");
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
  runEquipmentFinanceProfessionalRebuildMigration().catch((error) => {
    console.error("Professional Equipment Finance migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  SNAPSHOT_MANIFEST_TABLE,
  SNAPSHOT_TABLES,
  VERIFIER_FILE,
  assertReleaseGates,
  createOrVerifySafetySnapshot,
  runEquipmentFinanceProfessionalRebuildMigration,
  splitSqlScript,
  validateVerifierResults,
};
