const express = require("express");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const {
  validateBackupDryRunRequest,
  validateBackupRestoreRequest,
} = require("../validation/requestValidators");
const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  EPHEMERAL_SECURITY_TABLES,
  checksumBackup,
  classifyDatabaseTables,
  isSafeIdentifier,
  safeTableName,
  signBackup,
  validateBackupContract,
} = require("../services/backupSafetyService");

const router = express.Router();
const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const RESTORE_LOCK_NAME = "chalin03_full_system_restore_v2";
const BUFFER_MARKER = "buffer_base64";

function requireOriginalSystemAdministrator(req, res, next) {
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({
      status: "error",
      code: "SYSTEM_ADMINISTRATOR_REQUIRED",
      message:
        "Only the original System Administrator can download, validate or restore a full-system backup.",
    });
  }
  return next();
}

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function backupSigningSecret() {
  return String(process.env.BACKUP_SIGNING_SECRET || "").trim();
}

function requireBackupSigningReady(res) {
  const secret = backupSigningSecret();
  if (isProduction() && secret.length < 64) {
    res.status(503).json({
      status: "error",
      code: "BACKUP_SIGNING_NOT_CONFIGURED",
      message:
        "Full-system backup signing is not configured. The server refused to create or restore an unauthenticated production backup.",
    });
    return null;
  }
  return secret;
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}

function mysqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function encodeBackupValue(value) {
  if (Buffer.isBuffer(value)) {
    return {
      __chalin03_type: BUFFER_MARKER,
      data: value.toString("base64"),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

function decodeRestoreValue(value, columnType) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.__chalin03_type === BUFFER_MARKER &&
    typeof value.data === "string"
  ) {
    return Buffer.from(value.data, "base64");
  }

  const type = String(columnType || "").toLowerCase();
  if (typeof value === "string" && /^date$/.test(type)) {
    return value.slice(0, 10);
  }
  if (
    typeof value === "string" &&
    /^(datetime|timestamp)/.test(type) &&
    value.includes("T")
  ) {
    return mysqlDateTime(value);
  }
  return value;
}

async function getAllBaseTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  return rows.map((row) => row.TABLE_NAME).filter(isSafeIdentifier);
}

async function tableExists(connection, tableName) {
  if (!isSafeIdentifier(tableName)) return false;
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND TABLE_TYPE = 'BASE TABLE'
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function getInsertableColumnMetadata(connection, tableName) {
  const [rows] = await connection.query(`SHOW FULL COLUMNS FROM ${safeTableName(tableName)}`);
  return rows
    .filter((column) => !String(column.Extra || "").toLowerCase().includes("generated"))
    .map((column) => ({
      name: column.Field,
      type: String(column.Type || "").toLowerCase(),
      nullable: String(column.Null || "").toUpperCase() === "YES",
      hasDefault: column.Default !== null,
      defaultValue: column.Default,
      extra: String(column.Extra || "").toLowerCase(),
    }))
    .filter((column) => isSafeIdentifier(column.name));
}

async function getSchemaSnapshot(connection, includedTables) {
  const metadata = {};
  const tableColumns = {};
  for (const tableName of includedTables) {
    const columns = await getInsertableColumnMetadata(connection, tableName);
    if (!columns.length) {
      const error = new Error(`No restorable columns were found for ${tableName}.`);
      error.code = "BACKUP_TABLE_COLUMNS_MISSING";
      throw error;
    }
    metadata[tableName] = columns;
    tableColumns[tableName] = columns.map((column) => column.name);
  }
  return { metadata, tableColumns };
}

async function getSchemaMigrations(connection) {
  if (!(await tableExists(connection, "schema_migrations"))) return [];
  const [rows] = await connection.query(
    `SELECT migration_name, description, applied_at
     FROM schema_migrations
     ORDER BY migration_name`
  );
  return rows.map((row) => ({
    migration_name: row.migration_name,
    description: row.description || null,
    applied_at: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
  }));
}

async function loadBackupTable(connection, tableName, columns) {
  const columnSql = columns.map((column) => `\`${column}\``).join(", ");
  const [rows] = await connection.query(
    `SELECT ${columnSql} FROM ${safeTableName(tableName)}`
  );
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, encodeBackupValue(row[column])]))
  );
}

async function writeSecurityAudit(req, action, details, metadata = {}) {
  try {
    await writeAuditEvent({
      req,
      userId: req.user?.id || null,
      branchId: getBranchId(req),
      action,
      details,
      workspaceCode: "spare_parts",
      entityType: "backup",
      actionType: action,
      outcome: "success",
      severity: "critical",
      metadata,
    });
  } catch (error) {
    console.warn(`${action} audit warning:`, error.message);
  }
}

