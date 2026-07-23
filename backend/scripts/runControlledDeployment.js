require("dotenv").config();

const { pool } = require("../config/db");
const {
  HISTORY_TABLE,
  LOCK_NAME,
  applyMigrations,
  loadManifest,
  parseArguments,
  planMigrations,
} = require("./runControlledMigrations");
const {
  verifyProductionBackupAttestation,
} = require("../services/migrationBackupAttestationService");

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

async function bootstrapHistoryTable() {
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, 60) AS acquired",
      [`${LOCK_NAME}_bootstrap`]
    );
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the migration-ledger bootstrap lock.");
    }

    if (await historyTableExists(connection)) {
      return { created: false };
    }

    const approval = await verifyProductionBackupAttestation(connection, {
      name: "controlled_migration_history_bootstrap",
      mode: "sql",
      backupRequired: true,
    });

    const production =
      String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
    if (production && approval.backupSource !== "railway_snapshot") {
      const error = new Error(
        "The one-time controlled migration ledger bootstrap requires a fresh Railway database snapshot. After the ledger exists, later migrations may use a verified Chalin 03 backup."
      );
      error.code = "MIGRATION_LEDGER_RAILWAY_SNAPSHOT_REQUIRED";
      throw error;
    }

    await connection.query(
      `CREATE TABLE controlled_migration_history (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         migration_name VARCHAR(180) NOT NULL UNIQUE,
         migration_mode VARCHAR(30) NOT NULL,
         migration_checksum_sha256 CHAR(64) NOT NULL,
         verification_checksum_sha256 CHAR(64) NOT NULL,
         manifest_version VARCHAR(40) NOT NULL,
         application_version VARCHAR(40) NULL,
         backup_attestation_sha256 CHAR(64) NULL,
         backup_source VARCHAR(40) NULL,
         backup_reference VARCHAR(180) NULL,
         backup_created_at DATETIME NULL,
         approved_by VARCHAR(180) NULL,
         change_ticket VARCHAR(180) NULL,
         verification_status VARCHAR(30) NOT NULL,
         verification_summary TEXT NULL,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_controlled_migration_applied (applied_at),
         INDEX idx_controlled_migration_status (verification_status, applied_at),
         INDEX idx_controlled_migration_backup (backup_source, backup_created_at)
       )`
    );

    await connection.query(
      `INSERT INTO controlled_migration_history (
         migration_name, migration_mode, migration_checksum_sha256,
         verification_checksum_sha256, manifest_version, application_version,
         backup_attestation_sha256, backup_source, backup_reference,
         backup_created_at, approved_by, change_ticket,
         verification_status, verification_summary, applied_at
       ) VALUES (
         'controlled_migration_history_bootstrap', 'bootstrap',
         SHA2('controlled_migration_history_bootstrap_v1', 256),
         SHA2('controlled_migration_history_bootstrap_verified_v1', 256),
         '1', NULL, ?, ?, ?, ?, ?, ?, 'passed',
         'Migration history ledger created under the controlled deployment lock after Railway snapshot evidence verification.',
         NOW()
       )`,
      [
        approval.backupAttestation,
        approval.backupSource,
        approval.backupReference,
        approval.backupCreatedAt,
        approval.approvedBy,
        approval.changeTicket,
      ]
    );

    return {
      created: true,
      backup_source: approval.backupSource,
      backup_reference: approval.backupReference,
    };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [
          `${LOCK_NAME}_bootstrap`,
        ]);
      } catch {
        // Connection is released below.
      }
    }
    connection.release();
  }
}

async function runControlledMigrationCore(options) {
  const manifest = loadManifest();
  const connection = await pool.getConnection();

  try {
    if (options.mode === "plan") {
      const plan = await planMigrations(connection, manifest);
      console.log(JSON.stringify({ status: "success", mode: "plan", plan }, null, 2));
      return { mode: "plan", plan };
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
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.mode === "apply") {
    await bootstrapHistoryTable();
  }
  return runControlledMigrationCore(options);
}

if (require.main === module) {
  main()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      console.error("Controlled deployment failed:", {
        code: error?.code,
        message: error?.message,
        backup_created_at: error?.backupCreatedAt,
        max_age_hours: error?.maxAgeHours,
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
  bootstrapHistoryTable,
  historyTableExists,
  main,
  runControlledMigrationCore,
};
