const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const {
  main: runControlledDeployment,
} = require("./runControlledDeployment");
const {
  splitSqlStatements,
} = require("./runControlledMigrations");
const {
  createFullSystemBackup,
  loadCanonicalContract,
  restoreFullSystemBackup,
  validateFullSystemBackup,
} = require("../services/fullSystemBackupService");
const { pool } = require("../config/db");

const CONFIRMATION_VALUE = "RUN_RELEASE31_DISPOSABLE_DRILL";
const AUDIT_MIGRATION_NAME = "20260723_release31_audit_schema_safety";
const AUDIT_BASELINE_NAME = "20260723_release31_audit_schema_baseline";

function env(primaryName, fallbackName, defaultValue = undefined) {
  return process.env[primaryName] || process.env[fallbackName] || defaultValue;
}

function connectionConfig() {
  return {
    host: env("DB_HOST", "MYSQLHOST", "127.0.0.1"),
    port: Number(env("DB_PORT", "MYSQLPORT", 3306)),
    user: env("DB_USER", "MYSQLUSER", "root"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD", ""),
    database: env("DB_NAME", "MYSQLDATABASE"),
    timezone: "Z",
    ssl: false,
    multipleStatements: false,
  };
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new Error(`Unsafe database identifier: ${text}`);
  }
  return `\`${text}\``;
}

function assertDisposableTarget(config) {
  const host = String(config.host || "").trim().toLowerCase();
  const database = String(config.database || "").trim().toLowerCase();
  const confirmation = String(
    process.env.CONFIRM_RELEASE31_DISPOSABLE_DRILL || ""
  ).trim();
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();

  if (confirmation !== CONFIRMATION_VALUE) {
    throw new Error(
      `Set CONFIRM_RELEASE31_DISPOSABLE_DRILL=${CONFIRMATION_VALUE} before running the destructive drill.`
    );
  }
  if (nodeEnv === "production") {
    throw new Error("The disposable Release 3.1 drill may never run with NODE_ENV=production.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("The disposable Release 3.1 drill is restricted to a local MySQL host.");
  }
  if (!database || !database.endsWith("_test")) {
    throw new Error("The disposable Release 3.1 drill requires DB_NAME to end in _test.");
  }
  if (host.includes("railway") || database.includes("railway")) {
    throw new Error("Railway-like hosts and database names are forbidden for this drill.");
  }
}

async function executeSqlFile(connection, relativePath) {
  const absolutePath = path.resolve(__dirname, relativePath);
  const statements = splitSqlStatements(fs.readFileSync(absolutePath, "utf8"));
  for (const statement of statements) {
    await connection.query(statement);
  }
  return statements.length;
}

async function clearDisposableDatabase(connection) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");

  const [triggers] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()`
  );
  for (const trigger of triggers) {
    await connection.query(
      `DROP TRIGGER IF EXISTS ${safeIdentifier(trigger.TRIGGER_NAME)}`
    );
  }

  const [views] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.VIEWS
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  for (const view of views) {
    await connection.query(`DROP VIEW IF EXISTS ${safeIdentifier(view.TABLE_NAME)}`);
  }

  const [tables] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'`
  );
  for (const table of tables) {
    await connection.query(`DROP TABLE IF EXISTS ${safeIdentifier(table.TABLE_NAME)}`);
  }

  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

async function seedRecoverySentinels(connection) {
  const ownerId = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
  const ownerUsername = String(process.env.SYSTEM_ADMIN_USERNAME || "admin")
    .trim()
    .toLowerCase();

  await connection.query(
    `INSERT INTO branches
       (id, code, branch_code, name, location, is_head_office, is_active)
     VALUES (1, 'DRILL-HQ', 'DRILL-HQ', 'Release 3.1 Drill Head Office',
             'Disposable CI database', TRUE, TRUE)`
  );
  await connection.query(
    `INSERT INTO users
       (id, full_name, username, password_hash, role, phone,
        default_branch_id, can_access_all_branches, is_active,
        must_change_password, token_version, created_by)
     VALUES (?, 'Release 3.1 Protected Owner', ?,
             '$2b$12$release31DisposableDrillHashOnly000000000000000000000',
             'admin', '0000000000', 1, TRUE, TRUE, FALSE, 0, NULL)`,
    [ownerId, ownerUsername]
  );
  await connection.query(
    `INSERT INTO user_branch_access
       (user_id, branch_id, access_role, is_primary, can_access)
     VALUES (?, 1, 'admin', TRUE, TRUE)`,
    [ownerId]
  );

  return { ownerId, ownerUsername };
}

async function assertIncompleteBackupRejected(connection, backup) {
  const incomplete = JSON.parse(JSON.stringify(backup));
  const removableTable = incomplete.included_tables.find(
    (tableName) => !["branches", "schema_migrations", "users"].includes(tableName)
  );
  if (!removableTable) {
    throw new Error("No non-core canonical table was available for the incomplete-backup test.");
  }

  delete incomplete.tables[removableTable];
  const [beforeRows] = await connection.query(
    "SELECT COUNT(*) AS total_count FROM users"
  );
  const validation = await validateFullSystemBackup(connection, incomplete);
  const [afterRows] = await connection.query(
    "SELECT COUNT(*) AS total_count FROM users"
  );

  if (validation.valid) {
    throw new Error("The incomplete backup was incorrectly accepted.");
  }
  if (
    Number(beforeRows[0]?.total_count || 0) !==
    Number(afterRows[0]?.total_count || 0)
  ) {
    throw new Error("Incomplete-backup validation changed database records.");
  }

  return {
    removed_table: removableTable,
    error_count: validation.errors.length,
    database_unchanged: true,
  };
}