async function sendBackupSecurityAlert(req, backup) {
  try {
    const branchId = getBranchId(req);
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const createdBy = req.user?.full_name || req.user?.username || "Admin";
    await sendOwnerSmsAlert({
      branchId,
      message: `${businessName}: Security alert. A signed full-system backup ${backup.backup_id} was created for ${branch.name} (${branch.code}) by ${createdBy} on ${formatSecurityDateTime(backup.created_at)}. Tables: ${backup.included_tables.length}. Records: ${backup.total_record_count}. Keep the file private.`,
      smsType: "security_alert",
      sentBy: req.user?.id || null,
      sourceReference: `full-backup:${backup.backup_id}`,
    });
  } catch (error) {
    console.warn("Backup security SMS warning:", error.message);
  }
}

async function buildFullSystemBackup(connection, req, signingSecret) {
  const allTables = await getAllBaseTables(connection);
  const inventory = classifyDatabaseTables(allTables);
  const { metadata, tableColumns } = await getSchemaSnapshot(
    connection,
    inventory.includedTables
  );
  const schemaMigrations = await getSchemaMigrations(connection);

  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    created_by_user_id: req.user?.id || null,
    selected_branch_id_when_created: getBranchId(req),
    warning:
      "This recovery file contains all durable Chalin 03 business data, users, password hashes, audit evidence and private worker records. Store it in a protected location.",
    included_tables: inventory.includedTables,
    excluded_tables: inventory.excludedTables,
    exclusion_policy: {
      legacy_alias_tables: "Excluded to prevent duplicate business records.",
      schema_migrations: "Recorded as manifest metadata and never overwritten by restore.",
      ephemeral_security_tables:
        "Excluded and cleared during restore so old sessions, OTPs and temporary recovery tokens cannot be revived.",
    },
    table_columns: tableColumns,
    table_counts: {},
    total_record_count: 0,
    schema_migrations: schemaMigrations,
    tables: {},
  };

  for (const tableName of inventory.includedTables) {
    const rows = await loadBackupTable(
      connection,
      tableName,
      metadata[tableName].map((column) => column.name)
    );
    backup.tables[tableName] = rows;
    backup.table_counts[tableName] = rows.length;
    backup.total_record_count += rows.length;
  }

  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 =
    signingSecret.length >= 64 ? signBackup(backup, signingSecret) : null;
  backup.manifest = {
    manifest_version: BACKUP_MANIFEST_VERSION,
    backup_id: backup.backup_id,
    created_at: backup.created_at,
    canonical_table_count: backup.included_tables.length,
    excluded_table_count: backup.excluded_tables.length,
    total_record_count: backup.total_record_count,
    checksum_algorithm: "sha256",
    checksum_sha256: backup.checksum_sha256,
    signature_algorithm:
      backup.signature_hmac_sha256 ? "hmac-sha256" : "not-configured-non-production",
    signature_hmac_sha256: backup.signature_hmac_sha256,
  };

  return { backup, metadata, inventory };
}

async function validateBackupAgainstCurrentSchema(connection, backup, signingSecret) {
  const allTables = await getAllBaseTables(connection);
  const inventory = classifyDatabaseTables(allTables);
  const { metadata, tableColumns } = await getSchemaSnapshot(
    connection,
    inventory.includedTables
  );
  const schemaMigrations = await getSchemaMigrations(connection);
  const report = validateBackupContract({
    backup,
    currentIncludedTables: inventory.includedTables,
    currentTableColumns: tableColumns,
    currentTableMetadata: metadata,
    currentSchemaMigrations: schemaMigrations,
    signingSecret,
    requireSignature: isProduction(),
    allowAdditiveSchemaDrift: true,
  });
  return { ...report, inventory, metadata, schemaMigrations };
}

async function insertBackupRows(
  connection,
  tableName,
  rows,
  columnMetadata,
  backupColumns
) {
  if (!rows.length) return;
  const metadataByName = new Map(
    columnMetadata.map((column) => [column.name, column])
  );
  const columns = (backupColumns || []).filter((column) =>
    metadataByName.has(column)
  );
  if (!columns.length || columns.length !== (backupColumns || []).length) {
    const error = new Error(
      `Backup columns for ${tableName} cannot be mapped safely to the current schema.`
    );
    error.code = "BACKUP_COLUMN_MAPPING_FAILED";
    throw error;
  }
  const columnTypes = Object.fromEntries(
    columns.map((column) => [column, metadataByName.get(column).type])
  );
  const escapedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${safeTableName(tableName)} (${escapedColumns}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((column) =>
      decodeRestoreValue(row[column], columnTypes[column])
    );
    await connection.query(sql, values);
  }
}

