require("dotenv").config();

const { pool } = require("../config/db");
const {
  HISTORY_TABLE,
  LOCK_NAME,
  parseArguments,
  productionApproval,
  run,
} = require("./runControlledMigrations");

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

    const approval = productionApproval({
      name: "controlled_migration_history_bootstrap",
      mode: "sql",
      backupRequired: true,
    });

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
         approved_by VARCHAR(180) NULL,
         change_ticket VARCHAR(180) NULL,
         verification_status VARCHAR(30) NOT NULL,
         verification_summary TEXT NULL,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_controlled_migration_applied (applied_at),
         INDEX idx_controlled_migration_status (verification_status, applied_at)
       )`
    );

    await connection.query(
      `INSERT INTO controlled_migration_history (
         migration_name, migration_mode, migration_checksum_sha256,
         verification_checksum_sha256, manifest_version, application_version,
         backup_attestation_sha256, approved_by, change_ticket,
         verification_status, verification_summary, applied_at
       ) VALUES (
         'controlled_migration_history_bootstrap', 'bootstrap',
         SHA2('controlled_migration_history_bootstrap_v1', 256),
         SHA2('controlled_migration_history_bootstrap_verified_v1', 256),
         '1', NULL, ?, ?, ?, 'passed',
         'Migration history ledger created under the controlled deployment lock before any release migration.',
         NOW()
       )`,
      [
        approval.backupAttestation,
        approval.approvedBy,
        approval.changeTicket,
      ]
    );

    return { created: true };
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

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.mode === "apply") {
    await bootstrapHistoryTable();
  }
  return run(options);
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("Controlled deployment failed:", {
      code: error?.code,
      message: error?.message,
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
};
