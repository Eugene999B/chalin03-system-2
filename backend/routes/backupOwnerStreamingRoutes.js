const express = require("express");
const crypto = require("node:crypto");
const { once } = require("node:events");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  checksumBackup,
  classifyDatabaseTables,
  isSafeIdentifier,
  safeTableName,
  signBackup,
} = require("../services/backupSafetyService");

const router = express.Router();
const BUFFER_MARKER = "buffer_base64";
const HEARTBEAT_INTERVAL_MS = 15_000;

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function backupSigningSecret() {
  return String(process.env.BACKUP_SIGNING_SECRET || "").trim();
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}

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

function requireBackupSigningReady(res) {
  const secret = backupSigningSecret();
  if (isProduction() && secret.length < 64) {
    res.status(503).json({
      status: "error",
      code: "BACKUP_SIGNING_NOT_CONFIGURED",
      message:
        "Full-system backup signing is not configured. The server refused to create an unauthenticated production backup.",
    });
    return null;
  }
  return secret;
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

async function buildFullSystemBackup(connection, req, signingSecret, identity) {
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
    backup_id: identity.backupId,
    created_at: identity.createdAt,
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
    if (req.destroyed) {
      const error = new Error("Backup download client disconnected while the snapshot was being prepared.");
      error.code = "BACKUP_CLIENT_DISCONNECTED";
      throw error;
    }

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

  return backup;
}

async function writeSecurityAudit(req, backup) {
  try {
    await writeAuditEvent({
      req,
      userId: req.user?.id || null,
      branchId: getBranchId(req),
      action: "CREATE_SIGNED_FULL_SYSTEM_BACKUP",
      details: `Created signed full-system backup ${backup.backup_id}.`,
      workspaceCode: "spare_parts",
      entityType: "backup",
      actionType: "CREATE_SIGNED_FULL_SYSTEM_BACKUP",
      outcome: "success",
      severity: "critical",
      metadata: {
        backup_id: backup.backup_id,
        manifest_version: backup.version,
        included_table_count: backup.included_tables.length,
        excluded_tables: backup.excluded_tables,
        total_record_count: backup.total_record_count,
        checksum_sha256: backup.checksum_sha256,
        signature_present: Boolean(backup.signature_hmac_sha256),
        progressive_transport: true,
      },
    });
  } catch (error) {
    console.warn("CREATE_SIGNED_FULL_SYSTEM_BACKUP audit warning:", error.message);
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

function startHeartbeat(res) {
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write("\n");

  const timer = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      res.write("\n");
    }
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function writeChunk(res, chunk) {
  if (res.destroyed || res.writableEnded) {
    const error = new Error("Backup download connection closed before the signed file completed.");
    error.code = "BACKUP_DOWNLOAD_CONNECTION_CLOSED";
    throw error;
  }
  if (res.write(chunk)) return;
  await once(res, "drain");
}

async function streamBackupJson(res, backup) {
  await writeChunk(res, "{");
  let wroteProperty = false;

  for (const [key, value] of Object.entries(backup)) {
    if (key === "tables") continue;
    if (wroteProperty) await writeChunk(res, ",");
    await writeChunk(res, `${JSON.stringify(key)}:${JSON.stringify(value)}`);
    wroteProperty = true;
  }

  if (wroteProperty) await writeChunk(res, ",");
  await writeChunk(res, '"tables":{');

  for (let tableIndex = 0; tableIndex < backup.included_tables.length; tableIndex += 1) {
    const tableName = backup.included_tables[tableIndex];
    if (tableIndex > 0) await writeChunk(res, ",");
    await writeChunk(res, `${JSON.stringify(tableName)}:[`);

    const rows = backup.tables[tableName] || [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex > 0) await writeChunk(res, ",");
      await writeChunk(res, JSON.stringify(rows[rowIndex]));
    }
    await writeChunk(res, "]");

    // The checksum/signature are already final. Free each table after it has
    // crossed the wire so a large backup does not require a second full JSON copy.
    delete backup.tables[tableName];
  }

  res.end("}}");
}

router.get(
  "/download",
  requireAuth,
  requireOriginalSystemAdministrator,
  async (req, res) => {
    const signingSecret = requireBackupSigningReady(res);
    if (signingSecret === null) return;

    const identity = {
      backupId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const timestamp = identity.createdAt.replaceAll(":", "-").replaceAll(".", "-");

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Chalin03-Backup-Transport", "progressive-v1");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="chalin03-full-system-v2-${timestamp}.json"`
    );

    const stopHeartbeat = startHeartbeat(res);
    let connection = null;
    let transactionStarted = false;

    try {
      connection = await pool.getConnection();
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      transactionStarted = true;

      const backup = await buildFullSystemBackup(
        connection,
        req,
        signingSecret,
        identity
      );

      await connection.commit();
      transactionStarted = false;

      await writeSecurityAudit(req, backup);
      await sendBackupSecurityAlert(req, backup);

      stopHeartbeat();
      await streamBackupJson(res, backup);
    } catch (error) {
      stopHeartbeat();
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Backup snapshot rollback failed:", rollbackError.message);
        }
      }
      console.error("Progressive signed backup creation error:", error);

      // Headers and harmless JSON whitespace have already been sent so the edge
      // can keep the long-running request alive. If generation fails, terminate
      // the stream instead of returning a syntactically valid partial backup.
      // The browser therefore receives a failed download, never false recovery evidence.
      if (!res.destroyed) res.destroy(error);
    } finally {
      if (connection) connection.release();
    }
  }
);

module.exports = router;
