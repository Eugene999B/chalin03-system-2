"use strict";

const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
  checksumBackup,
  classifyDatabaseTables,
  isConfirmedRailwayStaging,
  isSafeIdentifier,
  safeTableName,
  validateBackupContract,
} = require("../services/backupSafetyService");
const {
  hasDelegatedCapability,
  loadUser,
} = require("../services/delegatedAdministrationService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  prepareStagingBackupRecoverySchema,
} = require("../scripts/prepareStagingBackupRecoverySchema");
const release2FinalRoutes = require("./release2FinalRoutes");

const { requireProtectedAction, appendLedger } = release2FinalRoutes;
const router = express.Router();
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeRequestHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
}

function requestHosts(req) {
  const forwarded = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")
    .map(normalizeRequestHost)
    .filter(Boolean);
  const host = normalizeRequestHost(req?.headers?.host);
  return [...new Set([...forwarded, host].filter(Boolean))];
}

function isConfirmedStagingRequest(req) {
  return (
    isConfirmedRailwayStaging() ||
    requestHosts(req).includes(CHALIN_ONE_STAGING_PUBLIC_DOMAIN)
  );
}

function recoveryEnvironmentForRequest(req) {
  if (!isConfirmedStagingRequest(req)) return process.env;
  return {
    ...process.env,
    RAILWAY_PUBLIC_DOMAIN:
      process.env.RAILWAY_PUBLIC_DOMAIN || CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
  };
}

function stagingOnlyOrNext(req, res, next) {
  if (!isConfirmedStagingRequest(req)) return next("router");
  return next();
}

function isSignedV2Backup(backup) {
  return Boolean(
    backup &&
      backup.backup_type === BACKUP_TYPE &&
      backup.version === BACKUP_MANIFEST_VERSION
  );
}

function requireStagingBackupAuthority(capabilityCode) {
  return async function stagingBackupAuthority(req, res, next) {
    try {
      const requester = await loadUser(req.user?.id);
      if (!requester) {
        return res.status(401).json({
          status: "error",
          code: "AUTHENTICATION_REQUIRED",
          message: "Your Administrator account could not be verified.",
        });
      }

      if (
        !isOriginalSystemAdministrator(requester) &&
        !(await hasDelegatedCapability(requester, capabilityCode))
      ) {
        return res.status(403).json({
          status: "error",
          code: "DELEGATED_BACKUP_AUTHORITY_REQUIRED",
          message:
            "The original owner has not granted this Administrator the required backup authority.",
        });
      }

      req.stagingRecoveryAdministrator = requester;
      return next();
    } catch (error) {
      return next(error);
    }
  };
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
    .filter((tableName) => isSafeIdentifier(tableName));
}

