const express = require("express");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  hasDelegatedCapability,
  loadUser,
} = require("../services/delegatedAdministrationService");
const release2FinalRoutes = require("./release2FinalRoutes");

const { requireProtectedAction, appendLedger } = release2FinalRoutes;
const router = express.Router();

const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const MANIFEST_VERSION = "chalin03-release-3f-d-delegated-v1";
const LEGACY_ALIAS_TABLES = new Set([
  "stores",
  "user_store_access",
  "activity_logs",
]);
const EPHEMERAL_SECURITY_TABLES = Object.freeze([
  "auth_sessions",
  "protected_action_sessions",
  "owner_recovery_sessions",
]);

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isSafeIdentifier(value) {
  return /^[a-zA-Z0-9_]+$/.test(String(value || ""));
}

function safeTableName(value) {
  if (!isSafeIdentifier(value)) {
    throw new Error("Unsafe database table identifier.");
  }
  return `\`${value}\``;
}

function backupChecksum(backup) {
  const payload = JSON.stringify({
    backup_type: backup.backup_type,
    included_tables: backup.included_tables,
    table_counts: backup.table_counts,
    tables: backup.tables,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function existingTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  return rows
    .map((row) => row.TABLE_NAME)
    .filter(isSafeIdentifier)
    .filter((name) => !LEGACY_ALIAS_TABLES.has(name));
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SHOW COLUMNS FROM ${safeTableName(tableName)}`
  );
  return rows.map((row) => row.Field).filter(isSafeIdentifier);
}

async function tableCounts(connection, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count FROM ${safeTableName(tableName)}`
    );
    counts[tableName] = Number(rows[0]?.total_count || 0);
  }
  return counts;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return value;
}

async function insertRows(connection, tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const allowedColumns = new Set(await tableColumns(connection, tableName));
  const columns = Object.keys(rows[0]).filter(
    (column) => isSafeIdentifier(column) && allowedColumns.has(column)
  );
  if (!columns.length) return;

  const sql = `INSERT INTO ${safeTableName(tableName)} (${columns
    .map((column) => safeTableName(column))
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;

  for (const row of rows) {
    await connection.query(
      sql,
      columns.map((column) => normalizeValue(row[column]))
    );
  }
}

async function resetAutoIncrement(connection, tableName) {
  const columns = await tableColumns(connection, tableName);
  if (!columns.includes("id")) return;
  const [rows] = await connection.query(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${safeTableName(
      tableName
    )}`
  );
  const nextId = Math.max(1, Number(rows[0]?.next_id || 1));
  await connection.query(
    `ALTER TABLE ${safeTableName(tableName)} AUTO_INCREMENT = ${nextId}`
  );
}

function configuredOwnerPresent(backup) {
  const ownerId = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
  const ownerUsername = String(
    process.env.SYSTEM_ADMIN_USERNAME || "admin"
  )
    .trim()
    .toLowerCase();
  const users = Array.isArray(backup?.tables?.users)
    ? backup.tables.users
    : [];
  return users.some(
    (user) =>
      Number(user.id) === ownerId &&
      String(user.username || "").trim().toLowerCase() === ownerUsername &&
      String(user.role || "").trim().toLowerCase() === "admin"
  );
}

function requesterPresent(backup, requester) {
  const users = Array.isArray(backup?.tables?.users)
    ? backup.tables.users
    : [];
  return users.some(
    (user) =>
      Number(user.id) === Number(requester.id) &&
      String(user.username || "").trim().toLowerCase() ===
        String(requester.username || "").trim().toLowerCase() &&
      String(user.role || "").trim().toLowerCase() === "admin" &&
      Boolean(Number(user.is_active))
  );
}

