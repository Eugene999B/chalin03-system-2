"use strict";

const base = require("../backupSafetyServiceBase");

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function cleanEnvironmentValue(value) {
  return String(value || "").trim().toLowerCase();
}

function railwayEnvironmentName(env = process.env) {
  return cleanEnvironmentValue(env.RAILWAY_ENVIRONMENT_NAME);
}

function isLiveProductionEnvironment(env = process.env) {
  const railwayEnvironment = railwayEnvironmentName(env);
  if (railwayEnvironment) {
    return railwayEnvironment === "production";
  }
  return cleanEnvironmentValue(env.NODE_ENV) === "production";
}

function isConfirmedRailwayStaging(env = process.env) {
  return railwayEnvironmentName(env) === "staging";
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
  { backup, requireSignature },
  env = process.env
) {
  const signedV2Backup =
    backup?.backup_type === base.BACKUP_TYPE &&
    backup?.version === base.BACKUP_MANIFEST_VERSION;

  if (!signedV2Backup || isLiveProductionEnvironment(env)) {
    return false;
  }

  // Ordinary non-production callers opt into recovery by setting
  // requireSignature=false. Railway staging is also authoritative here because
  // some deployment stacks still set NODE_ENV=production while the actual
  // isolated Railway environment is staging. Never let that deployment detail
  // turn a staging recovery validation back into live-production HMAC matching.
  return requireSignature === false || isConfirmedRailwayStaging(env);
}

function isCompatibilityError(message) {
  const text = String(message || "");
  return (
    text.startsWith(
      "Backup contains tables that are not supported by the current database:"
    ) ||
    (/^Backup columns for .+ are not supported by the current database:/.test(
      text
    )) ||
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
      `The source backup contains ${sourceOnlyTables.length} table(s) that do not exist in this non-production target. They will be preserved in the backup file but skipped during this trial restore: ${sourceOnlyTables.join(", ")}.`
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
    const sourceOnlyColumns = sourceColumns.filter(
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

    if (sourceOnlyColumns.length) {
      warnings.push(
        `The source backup has newer columns for ${tableName} that this trial target does not have. Those columns will be skipped here: ${sourceOnlyColumns.join(", ")}.`
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
    currentOnlyTables,
    restoreColumns,
    totalRows,
    originalReport: report,
  };
}

function validateBackupContract(args) {
  const report = base.validateBackupContract(args);
  if (!isCrossEnvironmentRecovery(args)) return report;

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
    totalRows: compatibility.totalRows,
    restoreColumns: compatibility.restoreColumns,
    crossEnvironmentRecovery: true,
    signatureVerified: false,
    additiveSchemaCompatibilityApplied: true,
  };
}

module.exports = {
  ...base,
  isConfirmedRailwayStaging,
  isCrossEnvironmentRecovery,
  isLiveProductionEnvironment,
  railwayEnvironmentName,
  validateBackupContract,
};
