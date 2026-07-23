const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const {
  validateBackupDryRunRequest,
  validateBackupRestoreRequest,
} = require("../validation/requestValidators");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  hasDelegatedCapability,
  loadUser,
} = require("../services/delegatedAdministrationService");
const {
  createFullSystemBackup,
  recordBackupHistory,
  restoreFullSystemBackup,
  validateFullSystemBackup,
} = require("../services/fullSystemBackupService");
const release2FinalRoutes = require("./release2FinalRoutes");

const { requireProtectedAction, appendLedger } = release2FinalRoutes;
const router = express.Router();
const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function authorityLabel(req) {
  return req.backupAuthority?.isOriginalOwner
    ? "original_system_administrator"
    : "delegated_system_administrator";
}

function requireBackupAuthority(capabilityCode) {
  return async function backupAuthority(req, res, next) {
    try {
      const requester = await loadUser(req.user?.id);
      if (!requester) {
        return res.status(401).json({
          status: "error",
          code: "BACKUP_REQUESTER_NOT_FOUND",
          message: "Your Administrator account could not be verified.",
        });
      }

      if (isOriginalSystemAdministrator(requester)) {
        req.backupAuthority = {
          user: requester,
          isOriginalOwner: true,
          capabilityCode,
        };
        return next();
      }

      if (!(await hasDelegatedCapability(requester, capabilityCode))) {
        return res.status(403).json({
          status: "error",
          code: "DELEGATED_BACKUP_AUTHORITY_REQUIRED",
          message:
            "The original owner has not granted this delegated backup authority.",
        });
      }

      req.backupAuthority = {
        user: requester,
        isOriginalOwner: false,
        capabilityCode,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function validationResponse(report) {
  return {
    valid: report.valid,
    errors: report.errors,
    warnings: report.warnings,
    restore_tables: report.restoreTables,
    tables_to_restore: report.tablesToRestore,
    missing_tables: report.missingTables,
    unsupported_tables: report.unsupportedTables,
    checksum_sha256: report.checksumSha256,
    preview_counts: report.previewCounts,
  };
}

function sendBackupError(res, error, fallbackMessage) {
  const statusCode = Number(error?.statusCode || 500);
  const safeStatus = statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const payload = {
    status: "error",
    code: error?.code || "FULL_SYSTEM_RECOVERY_FAILED",
    message:
      safeStatus < 500
        ? error.message
        : fallbackMessage || "The protected recovery action could not be completed.",
  };

  if (Array.isArray(error?.missingTables)) {
    payload.missing_tables = error.missingTables;
  }
  if (Array.isArray(error?.countMismatches)) {
    payload.count_mismatches = error.countMismatches;
  }
  if (Array.isArray(error?.orphanReports)) {
    payload.foreign_key_orphans = error.orphanReports;
  }

  return res.status(safeStatus).json(payload);
}

async function recordProtectedBackupEvent(
  req,
  action,
  details,
  metadata,
  outcome = "success"
) {
  await writeAuditEvent({
    req,
    action,
    actionType: `backup.${action.toLowerCase()}`,
    outcome,
    severity: "critical",
    entityType: "backup",
    details,
    metadata: {
      ...metadata,
      authority: authorityLabel(req),
      original_owner_protected: true,
    },
  });

  await appendLedger({
    req,
    actorUserId: req.user.id,
    actionCode: action,
    outcome,
    severity: "critical",
    entityType: "backup",
    payload: {
      ...metadata,
      authority: authorityLabel(req),
      original_owner_protected: true,
    },
  });
}

router.get(
  "/download",
  requireAuth,
  requireBackupAuthority("backup_download"),
  requirePermission("backup.download"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { backup, contract } = await createFullSystemBackup(connection, {
        createdBy: {
          id: req.user.id,
          username: req.user.username,
          authority: authorityLabel(req),
        },
      });

      await recordBackupHistory(connection, {
        backup,
        userId: req.user.id,
        status: "created",
        verificationStatus: "not_verified",
      });

      await recordProtectedBackupEvent(
        req,
        "FULL_SYSTEM_BACKUP_CREATED",
        `${backup.included_tables.length} canonical tables were captured in a consistent full-system recovery package.`,
        {
          backup_id: backup.backup_id,
          table_count: backup.included_tables.length,
          total_record_count: backup.total_record_count,
          checksum_sha256: backup.checksum_sha256,
          schema_fingerprint_sha256: backup.schema_fingerprint_sha256,
          dependency_cycle_tables: contract.cycleTables,
        }
      );

      const timestamp = backup.created_at
        .replaceAll(":", "-")
        .replaceAll(".", "-");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="chalin03-full-system-backup-${timestamp}.json"`
      );
      return res.json(backup);
    } catch (error) {
      console.error("Full-system backup creation failed:", {
        code: error?.code,
        message: error?.message,
      });
      return sendBackupError(
        res,
        error,
        "The full-system backup could not be created safely. No incomplete backup was downloaded."
      );
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore/dry-run",
  requireAuth,
  requireBackupAuthority("backup_validate"),
  requirePermission("backup.validate"),
  requireProtectedAction,
  validateRequest(validateBackupDryRunRequest),
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const backup = req.validated.backup;
      const report = await validateFullSystemBackup(connection, backup, {
        requester: req.backupAuthority.user,
        requireRequesterPresence: !req.backupAuthority.isOriginalOwner,
      });

      if (backup?.backup_id) {
        await recordBackupHistory(connection, {
          backup,
          userId: backup.created_by?.id || null,
          status: report.valid ? "validated" : "validation_failed",
          verificationStatus: report.valid ? "verified" : "failed",
          verificationMessage: report.valid
            ? "Full-system checksum, table contract, schema fingerprint and row counts passed."
            : report.errors.join(" ").slice(0, 2000),
          verifiedBy: req.user.id,
        });
      }

      await recordProtectedBackupEvent(
        req,
        report.valid
          ? "FULL_SYSTEM_BACKUP_VALIDATED"
          : "FULL_SYSTEM_BACKUP_VALIDATION_FAILED",
        report.valid
          ? "Full-system recovery validation passed without changing data."
          : "Full-system recovery validation failed before any data change.",
        {
          backup_id: backup?.backup_id || null,
          valid: report.valid,
          error_count: report.errors.length,
          warning_count: report.warnings.length,
          checksum_sha256: backup?.checksum_sha256 || null,
        },
        report.valid ? "success" : "failure"
      );

      return res.status(report.valid ? 200 : 400).json({
        status: report.valid ? "success" : "error",
        message: report.valid
          ? "Backup validation and restore preview completed. No data was changed."
          : "Backup validation failed. No data was changed.",
        dry_run: true,
        ...validationResponse(report),
      });
    } catch (error) {
      console.error("Full-system backup validation failed:", {
        code: error?.code,
        message: error?.message,
      });
      return sendBackupError(
        res,
        error,
        "The restore preview could not be completed safely. No data was changed."
      );
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/restore",
  requireAuth,
  requireBackupAuthority("backup_restore"),
  requirePermission("backup.restore"),
  requireProtectedAction,
  validateRequest(validateBackupRestoreRequest),
  asyncHandler(async (req, res) => {
    if (String(process.env.ALLOW_WEB_RESTORE || "").toLowerCase() !== "true") {
      return res.status(403).json({
        status: "error",
        code: "WEB_RESTORE_WINDOW_CLOSED",
        message:
          "Web restore is disabled. The original owner must open an approved Railway restore window first.",
      });
    }

    const { backup, confirmation } = req.validated;
    if (cleanText(confirmation, 80) !== RESTORE_CONFIRMATION_TEXT) {
      return res.status(400).json({
        status: "error",
        code: "RESTORE_CONFIRMATION_REQUIRED",
        message: `Type ${RESTORE_CONFIRMATION_TEXT} exactly before restoring.`,
      });
    }

    const connection = await pool.getConnection();
    try {
      const report = await validateFullSystemBackup(connection, backup, {
        requester: req.backupAuthority.user,
        requireRequesterPresence: !req.backupAuthority.isOriginalOwner,
      });
      if (!report.valid) {
        return res.status(400).json({
          status: "error",
          code: "FULL_SYSTEM_BACKUP_VALIDATION_FAILED",
          message: "Backup validation failed. No restore was started.",
          ...validationResponse(report),
        });
      }

      const restoreResult = await restoreFullSystemBackup(
        connection,
        backup,
        report,
        {
          writeRestoreAudit: async (restoreConnection, evidence) => {
            await writeAuditEvent({
              connection: restoreConnection,
              userId: req.user.id,
              branchId: req.user?.branch_id || req.user?.default_branch_id || 1,
              workspaceCode: req.user?.workspace_code || "spare_parts",
              action: "FULL_SYSTEM_BACKUP_RESTORED",
              actionType: "backup.full_system_restore.completed",
              outcome: "success",
              severity: "critical",
              entityType: "backup",
              entityId: backup.backup_id,
              details:
                "A validated full-system recovery package was restored. All sessions, recovery codes in progress, fingerprint and face credentials were invalidated.",
              metadata: {
                backup_id: backup.backup_id,
                restored_tables: evidence.restoredTables,
                security_invalidation: evidence.securityInvalidation,
                authority: authorityLabel(req),
                original_owner_protected: true,
              },
            });
          },
        }
      );

      let ledgerWarning = null;
      try {
        await appendLedger({
          req,
          actorUserId: req.user.id,
          actionCode: "FULL_SYSTEM_BACKUP_RESTORED",
          outcome: "success",
          severity: "critical",
          entityType: "backup",
          entityId: backup.backup_id,
          payload: {
            backup_id: backup.backup_id,
            restored_tables: restoreResult.restoredTables,
            security_invalidation: restoreResult.securityInvalidation,
            authority: authorityLabel(req),
            original_owner_protected: true,
          },
        });
      } catch (ledgerError) {
        ledgerWarning =
          "Restore completed, but the post-commit privileged-ledger entry requires Administrator review.";
        console.error("Post-restore privileged ledger warning:", ledgerError);
      }

      return res.json({
        status: "success",
        message:
          "Full-system restore completed and all users were signed out. Sign in with a password before continuing; fingerprint and face access must be enrolled again.",
        backup_id: backup.backup_id,
        restored_tables: restoreResult.restoredTables,
        restored_table_counts: restoreResult.restoredTableCounts,
        security_invalidation: restoreResult.securityInvalidation,
        foreign_key_orphans: restoreResult.orphanReports,
        privileged_ledger_warning: ledgerWarning,
      });
    } catch (error) {
      console.error("Full-system restore failed:", {
        code: error?.code,
        message: error?.message,
        count_mismatches: error?.countMismatches,
        foreign_key_orphans: error?.orphanReports,
      });
      return sendBackupError(
        res,
        error,
        "The full-system restore failed and was rolled back. No success was reported."
      );
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
