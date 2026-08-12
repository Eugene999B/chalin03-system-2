"use strict";

const base = require("../backupSafetyServiceBase");

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;
const CHALIN_ONE_STAGING_PUBLIC_DOMAIN =
  "chalin03-system-2-staging.up.railway.app";
const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";
const CHALIN_ONE_STAGING_GIT_BRANCH = "chalin-one";

const TECHNICAL_RECOVERY_TABLES = Object.freeze([
  "chalin03_migration_safety_snapshots",
  "chalin03_phase3_finance_safety_snapshots",
  "chalin03_snap_20260731_fin_fleet_assets",
  "chalin03_snap_20260731_fin_sale_agreements",
  "chalin03_snap_20260731_fin_schema_migrations",
  "chalin03_snap_20260731_ops_credit_apps",
  "chalin03_snap_20260731_ops_issued_documents",
  "chalin03_snap_20260731_ops_payment_alerts",
  "chalin03_snap_20260731_ops_sale_agreements",
  "chalin03_snap_20260731_ops_sale_payments",
]);

// These are recovery mechanics rather than durable business records. Mutating
// the shared Sets is intentional: classifyDatabaseTables() closes over them,
// so future signed-v2 backups omit these technical snapshots and passkey
// challenges without changing the canonical checksum contract for old files.
base.EPHEMERAL_SECURITY_TABLES.add("passkey_challenges");
base.NEVER_RESTORE_TABLES.add("passkey_challenges");
for (const tableName of TECHNICAL_RECOVERY_TABLES) {
  base.NEVER_RESTORE_TABLES.add(tableName);
}

function cleanEnvironmentValue(value) {
  return String(value || "").trim().toLowerCase();
}

function railwayEnvironmentName(env = process.env) {
  return cleanEnvironmentValue(env.RAILWAY_ENVIRONMENT_NAME);
}

function railwayEnvironmentId(env = process.env) {
  return cleanEnvironmentValue(env.RAILWAY_ENVIRONMENT_ID);
}

function railwayPublicDomain(env = process.env) {
  return cleanEnvironmentValue(env.RAILWAY_PUBLIC_DOMAIN);
}

function railwayGitBranch(env = process.env) {
  return cleanEnvironmentValue(env.RAILWAY_GIT_BRANCH);
}

function isConfirmedRailwayStaging(env = process.env) {
  const gitBranch = railwayGitBranch(env);
  if (gitBranch === CHALIN_ONE_STAGING_GIT_BRANCH) return true;

  const environmentName = railwayEnvironmentName(env);
  if (environmentName === "staging") return true;

  const environmentId = railwayEnvironmentId(env);
  if (environmentId === CHALIN_ONE_STAGING_ENVIRONMENT_ID) return true;

  return railwayPublicDomain(env) === CHALIN_ONE_STAGING_PUBLIC_DOMAIN;
}

function isLiveProductionEnvironment(env = process.env) {
  // Railway staging sometimes runs the Node process with NODE_ENV=production.
  // The Railway service identity is more authoritative than NODE_ENV for
  // deciding whether cross-environment recovery controls are permitted.
  if (isConfirmedRailwayStaging(env)) return false;

  const railwayEnvironment = railwayEnvironmentName(env);
  if (railwayEnvironment) {
    return railwayEnvironment === "production";
  }
  return cleanEnvironmentValue(env.NODE_ENV) === "production";
}

function canOmitCurrentColumn(columnMetadata) {
  if (!columnMetadata || typeof columnMetadata !== "object") return false;
  if (columnMetadata.nullable === true) return true;
  if (columnMetadata.hasDefault === true) return true;
  return String(columnMetadata.extra || "")
    .toLowerCase()
    .includes("auto_increment");
}