async function assertMigrationHistory(connection) {
  const [rows] = await connection.query(
    `SELECT migration_name, verification_status
     FROM controlled_migration_history
     ORDER BY applied_at, id`
  );
  const passed = new Map(
    rows.map((row) => [row.migration_name, row.verification_status])
  );

  for (const migrationName of [AUDIT_MIGRATION_NAME, AUDIT_BASELINE_NAME]) {
    if (passed.get(migrationName) !== "passed") {
      throw new Error(
        `Controlled migration history does not contain a passed record for ${migrationName}.`
      );
    }
  }

  return rows;
}

async function run() {
  const config = connectionConfig();
  assertDisposableTarget(config);

  const directConnection = await mysql.createConnection(config);
  let applicationConnection;

  try {
    await clearDisposableDatabase(directConnection);
    const schemaStatementCount = await executeSqlFile(
      directConnection,
      "../../database/schema.sql"
    );
    await directConnection.end();

    await runControlledDeployment(["--apply"]);
    applicationConnection = await pool.getConnection();

    const migrationHistoryBeforeBackup = await assertMigrationHistory(
      applicationConnection
    );
    const owner = await seedRecoverySentinels(applicationConnection);
    const { backup, contract } = await createFullSystemBackup(
      applicationConnection,
      {
        createdBy: {
          id: owner.ownerId,
          username: owner.ownerUsername,
          authority: "release31_disposable_drill",
        },
      }
    );

    const validation = await validateFullSystemBackup(
      applicationConnection,
      backup,
      {
        requester: {
          id: owner.ownerId,
          username: owner.ownerUsername,
        },
        requireRequesterPresence: true,
      }
    );
    if (!validation.valid) {
      throw new Error(
        `Fresh canonical backup failed validation: ${validation.errors.join(" | ")}`
      );
    }

    const incompleteBackupCheck = await assertIncompleteBackupRejected(
      applicationConnection,
      backup
    );

    await applicationConnection.query(
      "UPDATE users SET full_name = 'CORRUPTED DRILL VALUE', token_version = 99 WHERE id = ?",
      [owner.ownerId]
    );
    await applicationConnection.query(
      `INSERT INTO branches
         (code, branch_code, name, location, is_head_office, is_active)
       VALUES ('DRILL-CONTAMINATION', 'DRILL-CONTAMINATION',
               'Data that must disappear after restore',
               'Disposable CI database', FALSE, TRUE)`
    );

    const restoreResult = await restoreFullSystemBackup(
      applicationConnection,
      backup,
      validation
    );

    const [ownerRows] = await applicationConnection.query(
      `SELECT full_name, token_version
       FROM users
       WHERE id = ? AND username = ?`,
      [owner.ownerId, owner.ownerUsername]
    );
    const [contaminationRows] = await applicationConnection.query(
      "SELECT COUNT(*) AS total_count FROM branches WHERE code = 'DRILL-CONTAMINATION'"
    );
    const restoredOwner = ownerRows[0];
    if (!restoredOwner) {
      throw new Error("The protected owner record was not restored.");
    }
    if (restoredOwner.full_name !== "Release 3.1 Protected Owner") {
      throw new Error("The protected owner sentinel did not reconcile to the backup value.");
    }
    if (Number(restoredOwner.token_version || 0) <= 0) {
      throw new Error("Restored security state did not revoke existing sessions.");
    }
    if (Number(contaminationRows[0]?.total_count || 0) !== 0) {
      throw new Error("Post-backup contamination remained after restore.");
    }

    const postRestoreContract = await loadCanonicalContract(applicationConnection);
    if (
      postRestoreContract.schemaFingerprintSha256 !==
      backup.schema_fingerprint_sha256
    ) {
      throw new Error("Schema fingerprint changed during the backup/restore drill.");
    }
    const migrationHistoryAfterRestore = await assertMigrationHistory(
      applicationConnection
    );

    const evidence = {
      status: "passed",
      generated_at: new Date().toISOString(),
      target: {
        host: config.host,
        port: config.port,
        database: config.database,
      },
      schema_statement_count: schemaStatementCount,
      canonical_table_count: contract.canonicalTables.length,
      schema_fingerprint_sha256: backup.schema_fingerprint_sha256,
      backup_id: backup.backup_id,
      backup_checksum_sha256: backup.checksum_sha256,
      backup_total_record_count: backup.total_record_count,
      incomplete_backup_check: incompleteBackupCheck,
      restored_table_count: restoreResult.restoredTables.length,
      restored_security_invalidation: restoreResult.securityInvalidation,
      migration_history_before_backup: migrationHistoryBeforeBackup,
      migration_history_after_restore: migrationHistoryAfterRestore,
      protected_owner_restored: true,
      restored_token_version: Number(restoredOwner.token_version || 0),
      contamination_removed: true,
    };

    const evidencePath = path.resolve(
      process.env.RELEASE31_DRILL_EVIDENCE_PATH ||
        path.join(__dirname, "../release31-disposable-drill-evidence.json")
    );
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    return evidence;
  } finally {
    if (applicationConnection) applicationConnection.release();
    try {
      await directConnection.end();
    } catch {
      // It may already have been closed before controlled migrations ran.
    }
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Release 3.1 disposable drill failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION_VALUE,
  assertDisposableTarget,
  connectionConfig,
  run,
};