async function tableMetadata(connection, tableName) {
  const [rows] = await connection.query(
    `SHOW FULL COLUMNS FROM ${safeTableName(tableName)}`
  );
  return rows
    .filter(
      (column) =>
        !String(column.Extra || "")
          .toLowerCase()
          .includes("generated")
    )
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

async function schemaMigrations(connection, allTables) {
  if (!allTables.includes("schema_migrations")) return [];
  const [rows] = await connection.query(
    `SELECT migration_name, description, applied_at
       FROM schema_migrations
      ORDER BY migration_name`
  );
  return rows.map((row) => ({
    migration_name: row.migration_name,
    description: row.description || null,
    applied_at:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : row.applied_at,
  }));
}

async function validateRecoverySchema(
  connection,
  backup,
  { allowCrossEnvironmentRecovery = false } = {}
) {
  const allTables = await existingTables(connection);
  const inventory = classifyDatabaseTables(allTables);
  const currentTableColumns = {};
  const currentTableMetadata = {};

  for (const tableName of inventory.includedTables) {
    const metadata = await tableMetadata(connection, tableName);
    currentTableMetadata[tableName] = metadata;
    currentTableColumns[tableName] = metadata.map((column) => column.name);
  }

  const report = validateBackupContract({
    backup,
    currentIncludedTables: inventory.includedTables,
    currentTableColumns,
    currentTableMetadata,
    currentSchemaMigrations: await schemaMigrations(connection, allTables),
    signingSecret: String(process.env.BACKUP_SIGNING_SECRET || "").trim(),
    requireSignature: false,
    allowAdditiveSchemaDrift: true,
    allowCrossEnvironmentRecovery,
  });

  return {
    valid: Boolean(report.valid),
    errors: report.errors || [],
    warnings: report.warnings || [],
    restore_tables: report.includedTables || [],
    tables_to_restore: report.includedTables || [],
    preserved_current_only_tables: report.currentOnlyTables || [],
    source_only_tables: report.sourceOnlyTables || [],
    source_only_columns: report.sourceOnlyColumns || {},
    restore_columns: report.restoreColumns || {},
    cross_environment_recovery: Boolean(report.crossEnvironmentRecovery),
    signed_v2_recovery: true,
    additive_schema_compatibility_applied: Boolean(
      report.additiveSchemaCompatibilityApplied
    ),
    signature_verified: Boolean(report.signatureVerified),
    checksum_sha256: backup.checksum_sha256 || null,
  };
}

function sourceOnlyColumnCount(validation) {
  return Object.values(validation?.source_only_columns || {}).reduce(
    (total, columns) => total + (Array.isArray(columns) ? columns.length : 0),
    0
  );
}

function recoverySchemaReady(validation) {
  return Boolean(
    validation?.valid &&
      (validation.source_only_tables || []).length === 0 &&
      sourceOnlyColumnCount(validation) === 0
  );
}

function assertBackupIntegrity(backup) {
  if (!isSignedV2Backup(backup)) {
    const error = new Error(
      "This protected staging recovery flow requires a CHALIN signed-v2 full-system backup."
    );
    error.code = "SIGNED_V2_BACKUP_REQUIRED";
    throw error;
  }

  const expectedChecksum = String(backup.checksum_sha256 || "").toLowerCase();
  const actualChecksum = checksumBackup(backup).toLowerCase();
  if (!expectedChecksum || expectedChecksum !== actualChecksum) {
    const error = new Error(
      "Backup checksum does not match its contents. The staging recovery operation was refused."
    );
    error.code = "BACKUP_CHECKSUM_MISMATCH";
    throw error;
  }

  if (!SIGNATURE_PATTERN.test(String(backup.signature_hmac_sha256 || ""))) {
    const error = new Error(
      "The production backup does not contain a valid signed-v2 HMAC signature field."
    );
    error.code = "BACKUP_SIGNATURE_REQUIRED";
    throw error;
  }
}

async function recordPreparationEvent(req, preparation, validation) {
  const metadata = {
    applied_migrations: preparation.applied.map((item) => item.migration_name),
    remaining_candidate_count: preparation.remaining_candidate_count,
    remaining_source_table_count: validation.source_only_tables.length,
    remaining_source_column_count: sourceOnlyColumnCount(validation),
    blocked_migration_count: preparation.blocked.length,
    unresolved_migration_count: preparation.unresolved_source_migrations.length,
    delegated_system_administrator: !isOriginalSystemAdministrator(
      req.stagingRecoveryAdministrator
    ),
    staging_recovery_only: true,
  };

  try {
    await writeAuditEvent({
      req,
      userId: req.user?.id || null,
      branchId: req.user?.branch_id || req.user?.default_branch_id || 1,
      workspaceCode: req.user?.workspace_code || "spare_parts",
      action: "STAGING_BACKUP_RECOVERY_SCHEMA_PREPARED",
      actionType: "backup.staging_recovery.schema_prepared",
      outcome: "success",
      severity: "critical",
      entityType: "backup",
      details:
        "A protected staging Administrator applied a bounded additive schema-preparation batch for signed-v2 disaster-recovery testing.",
      metadata,
    });

    await appendLedger({
      req,
      actorUserId: req.user?.id || null,
      actionCode: "STAGING_BACKUP_RECOVERY_SCHEMA_PREPARED",
      outcome: "success",
      severity: "critical",
      entityType: "backup",
      payload: metadata,
    });
  } catch (error) {
    console.warn("Staging recovery schema audit warning:", error.message);
  }
}

router.post(
  "/restore/dry-run",
  stagingOnlyOrNext,
  requireAuth,
  requireStagingBackupAuthority("backup_validate"),
  requirePermission("backup.validate"),
  requireProtectedAction,
  asyncHandler(async (req, res, next) => {
    const backup = req.body?.backup || req.body;
    if (!isSignedV2Backup(backup)) return next("router");

    try {
      assertBackupIntegrity(backup);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        code: error.code || "BACKUP_DRY_RUN_FAILED",
        message: error.message,
        dry_run: true,
        valid: false,
        errors: [error.message],
        warnings: [],
      });
    }

    const connection = await pool.getConnection();
    try {
      const validation = await validateRecoverySchema(connection, backup, {
        allowCrossEnvironmentRecovery: true,
      });
      const ready = recoverySchemaReady(validation);
      return res.status(validation.valid ? 200 : 400).json({
        status: validation.valid ? "success" : "error",
        code: validation.valid
          ? ready
            ? "BACKUP_DRY_RUN_PASSED"
            : "BACKUP_DRY_RUN_SCHEMA_PREPARATION_REQUIRED"
          : "BACKUP_DRY_RUN_FAILED",
        message: validation.valid
          ? ready
            ? "Backup dry-run validation passed and the isolated staging schema is ready for a complete restore."
            : "Backup package validation passed, but the isolated trial schema is behind production. Prepare the trial schema before restoring."
          : "Backup dry-run validation failed. Restore is blocked.",
        dry_run: true,
        recovery_schema_ready: ready,
        remaining_source_column_count: sourceOnlyColumnCount(validation),
        ...validation,
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore/prepare-staging-schema",
  stagingOnlyOrNext,
  requireAuth,
  requireStagingBackupAuthority("backup_restore"),
  requirePermission("backup.restore"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const backup = req.body?.backup;
    try {
      assertBackupIntegrity(backup);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        code: error.code || "STAGING_SCHEMA_PREP_BACKUP_INVALID",
        message: error.message,
      });
    }

    const connection = await pool.getConnection();
    try {
      const before = await validateRecoverySchema(connection, backup, {
        allowCrossEnvironmentRecovery: true,
      });
      if (!before.valid) {
        return res.status(400).json({
          status: "error",
          code: "STAGING_SCHEMA_PREP_VALIDATION_FAILED",
          message:
            "The source backup did not pass immutable package validation. No schema change was attempted.",
          validation: before,
        });
      }

      const preparation = await prepareStagingBackupRecoverySchema({
        connection,
        backup,
        env: recoveryEnvironmentForRequest(req),
      });
      const validation = await validateRecoverySchema(connection, backup, {
        allowCrossEnvironmentRecovery: true,
      });
      const remainingSourceColumnCount = sourceOnlyColumnCount(validation);
      const ready = recoverySchemaReady(validation);

      await recordPreparationEvent(req, preparation, validation);

      const progressCanContinue = preparation.remaining_candidate_count > 0;
      const status = ready || progressCanContinue ? 200 : 409;
      return res.status(status).json({
        status: ready
          ? "success"
          : progressCanContinue
            ? "progress"
            : "error",
        code: ready
          ? "STAGING_RECOVERY_SCHEMA_READY"
          : progressCanContinue
            ? "STAGING_RECOVERY_SCHEMA_PROGRESS"
            : "STAGING_RECOVERY_SCHEMA_INCOMPLETE",
        message: ready
          ? "The isolated trial schema now matches every durable table and column required by this production backup."
          : progressCanContinue
            ? "A safe staging schema batch was applied. More approved source migrations remain and will continue in the next batch."
            : "All safe repository migrations available for this backup were checked, but durable schema gaps remain. Restore stays blocked rather than skipping production data.",
        recovery_schema_ready: ready,
        remaining_source_column_count: remainingSourceColumnCount,
        preparation,
        validation,
      });
    } catch (error) {
      console.error("Staging backup recovery schema preparation failed:", error);
      return res.status(409).json({
        status: "error",
        code: error.code || "STAGING_BACKUP_SCHEMA_PREPARATION_FAILED",
        message:
          error.message ||
          "The isolated staging schema could not be prepared safely. No restore was started.",
      });
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore",
  stagingOnlyOrNext,
  requireAuth,
  requireStagingBackupAuthority("backup_restore"),
  requirePermission("backup.restore"),
  requireProtectedAction,
  asyncHandler(async (req, res, next) => {
    const backup = req.body?.backup || req.body;
    if (!isSignedV2Backup(backup)) return next("router");

    try {
      assertBackupIntegrity(backup);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        code: error.code || "BACKUP_VALIDATION_FAILED",
        message: error.message,
      });
    }

    const connection = await pool.getConnection();
    try {
      const validation = await validateRecoverySchema(connection, backup, {
        allowCrossEnvironmentRecovery: true,
      });
      if (!validation.valid) {
        return res.status(400).json({
          status: "error",
          code: "BACKUP_VALIDATION_FAILED",
          message: "Backup validation failed. No restore was started.",
          ...validation,
        });
      }
      if (!recoverySchemaReady(validation)) {
        return res.status(409).json({
          status: "error",
          code: "STAGING_SCHEMA_BEHIND_BACKUP",
          message:
            "The backup is valid, but this trial database is still missing production tables or columns. Restore is blocked so no production data can be silently skipped.",
          missing_source_tables: validation.source_only_tables,
          missing_source_columns: validation.source_only_columns,
          remaining_source_column_count: sourceOnlyColumnCount(validation),
          warnings: validation.warnings,
        });
      }
    } finally {
      connection.release();
    }

    return next("router");
  })
);

module.exports = router;