function isCrossEnvironmentRecovery(
  { backup, requireSignature, allowAdditiveSchemaDrift, allowCrossEnvironmentRecovery },
  env = process.env
) {
  const signedV2Backup =
    backup?.backup_type === base.BACKUP_TYPE &&
    backup?.version === base.BACKUP_MANIFEST_VERSION;

  if (!signedV2Backup || allowAdditiveSchemaDrift !== true) return false;

  const confirmedRailwayStaging = isConfirmedRailwayStaging(env);
  const railwayEnvironment = railwayEnvironmentName(env);

  // An explicitly identified Railway production environment is an immutable
  // boundary unless the same server identity also proves it is the dedicated
  // CHALIN ONE staging service (environment id/public domain/Git branch). This
  // protects production from accidental opt-in while allowing Railway's
  // production-like Node runtime settings on staging.
  if (railwayEnvironment === "production" && !confirmedRailwayStaging) {
    return false;
  }

  // A positively identified Railway staging service may validate a production-
  // signed v2 package even when target-side HMAC enforcement would normally be
  // enabled by NODE_ENV=production.
  if (confirmedRailwayStaging) return true;

  // This explicit flag is server-only and is supplied only by the protected
  // staging recovery router after its staging request gate. It lets that route
  // work when NODE_ENV is production but Railway identity metadata is absent.
  if (allowCrossEnvironmentRecovery === true) {
    return requireSignature === false;
  }

  // Generic local/non-production recovery remains available only when target-
  // side signature enforcement has been deliberately disabled.
  if (isLiveProductionEnvironment(env)) return false;
  return requireSignature === false;
}

function isCompatibilityError(message) {
  const text = String(message || "");
  return (
    text.startsWith(
      "Backup contains tables that are not supported by the current database:"
    ) ||
    /^Backup columns for .+ are not supported by the current database:/.test(text) ||
    text.startsWith(
      "Backup was created by a schema newer than or incompatible with this runtime. Unknown backup migrations:"
    ) ||
    text ===
      "Backup migration history does not match the current application schema. Apply the matching code and migrations before restoring." ||
    text === "Backup signature is missing or invalid for this server."
  );
}

function validateCrossEnvironmentShape({
  backup,
  currentIncludedTables,
  currentTableColumns,
  currentTableMetadata,
  report,
}) {
  const errors = [];
  const warnings = [];
  const expectedTables = base.sortedUniqueIdentifiers(currentIncludedTables);
  const rawIncludedTables = base.sortedUniqueIdentifiers(backup.included_tables);
  const includedTables = rawIncludedTables.filter(
    (tableName) =>
      expectedTables.includes(tableName) &&
      !base.NEVER_RESTORE_TABLES.has(tableName)
  );
  const sourceOnlyTables = rawIncludedTables.filter(
    (tableName) =>
      !expectedTables.includes(tableName) &&
      !base.NEVER_RESTORE_TABLES.has(tableName)
  );
  const currentOnlyTables = expectedTables.filter(
    (tableName) => !rawIncludedTables.includes(tableName)
  );
  const restoreColumns = {};
  const sourceOnlyColumns = {};

  if (!SIGNATURE_PATTERN.test(String(backup.signature_hmac_sha256 || ""))) {
    errors.push(
      "Cross-environment recovery requires the source signed-v2 HMAC signature to be present in the backup package."
    );
  }

  if (includedTables.length === 0) {
    errors.push(
      "Cross-environment recovery found no common restorable tables between the backup and this target database."
    );
  }

  if (sourceOnlyTables.length) {
    warnings.push(
      `The source backup contains ${sourceOnlyTables.length} durable table(s) that do not exist in this non-production target. Restore remains blocked until the trial schema is prepared: ${sourceOnlyTables.join(", ")}.`
    );
  }

  if (currentOnlyTables.length) {
    warnings.push(
      `The non-production target contains ${currentOnlyTables.length} newer/local table(s) that are absent from the source backup. They will be preserved: ${currentOnlyTables.join(", ")}.`
    );
  }

  for (const tableName of includedTables) {
    const targetColumns = base.sortedUniqueIdentifiers(
      currentTableColumns?.[tableName] || []
    );
    const sourceColumns = base.sortedUniqueIdentifiers(
      backup.table_columns?.[tableName] || []
    );
    const commonColumns = sourceColumns.filter((columnName) =>
      targetColumns.includes(columnName)
    );
    const missingSourceColumns = sourceColumns.filter(
      (columnName) => !targetColumns.includes(columnName)
    );
    const targetOnlyColumns = targetColumns.filter(
      (columnName) => !sourceColumns.includes(columnName)
    );

    if ((backup.tables?.[tableName] || []).length > 0 && !commonColumns.length) {
      errors.push(
        `Cross-environment recovery cannot safely map any columns for ${tableName}.`
      );
      continue;
    }

    if (missingSourceColumns.length) {
      sourceOnlyColumns[tableName] = missingSourceColumns;
      warnings.push(
        `The source backup has ${missingSourceColumns.length} durable column(s) for ${tableName} that this trial target does not have. Restore remains blocked until the trial schema is prepared: ${missingSourceColumns.join(", ")}.`
      );
    }

    if (targetOnlyColumns.length && (backup.tables?.[tableName] || []).length) {
      const metadataByName = new Map(
        (currentTableMetadata?.[tableName] || []).map((column) => [
          column.name,
          column,
        ])
      );
      const requiredMissingColumns = targetOnlyColumns.filter(
        (columnName) => !canOmitCurrentColumn(metadataByName.get(columnName))
      );
      if (requiredMissingColumns.length) {
        errors.push(
          `Cross-environment recovery cannot safely supply required target columns for ${tableName}: ${requiredMissingColumns.join(", ")}.`
        );
      } else {
        warnings.push(
          `The trial target has additive columns for ${tableName} that will use their current defaults or NULL values: ${targetOnlyColumns.join(", ")}.`
        );
      }
    }

    restoreColumns[tableName] = commonColumns;
  }

  const totalRows = includedTables.reduce(
    (total, tableName) =>
      total +
      (Array.isArray(backup.tables?.[tableName])
        ? backup.tables[tableName].length
        : 0),
    0
  );

  return {
    errors,
    warnings,
    includedTables,
    sourceOnlyTables,
    sourceOnlyColumns,
    currentOnlyTables,
    restoreColumns,
    totalRows,
    originalReport: report,
  };
}

