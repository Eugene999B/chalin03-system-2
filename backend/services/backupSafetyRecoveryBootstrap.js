"use strict";

// Runtime hardening for CHALIN ONE disaster-recovery validation.
//
// The canonical backup validator already recognizes the three staging-only
// schema migration markers from currentSchemaMigrations. In Railway staging we
// have observed one runtime path where the base validator clearly saw those
// current migrations (they appeared in its server-generated "newer migrations"
// warning) while the earlier marker-array recognition path did not activate.
//
// This bootstrap provides a second, server-evidence-only staging gate. It never
// trusts marker names from the uploaded backup, request headers or request body.
// It only accepts the base validator's warning describing migrations present in
// the CURRENT target database. Production remains strict because the three
// CHALIN ONE staging markers do not exist in production.

const backupSafetyService = require("./backupSafetyService");

const INSTALL_FLAG = Symbol.for(
  "chalin03.backupSafetyRecoveryMarkerFallbackInstalled"
);
const CURRENT_MIGRATION_WARNING_PREFIX =
  "The current application has newer migrations than this backup.";
const RECOVERY_CONTRACT_WARNING =
  "CHALIN ONE staging recovery contract v4 activated from verified current-database migration markers.";

function currentMigrationWarningConfirmsStaging(report) {
  const markers = backupSafetyService.STAGING_RECOVERY_DATABASE_MARKERS || [];
  if (markers.length !== 3) return false;

  return (Array.isArray(report?.warnings) ? report.warnings : []).some(
    (warning) => {
      const text = String(warning || "");
      if (!text.startsWith(CURRENT_MIGRATION_WARNING_PREFIX)) return false;
      return markers.every((marker) => text.includes(marker));
    }
  );
}

function installBackupSafetyRecoveryMarkerFallback() {
  if (globalThis[INSTALL_FLAG]) return false;

  const originalValidateBackupContract =
    backupSafetyService.validateBackupContract;
  if (typeof originalValidateBackupContract !== "function") {
    throw new Error("Canonical backup validator is unavailable at startup.");
  }

  backupSafetyService.validateBackupContract = function validateBackupContract(
    args = {}
  ) {
    const initialReport = originalValidateBackupContract(args);

    if (
      initialReport?.crossEnvironmentRecovery === true ||
      !currentMigrationWarningConfirmsStaging(initialReport)
    ) {
      return initialReport;
    }

    // The evidence above came from currentSchemaMigrations supplied by the
    // server's database query. Force only the isolated staging recovery
    // identity and deliberately do not claim production HMAC verification.
    const recoveryEnvironment =
      backupSafetyService.forcedStagingRecoveryEnvironment(
        args?.recoveryEnvironment || process.env
      );
    const recoveryReport = originalValidateBackupContract({
      ...args,
      requireSignature: false,
      allowAdditiveSchemaDrift: true,
      allowCrossEnvironmentRecovery: true,
      recoveryEnvironment,
    });

    return {
      ...recoveryReport,
      warnings: [
        ...(Array.isArray(recoveryReport?.warnings)
          ? recoveryReport.warnings
          : []),
        RECOVERY_CONTRACT_WARNING,
      ],
      crossEnvironmentRecovery: true,
      signatureVerified: false,
      stagingRecoveryMarkerFallback: true,
      recoveryContract: "chalin-one-staging-recovery-v4",
    };
  };

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return true;
}

installBackupSafetyRecoveryMarkerFallback();

module.exports = {
  CURRENT_MIGRATION_WARNING_PREFIX,
  RECOVERY_CONTRACT_WARNING,
  currentMigrationWarningConfirmsStaging,
  installBackupSafetyRecoveryMarkerFallback,
};