async function validateBackup(connection, backup, requester) {
  const errors = [];
  const warnings = [];

  if (
    !backup ||
    backup.backup_type !== "full_system_backup" ||
    !backup.tables ||
    typeof backup.tables !== "object"
  ) {
    return {
      valid: false,
      errors: ["Invalid Chalin 03 full-system backup file."],
      warnings,
      restore_tables: [],
      tables_to_restore: [],
    };
  }

  const currentTables = (await existingTables(connection)).filter(
    (tableName) => tableName !== "schema_migrations"
  );
  const backupTables = Object.keys(backup.tables).filter(isSafeIdentifier);
  const tablesToRestore = currentTables.filter((tableName) =>
    Array.isArray(backup.tables[tableName])
  );
  const missingTables = currentTables.filter(
    (tableName) => !Array.isArray(backup.tables[tableName])
  );
  const unsupportedTables = backupTables.filter(
    (tableName) => !currentTables.includes(tableName)
  );

  if (!tablesToRestore.length) {
    errors.push("No compatible current application table was found.");
  }
  if (!configuredOwnerPresent(backup)) {
    errors.push(
      "The backup does not contain the permanently protected original System Administrator."
    );
  }
  if (!requesterPresent(backup, requester)) {
    errors.push(
      "For delegated restore safety, this backup must contain your same active Administrator account. The original owner can restore older backups."
    );
  }

  if (missingTables.length) {
    warnings.push(
      `Current tables absent from the backup will be cleared: ${missingTables.join(
        ", "
      )}.`
    );
  }
  if (unsupportedTables.length) {
    warnings.push(
      `Legacy or unsupported tables will be ignored: ${unsupportedTables.join(
        ", "
      )}.`
    );
  }

  for (const tableName of tablesToRestore) {
    const rows = backup.tables[tableName];
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`${tableName} contains an invalid row.`);
        break;
      }
      if (row.id !== undefined && row.id !== null) {
        const id = String(row.id);
        if (ids.has(id)) {
          errors.push(`${tableName} contains duplicate id ${id}.`);
          break;
        }
        ids.add(id);
      }
    }
  }

  if (backup.checksum_sha256) {
    const actualChecksum = backupChecksum(backup);
    if (actualChecksum !== backup.checksum_sha256) {
      errors.push("Backup checksum does not match its contents.");
    }
  } else {
    warnings.push("This backup does not contain a checksum.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    restore_tables: currentTables,
    tables_to_restore: tablesToRestore,
    missing_tables: missingTables,
    unsupported_tables: unsupportedTables,
    checksum_sha256: backup.checksum_sha256 || null,
    preview_counts: Object.fromEntries(
      tablesToRestore.map((tableName) => [
        tableName,
        backup.tables[tableName].length,
      ])
    ),
  };
}