function validateBackupContract(args) {
  const report = base.validateBackupContract(args);
  if (!isCrossEnvironmentRecovery(args, args.recoveryEnvironment || process.env)) {
    return report;
  }

  const backup = args.backup;
  const checksumFailed = report.errors.some((error) =>
    /checksum/i.test(String(error || ""))
  );
  if (checksumFailed) return report;

  const compatibility = validateCrossEnvironmentShape({
    backup,
    currentIncludedTables: args.currentIncludedTables,
    currentTableColumns: args.currentTableColumns,
    currentTableMetadata: args.currentTableMetadata || {},
    report,
  });

  const retainedErrors = report.errors.filter(
    (error) => !isCompatibilityError(error)
  );
  const errors = [...retainedErrors, ...compatibility.errors];
  const warnings = [
    ...report.warnings,
    ...report.errors.filter(isCompatibilityError).map(
      (error) => `Cross-environment trial compatibility: ${error}`
    ),
    ...compatibility.warnings,
  ];

  if (errors.length === 0) {
    backup.table_columns = {
      ...(backup.table_columns && typeof backup.table_columns === "object"
        ? backup.table_columns
        : {}),
      ...compatibility.restoreColumns,
    };
  }

  return {
    ...report,
    valid: errors.length === 0,
    errors,
    warnings,
    includedTables: compatibility.includedTables,
    currentOnlyTables: compatibility.currentOnlyTables,
    sourceOnlyTables: compatibility.sourceOnlyTables,
    sourceOnlyColumns: compatibility.sourceOnlyColumns,
    totalRows: compatibility.totalRows,
    restoreColumns: compatibility.restoreColumns,
    crossEnvironmentRecovery: true,
    signatureVerified: false,
    additiveSchemaCompatibilityApplied: true,
  };
}

module.exports = {
  ...base,
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  CHALIN_ONE_STAGING_GIT_BRANCH,
  CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
  TECHNICAL_RECOVERY_TABLES,
  isConfirmedRailwayStaging,
  isCrossEnvironmentRecovery,
  isLiveProductionEnvironment,
  railwayEnvironmentId,
  railwayEnvironmentName,
  railwayGitBranch,
  railwayPublicDomain,
  validateBackupContract,
};