async function clearEphemeralSecurityState(connection, inventory) {
  const cleared = [];
  for (const tableName of inventory.ephemeralSecurityTables) {
    await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    cleared.push(tableName);
  }

  if (inventory.allTables.includes("users")) {
    const columns = await getInsertableColumnMetadata(connection, "users");
    if (columns.some((column) => column.name === "token_version")) {
      await connection.query(
        `UPDATE users SET token_version = COALESCE(token_version, 0) + 1`
      );
    }
  }

  return cleared;
}

async function verifyRestoredCounts(connection, includedTables, expectedCounts) {
  const actualCounts = {};
  for (const tableName of includedTables) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count FROM ${safeTableName(tableName)}`
    );
    const count = Number(rows[0]?.total_count || 0);
    actualCounts[tableName] = count;
    if (count !== Number(expectedCounts[tableName])) {
      const error = new Error(
        `Restore verification failed for ${tableName}: expected ${expectedCounts[tableName]}, found ${count}.`
      );
      error.code = "RESTORE_COUNT_MISMATCH";
      throw error;
    }
  }
  return actualCounts;
}

router.get(
  "/download",
  requireAuth,
  requireOriginalSystemAdministrator,
  async (req, res) => {
    const signingSecret = requireBackupSigningReady(res);
    if (signingSecret === null) return;

    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      transactionStarted = true;

      const { backup } = await buildFullSystemBackup(
        connection,
        req,
        signingSecret
      );

      await connection.commit();
      transactionStarted = false;

      await writeSecurityAudit(
        req,
        "CREATE_SIGNED_FULL_SYSTEM_BACKUP",
        `Created signed full-system backup ${backup.backup_id}.`,
        {
          backup_id: backup.backup_id,
          manifest_version: backup.version,
          included_table_count: backup.included_tables.length,
          excluded_tables: backup.excluded_tables,
          total_record_count: backup.total_record_count,
          checksum_sha256: backup.checksum_sha256,
          signature_present: Boolean(backup.signature_hmac_sha256),
        }
      );
      await sendBackupSecurityAlert(req, backup);

      const timestamp = backup.created_at.replaceAll(":", "-").replaceAll(".", "-");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="chalin03-full-system-v2-${timestamp}.json"`
      );
      return res.json(backup);
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Backup snapshot rollback failed:", rollbackError.message);
        }
      }
      console.error("Signed backup creation error:", error);
      return res.status(500).json({
        status: "error",
        code: error.code || "BACKUP_CREATION_FAILED",
        message:
          "The full-system backup could not be created safely. No incomplete backup was returned.",
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/restore/dry-run",
  requireAuth,
  requireOriginalSystemAdministrator,
  validateRequest(validateBackupDryRunRequest),
  async (req, res) => {
    const signingSecret = requireBackupSigningReady(res);
    if (signingSecret === null) return;

    const connection = await pool.getConnection();
    try {
      const report = await validateBackupAgainstCurrentSchema(
        connection,
        req.validated.backup,
        signingSecret
      );
      return res.status(report.valid ? 200 : 400).json({
        status: report.valid ? "success" : "error",
        code: report.valid ? "BACKUP_DRY_RUN_PASSED" : "BACKUP_DRY_RUN_FAILED",
        message: report.valid
          ? "Backup dry-run validation passed. Table inventory, columns, migration history, counts, checksum and signature are valid."
          : "Backup dry-run validation failed. Restore is blocked.",
        dry_run: true,
        valid: report.valid,
        errors: report.errors,
        warnings: report.warnings,
        restore_tables: report.includedTables || [],
        preserved_current_only_tables: report.currentOnlyTables || [],
        additive_schema_compatibility_applied:
          Boolean(report.additiveSchemaCompatibilityApplied),
        excluded_security_tables: report.inventory.ephemeralSecurityTables,
        total_record_count: report.totalRows || 0,
        checksum_sha256: req.validated.backup?.checksum_sha256 || null,
        signature_verified:
          signingSecret.length >= 64 && report.valid,
      });
    } catch (error) {
      console.error("Backup dry-run error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKUP_DRY_RUN_ERROR",
        message: "The restore dry run could not be completed safely.",
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/restore",
  requireAuth,
  requireOriginalSystemAdministrator,
  validateRequest(validateBackupRestoreRequest),
  async (req, res) => {
    if (isProduction()) {
      return res.status(403).json({
        status: "error",
        code: "WEB_RESTORE_PRODUCTION_BLOCKED",
        message:
          "Browser-based full restore is blocked in production. Restore only through the approved maintenance procedure against a verified recovery environment.",
      });
    }

    if (String(process.env.ALLOW_WEB_RESTORE || "").toLowerCase() !== "true") {
      return res.status(403).json({
        status: "error",
        code: "WEB_RESTORE_DISABLED",
        message:
          "Web restore is disabled. Set ALLOW_WEB_RESTORE=true only for an approved local recovery window.",
      });
    }

    if (req.validated.confirmation !== RESTORE_CONFIRMATION_TEXT) {
      return res.status(400).json({
        status: "error",
        code: "RESTORE_CONFIRMATION_REQUIRED",
        message:
          "Restore confirmation is required. Type RESTORE_FULL_SYSTEM_BACKUP before restoring.",
      });
    }

    const signingSecret = requireBackupSigningReady(res);
    if (signingSecret === null) return;

    const connection = await pool.getConnection();
    let transactionStarted = false;
    let lockAcquired = false;
    let foreignKeysDisabled = false;

    try {
      const [lockRows] = await connection.query(
        "SELECT GET_LOCK(?, 10) AS acquired",
        [RESTORE_LOCK_NAME]
      );
      lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
      if (!lockAcquired) {
        return res.status(409).json({
          status: "error",
          code: "RESTORE_ALREADY_RUNNING",
          message: "Another restore operation is already running.",
        });
      }

      const report = await validateBackupAgainstCurrentSchema(
        connection,
        req.validated.backup,
        signingSecret
      );
      if (!report.valid) {
        return res.status(400).json({
          status: "error",
          code: "BACKUP_VALIDATION_FAILED",
          message: "Backup validation failed. No restore was started.",
          errors: report.errors,
          warnings: report.warnings,
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      foreignKeysDisabled = true;

      for (const tableName of [...report.includedTables].reverse()) {
        await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
      }

      for (const tableName of report.includedTables) {
        await insertBackupRows(
          connection,
          tableName,
          req.validated.backup.tables[tableName],
          report.metadata[tableName],
          req.validated.backup.table_columns?.[tableName] || []
        );
      }

      const clearedSecurityTables = await clearEphemeralSecurityState(
        connection,
        report.inventory
      );
      const restoredCounts = await verifyRestoredCounts(
        connection,
        report.includedTables,
        req.validated.backup.table_counts
      );

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      foreignKeysDisabled = false;
      await connection.commit();
      transactionStarted = false;

      await writeSecurityAudit(
        req,
        "RESTORE_SIGNED_FULL_SYSTEM_BACKUP",
        `Restored signed full-system backup ${req.validated.backup.backup_id}. All active sessions and temporary recovery credentials were revoked.`,
        {
          backup_id: req.validated.backup.backup_id,
          manifest_version: req.validated.backup.version,
          restored_tables: report.includedTables,
          preserved_current_only_tables: report.currentOnlyTables || [],
          additive_schema_compatibility_applied:
            Boolean(report.additiveSchemaCompatibilityApplied),
          cleared_security_tables: clearedSecurityTables,
          total_record_count: report.totalRows,
          checksum_sha256: req.validated.backup.checksum_sha256,
        }
      );

      return res.json({
        status: "success",
        code: "FULL_SYSTEM_RESTORE_COMPLETED",
        message:
          "Backup restored and verified successfully. All existing login, OTP and protected-action sessions were revoked. Login again before using the system.",
        restore_scope: "full_system_all_businesses",
        backup_id: req.validated.backup.backup_id,
        restored_tables: report.includedTables,
        preserved_current_only_tables: report.currentOnlyTables || [],
        additive_schema_compatibility_applied:
          Boolean(report.additiveSchemaCompatibilityApplied),
        restored_table_counts: restoredCounts,
        total_restored_records: report.totalRows,
        cleared_security_tables: clearedSecurityTables,
        all_sessions_revoked: true,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Restore rollback failed:", rollbackError);
        }
      }
      console.error("Full-system restore error:", error);
      return res.status(500).json({
        status: "error",
        code: error.code || "FULL_SYSTEM_RESTORE_FAILED",
        message:
          "The full-system restore could not be completed safely. No success was reported. Keep the recovery environment closed and review the backend log.",
      });
    } finally {
      if (foreignKeysDisabled) {
        try {
          await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        } catch (error) {
          console.error("Failed to re-enable foreign-key checks:", error.message);
        }
      }
      if (lockAcquired) {
        try {
          await connection.query("SELECT RELEASE_LOCK(?) AS released", [
            RESTORE_LOCK_NAME,
          ]);
        } catch (error) {
          console.warn("Restore lock release warning:", error.message);
        }
      }
      connection.release();
    }
  }
);

module.exports = router;