function requireDelegatedBackup(capabilityCode) {
  return async function delegatedBackupAuthority(req, res, next) {
    try {
      const requester = await loadUser(req.user?.id);
      if (!requester) {
        return res.status(401).json({
          status: "error",
          message: "Your account could not be verified.",
        });
      }
      if (isOriginalSystemAdministrator(requester)) {
        return next("route");
      }
      if (!(await hasDelegatedCapability(requester, capabilityCode))) {
        return res.status(403).json({
          status: "error",
          code: "DELEGATED_BACKUP_AUTHORITY_REQUIRED",
          message:
            "The original owner has not granted this delegated backup authority.",
        });
      }
      req.delegatedSystemAdministrator = requester;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function recordBackupEvent(req, action, details, metadata) {
  await writeAuditEvent({
    req,
    action,
    actionType: `backup.${action.toLowerCase()}`,
    outcome: "success",
    severity: "critical",
    entityType: "backup",
    details,
    metadata: {
      ...metadata,
      delegated_system_administrator: true,
      original_owner_protected: true,
    },
  });
  await appendLedger({
    req,
    actorUserId: req.user.id,
    actionCode: action,
    outcome: "success",
    severity: "critical",
    entityType: "backup",
    payload: {
      ...metadata,
      delegated_system_administrator: true,
      original_owner_protected: true,
    },
  });
}

router.get(
  "/download",
  requireAuth,
  requireDelegatedBackup("backup_download"),
  requirePermission("backup.download"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const tableNames = await existingTables(connection);
      const createdAt = new Date().toISOString();
      const counts = await tableCounts(connection, tableNames);
      const backup = {
        app: "Chalin 03 Group Operations Platform",
        version: MANIFEST_VERSION,
        backup_type: "full_system_backup",
        created_at: createdAt,
        created_by: {
          id: req.user.id,
          username: req.user.username,
          authority: "delegated_system_administrator",
        },
        warning:
          "Sensitive full-system recovery backup. Keep private and use only through validated restore controls.",
        included_tables: tableNames,
        skipped_tables: [],
        table_counts: counts,
        total_record_count: Object.values(counts).reduce(
          (total, count) => total + Number(count || 0),
          0
        ),
        tables: {},
      };

      for (const tableName of tableNames) {
        const [rows] = await connection.query(
          `SELECT * FROM ${safeTableName(tableName)}`
        );
        backup.tables[tableName] = rows;
      }
      backup.checksum_sha256 = backupChecksum(backup);
      backup.manifest = {
        manifest_version: MANIFEST_VERSION,
        checksum_algorithm: "sha256",
        checksum_sha256: backup.checksum_sha256,
        table_count: tableNames.length,
      };

      await recordBackupEvent(
        req,
        "DELEGATED_FULL_BACKUP_CREATED",
        `${tableNames.length} tables were included in a delegated full-system backup.`,
        {
          table_count: tableNames.length,
          total_record_count: backup.total_record_count,
          checksum_sha256: backup.checksum_sha256,
        }
      );

      const timestamp = createdAt.replaceAll(":", "-").replaceAll(".", "-");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="chalin03-full-system-backup-${timestamp}.json"`
      );
      return res.json(backup);
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore/dry-run",
  requireAuth,
  requireDelegatedBackup("backup_validate"),
  requirePermission("backup.validate"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const report = await validateBackup(
        connection,
        req.body?.backup || req.body,
        req.delegatedSystemAdministrator
      );
      await recordBackupEvent(
        req,
        report.valid
          ? "DELEGATED_BACKUP_VALIDATED"
          : "DELEGATED_BACKUP_VALIDATION_FAILED",
        report.valid
          ? "Delegated backup compatibility validation passed."
          : "Delegated backup compatibility validation failed.",
        {
          valid: report.valid,
          error_count: report.errors.length,
          warning_count: report.warnings.length,
        }
      );
      return res.status(report.valid ? 200 : 400).json({
        status: report.valid ? "success" : "error",
        message: report.valid
          ? "Backup validation and restore preview completed."
          : "Backup validation failed. No data was changed.",
        dry_run: true,
        ...report,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore",
  requireAuth,
  requireDelegatedBackup("backup_restore"),
  requirePermission("backup.restore"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    if (String(process.env.ALLOW_WEB_RESTORE || "").toLowerCase() !== "true") {
      return res.status(403).json({
        status: "error",
        message:
          "Web restore is disabled. The original owner must open an approved Railway restore window first.",
      });
    }
    if (
      cleanText(req.body?.confirmation, 80) !== RESTORE_CONFIRMATION_TEXT
    ) {
      return res.status(400).json({
        status: "error",
        message: `Type ${RESTORE_CONFIRMATION_TEXT} exactly before restoring.`,
      });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;
    let validation;
    try {
      const backup = req.body?.backup || req.body;
      validation = await validateBackup(
        connection,
        backup,
        req.delegatedSystemAdministrator
      );
      if (!validation.valid) {
        return res.status(400).json({
          status: "error",
          message: "Backup validation failed. No restore was started.",
          ...validation,
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      for (const tableName of [...validation.restore_tables].reverse()) {
        await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
      }
      for (const tableName of validation.tables_to_restore) {
        await insertRows(connection, tableName, backup.tables[tableName]);
      }

      const currentTableSet = new Set(validation.restore_tables);
      for (const tableName of EPHEMERAL_SECURITY_TABLES) {
        if (currentTableSet.has(tableName)) {
          await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
        }
      }

      await writeAuditEvent({
        connection,
        userId: req.user.id,
        branchId: req.user?.branch_id || req.user?.default_branch_id || 1,
        workspaceCode: req.user?.workspace_code || "spare_parts",
        action: "DELEGATED_FULL_BACKUP_RESTORED",
        actionType: "backup.delegated_restore.completed",
        outcome: "success",
        severity: "critical",
        entityType: "backup",
        details: "A delegated System Administrator completed a validated full-system restore.",
        metadata: {
          restored_tables: validation.tables_to_restore,
          sessions_cleared: EPHEMERAL_SECURITY_TABLES,
          original_owner_protected: true,
        },
      });

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.commit();
      transactionStarted = false;

      const autoIncrementWarnings = [];
      for (const tableName of validation.restore_tables) {
        try {
          await resetAutoIncrement(connection, tableName);
        } catch (error) {
          autoIncrementWarnings.push(tableName);
        }
      }

      return res.json({
        status: "success",
        message:
          "The delegated full-system restore completed. All restored login and protected-action sessions were cleared; sign in again before continuing.",
        restored_tables: validation.tables_to_restore,
        cleared_tables: validation.restore_tables,
        auto_increment_warnings: autoIncrementWarnings,
        sessions_cleared: EPHEMERAL_SECURITY_TABLES,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original error.
        }
      }
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch {
        // Connection is released below.
      }
      throw error;
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
