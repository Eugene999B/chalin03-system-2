const crypto = require("crypto");

const BACKUP_MANIFEST_VERSION = "chalin03-full-system-v2";
const LEGACY_DELEGATED_MANIFEST_VERSION = "chalin03-version-3-delegated-v1";
const LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION =
  "chalin03-equipment-sales-foundation-v1";
const BACKUP_TYPE = "full_system_backup";

const LEGACY_ALIAS_TABLES = new Set([
  "stores",
  "user_store_access",
  "activity_logs",
]);

// These tables contain short-lived authentication or recovery material. They
// are deliberately never restored. A restore clears them and increments every
// user's token version so no pre-restore browser session remains valid.
const EPHEMERAL_SECURITY_TABLES = new Set([
  "auth_sessions",
  "password_recovery_otps",
  "protected_action_sessions",
  "owner_recovery_sessions",
  "owner_break_glass_mfa_enrollments",
]);

const NEVER_RESTORE_TABLES = new Set([
  "schema_migrations",
  ...LEGACY_ALIAS_TABLES,
  ...EPHEMERAL_SECURITY_TABLES,
]);

const LEGACY_CHECKSUM_ONLY_VERSIONS = new Set([
  LEGACY_DELEGATED_MANIFEST_VERSION,
  LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION,
]);

function isSafeIdentifier(value) {
  return /^[a-zA-Z0-9_]+$/.test(String(value || ""));
}

function safeTableName(tableName) {
  if (!isSafeIdentifier(tableName)) {
    const error = new Error(`Unsafe database identifier: ${tableName}`);
    error.code = "BACKUP_UNSAFE_IDENTIFIER";
    throw error;
  }
  return `\`${tableName}\``;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function backupIntegrityPayload(backup) {
  return canonicalize({
    app: backup.app,
    version: backup.version,
    backup_type: backup.backup_type,
    backup_id: backup.backup_id,
    created_at: backup.created_at,
    included_tables: backup.included_tables,
    excluded_tables: backup.excluded_tables,
    table_columns: backup.table_columns,
    table_counts: backup.table_counts,
    total_record_count: backup.total_record_count,
    schema_migrations: backup.schema_migrations,
    tables: backup.tables,
  });
}

function stableBackupJson(backup) {
  return JSON.stringify(backupIntegrityPayload(backup));
}

function checksumBackup(backup) {
  return crypto.createHash("sha256").update(stableBackupJson(backup)).digest("hex");
}

function legacyDelegatedChecksum(backup) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        backup_type: backup?.backup_type,
        included_tables: backup?.included_tables,
        table_counts: backup?.table_counts,
        tables: backup?.tables,
      })
    )
    .digest("hex");
}

function signBackup(backup, signingSecret) {
  const secret = String(signingSecret || "").trim();
  if (secret.length < 64) {
    const error = new Error("BACKUP_SIGNING_SECRET must contain at least 64 characters.");
    error.code = "BACKUP_SIGNING_SECRET_INVALID";
    throw error;
  }

  return crypto
    .createHmac("sha256", secret)
    .update(stableBackupJson(backup))
    .digest("hex");
}

function secureEqualHex(left, right) {
  const leftText = String(left || "").trim().toLowerCase();
  const rightText = String(right || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(leftText) || !/^[a-f0-9]{64}$/.test(rightText)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(leftText, "hex"), Buffer.from(rightText, "hex"));
}

function sortedUniqueIdentifiers(values) {
  return [...new Set((values || []).filter(isSafeIdentifier))].sort();
}

function classifyDatabaseTables(tableNames) {
  const allTables = sortedUniqueIdentifiers(tableNames);
  const excludedTables = allTables.filter((tableName) => NEVER_RESTORE_TABLES.has(tableName));
  const includedTables = allTables.filter((tableName) => !NEVER_RESTORE_TABLES.has(tableName));

  return {
    allTables,
    includedTables,
    excludedTables,
    ephemeralSecurityTables: allTables.filter((tableName) =>
      EPHEMERAL_SECURITY_TABLES.has(tableName)
    ),
  };
}

function sameStringSet(left, right) {
  const leftSorted = sortedUniqueIdentifiers(left);
  const rightSorted = sortedUniqueIdentifiers(right);
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function canOmitCurrentColumn(columnMetadata) {
  if (!columnMetadata || typeof columnMetadata !== "object") return false;
  if (columnMetadata.nullable === true) return true;
  if (columnMetadata.hasDefault === true) return true;
  const extra = String(columnMetadata.extra || "").toLowerCase();
  return extra.includes("auto_increment");
}

function normalizeLegacyRestoreValue(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.type === "Buffer" &&
    Array.isArray(value.data) &&
    value.data.every(
      (entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255
    )
  ) {
    return {
      __chalin03_type: "buffer_base64",
      data: Buffer.from(value.data).toString("base64"),
    };
  }
  return value;
}

function isLegacyDelegatedBackup(backup) {
  return (
    backup?.backup_type === BACKUP_TYPE &&
    backup?.version === LEGACY_DELEGATED_MANIFEST_VERSION
  );
}

function isHistoricalChecksumBackup(backup) {
  return (
    backup?.backup_type === BACKUP_TYPE &&
    LEGACY_CHECKSUM_ONLY_VERSIONS.has(String(backup?.version || ""))
  );
}

function validateBackupContract({
  backup,
  currentIncludedTables,
  currentTableColumns,
  currentTableMetadata = {},
  currentSchemaMigrations = [],
  signingSecret,
  requireSignature,
  allowAdditiveSchemaDrift = false,
}) {
  const errors = [];
  const warnings = [];

  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    return {
      valid: false,
      errors: ["Backup must be a JSON object."],
      warnings,
    };
  }

  const legacyChecksumOnly = isHistoricalChecksumBackup(backup);

  if (backup.backup_type !== BACKUP_TYPE) {
    errors.push("Backup type is not a Chalin 03 full-system backup.");
  }

  if (
    backup.version !== BACKUP_MANIFEST_VERSION &&
    !LEGACY_CHECKSUM_ONLY_VERSIONS.has(String(backup.version || ""))
  ) {
    errors.push(
      `Backup format ${backup.version || "unknown"} is not supported. Supported recovery formats are ${BACKUP_MANIFEST_VERSION}, ${LEGACY_DELEGATED_MANIFEST_VERSION}, and ${LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION}.`
    );
  }

  if (!Array.isArray(backup.included_tables) || !backup.tables) {
    errors.push("Backup table inventory is incomplete.");
    return { valid: false, errors, warnings };
  }

  const expectedTables = sortedUniqueIdentifiers(currentIncludedTables);
  const rawIncludedTables = sortedUniqueIdentifiers(backup.included_tables);
  const tableKeys = sortedUniqueIdentifiers(Object.keys(backup.tables || {}));
  const legacyExcludedTables = legacyChecksumOnly
    ? rawIncludedTables.filter((name) => NEVER_RESTORE_TABLES.has(name))
    : [];
  const includedTables = legacyChecksumOnly
    ? rawIncludedTables.filter(
        (name) => expectedTables.includes(name) && !NEVER_RESTORE_TABLES.has(name)
      )
    : rawIncludedTables;
  const missingCurrentTables = expectedTables.filter(
    (name) => !includedTables.includes(name)
  );
  const unsupportedTables = includedTables.filter(
    (name) => !expectedTables.includes(name)
  );
  const unsupportedLegacyTables = legacyChecksumOnly
    ? rawIncludedTables.filter(
        (name) =>
          !expectedTables.includes(name) && !NEVER_RESTORE_TABLES.has(name)
      )
    : [];

  if (legacyChecksumOnly) {
    warnings.push(
      `Historical CHALIN backup detected (${backup.version}). Its original SHA-256 checksum will be verified and its missing column manifest will be reconstructed before restore.`
    );
    if (legacyExcludedTables.length) {
      warnings.push(
        `Historical security/schema tables will not be restored: ${legacyExcludedTables.join(", ")}.`
      );
    }
    if (unsupportedLegacyTables.length) {
      warnings.push(
        `Historical tables no longer present in the current runtime will be ignored: ${unsupportedLegacyTables.join(", ")}.`
      );
    }
    if (missingCurrentTables.length) {
      warnings.push(
        `The current application has newer tables that were not present in this historical backup. They will be preserved during restore: ${missingCurrentTables.join(", ")}.`
      );
    }
  } else if (allowAdditiveSchemaDrift) {
    if (unsupportedTables.length) {
      errors.push(
        `Backup contains tables that are not supported by the current database: ${unsupportedTables.join(", ")}.`
      );
    }
    if (missingCurrentTables.length) {
      warnings.push(
        `The current application has newer tables that were not present when this backup was created. They will be preserved during restore: ${missingCurrentTables.join(", ")}.`
      );
    }
  } else if (!sameStringSet(includedTables, expectedTables)) {
    if (missingCurrentTables.length) {
      errors.push(`Backup is missing current required tables: ${missingCurrentTables.join(", ")}.`);
    }
    if (unsupportedTables.length) {
      errors.push(`Backup contains unsupported restorable tables: ${unsupportedTables.join(", ")}.`);
    }
  }

  if (!sameStringSet(tableKeys, rawIncludedTables)) {
    errors.push("Backup table data does not exactly match its included-table manifest.");
  }

  const restoreColumns = {};
  let totalRows = 0;
  let allBackupRows = 0;

  for (const tableName of rawIncludedTables) {
    const rows = backup.tables?.[tableName];
    if (!Array.isArray(rows)) {
      errors.push(`Backup table ${tableName} is not an array.`);
      continue;
    }
    allBackupRows += rows.length;

    const expectedCount = Number(backup.table_counts?.[tableName]);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      errors.push(`Backup table count for ${tableName} is invalid.`);
    } else if (expectedCount !== rows.length) {
      if (legacyChecksumOnly) {
        warnings.push(
          `Historical backup count warning for ${tableName}: declared ${expectedCount}, actual ${rows.length}. The original checksum must still verify before recovery is allowed.`
        );
      } else {
        errors.push(`Backup table count for ${tableName} does not match its row data.`);
      }
    }

    if (!includedTables.includes(tableName)) {
      continue;
    }

    const expectedColumns = sortedUniqueIdentifiers(currentTableColumns?.[tableName] || []);
    let manifestColumns = sortedUniqueIdentifiers(backup.table_columns?.[tableName] || []);

    if (legacyChecksumOnly) {
      if (rows.length > 0) {
        manifestColumns = sortedUniqueIdentifiers(Object.keys(rows[0] || {}));
      } else {
        manifestColumns = [];
      }
    }

    const unsupportedColumns = manifestColumns.filter(
      (name) => !expectedColumns.includes(name)
    );
    const missingCurrentColumns = expectedColumns.filter(
      (name) => !manifestColumns.includes(name)
    );

    if (legacyChecksumOnly) {
      if (unsupportedColumns.length) {
        errors.push(
          `Historical backup columns for ${tableName} are not supported by the current database: ${unsupportedColumns.join(", ")}.`
        );
      }
      if (rows.length > 0 && missingCurrentColumns.length) {
        const metadataByName = new Map(
          (currentTableMetadata?.[tableName] || []).map((column) => [
            column.name,
            column,
          ])
        );
        const requiredMissingColumns = missingCurrentColumns.filter(
          (columnName) => !canOmitCurrentColumn(metadataByName.get(columnName))
        );
        if (requiredMissingColumns.length) {
          errors.push(
            `Historical backup ${tableName} cannot safely supply required current columns: ${requiredMissingColumns.join(", ")}.`
          );
        } else {
          warnings.push(
            `Historical backup ${tableName} predates additive columns that can safely use current defaults or NULL values: ${missingCurrentColumns.join(", ")}.`
          );
        }
      }
    } else if (allowAdditiveSchemaDrift) {
      if (unsupportedColumns.length) {
        errors.push(
          `Backup columns for ${tableName} are not supported by the current database: ${unsupportedColumns.join(", ")}.`
        );
      }
      if (missingCurrentColumns.length) {
        const metadataByName = new Map(
          (currentTableMetadata?.[tableName] || []).map((column) => [
            column.name,
            column,
          ])
        );
        const requiredMissingColumns = missingCurrentColumns.filter(
          (columnName) => !canOmitCurrentColumn(metadataByName.get(columnName))
        );
        if (requiredMissingColumns.length) {
          errors.push(
            `Backup ${tableName} is older than the current schema and cannot safely supply required columns: ${requiredMissingColumns.join(", ")}.`
          );
        } else {
          warnings.push(
            `Backup ${tableName} predates additive columns that can safely use current defaults or NULL values: ${missingCurrentColumns.join(", ")}.`
          );
        }
      }
    } else if (!sameStringSet(expectedColumns, manifestColumns)) {
      errors.push(`Backup columns for ${tableName} do not match the current database schema.`);
    }

    restoreColumns[tableName] = manifestColumns.filter((column) =>
      expectedColumns.includes(column)
    );

    const seenIds = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`Backup table ${tableName} contains an invalid row at index ${index}.`);
        continue;
      }

      const rowColumns = sortedUniqueIdentifiers(Object.keys(row));
      if (
        rows.length > 0 &&
        !sameStringSet(rowColumns, manifestColumns)
      ) {
        errors.push(`Backup table ${tableName} row ${index} has an incomplete or unexpected column set.`);
        break;
      }

      if (row.id !== undefined && row.id !== null) {
        const id = String(row.id);
        if (seenIds.has(id)) {
          errors.push(`Backup table ${tableName} contains duplicate id ${id}.`);
          break;
        }
        seenIds.add(id);
      }
    }

    totalRows += rows.length;
  }

  if (Number(backup.total_record_count) !== allBackupRows) {
    if (legacyChecksumOnly) {
      warnings.push(
        `Historical backup total-count warning: declared ${Number(
          backup.total_record_count
        )}, actual ${allBackupRows}. The original checksum must still verify before recovery is allowed.`
      );
    } else {
      errors.push("Backup total record count does not match its table data.");
    }
  }

  if (legacyChecksumOnly) {
    warnings.push(
      "Historical backup migration history is preserved as data evidence but is not replayed. Current schema migrations remain authoritative."
    );
  } else {
    const expectedMigrationNames = sortedUniqueIdentifiers(
      (currentSchemaMigrations || []).map((migration) => migration?.migration_name)
    );
    const backupMigrationNames = sortedUniqueIdentifiers(
      (backup.schema_migrations || []).map((migration) => migration?.migration_name)
    );
    if (allowAdditiveSchemaDrift) {
      const unknownBackupMigrations = backupMigrationNames.filter(
        (name) => !expectedMigrationNames.includes(name)
      );
      const newerCurrentMigrations = expectedMigrationNames.filter(
        (name) => !backupMigrationNames.includes(name)
      );
      if (unknownBackupMigrations.length) {
        errors.push(
          `Backup was created by a schema newer than or incompatible with this runtime. Unknown backup migrations: ${unknownBackupMigrations.join(", ")}.`
        );
      }
      if (newerCurrentMigrations.length) {
        warnings.push(
          `The current application has newer migrations than this backup. Additive compatibility checks were applied: ${newerCurrentMigrations.join(", ")}.`
        );
      }
    } else if (!sameStringSet(expectedMigrationNames, backupMigrationNames)) {
      errors.push(
        "Backup migration history does not match the current application schema. Apply the matching code and migrations before restoring."
      );
    }
  }

  const expectedChecksum = legacyChecksumOnly
    ? legacyDelegatedChecksum(backup)
    : checksumBackup(backup);
  if (!secureEqualHex(expectedChecksum, backup.checksum_sha256)) {
    errors.push("Backup checksum does not match the backup contents.");
  }

  const secret = String(signingSecret || "").trim();
  if (legacyChecksumOnly) {
    warnings.push(
      "This historical CHALIN backup predates HMAC signing. It can only be used through the original-owner protected recovery route; signed v2 backups remain the standard format."
    );
  } else if (requireSignature && secret.length < 64) {
    errors.push("Backup signing is not configured on this server.");
  } else if (secret.length >= 64) {
    const expectedSignature = signBackup(backup, secret);
    if (!secureEqualHex(expectedSignature, backup.signature_hmac_sha256)) {
      errors.push("Backup signature is missing or invalid for this server.");
    }
  } else {
    warnings.push("Backup signature was not verified because this non-production server has no signing secret.");
  }

  if (legacyChecksumOnly && errors.length === 0) {
    backup.table_columns = {
      ...(backup.table_columns && typeof backup.table_columns === "object"
        ? backup.table_columns
        : {}),
      ...restoreColumns,
    };

    for (const tableName of includedTables) {
      const rows = backup.tables?.[tableName];
      const columns = restoreColumns[tableName] || [];
      if (!Array.isArray(rows) || rows.length === 0 || columns.length === 0) {
        continue;
      }
      for (const row of rows) {
        for (const columnName of columns) {
          row[columnName] = normalizeLegacyRestoreValue(row[columnName]);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    includedTables,
    currentOnlyTables: missingCurrentTables,
    totalRows,
    restoreColumns,
    backupFormat: String(backup.version || BACKUP_MANIFEST_VERSION),
    legacyUnsignedBackup: legacyChecksumOnly,
    additiveSchemaCompatibilityApplied:
      legacyChecksumOnly ||
      (allowAdditiveSchemaDrift &&
        (missingCurrentTables.length > 0 ||
          warnings.some((warning) => /additive|newer|predates/i.test(warning)))),
  };
}

module.exports = {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  EPHEMERAL_SECURITY_TABLES,
  LEGACY_ALIAS_TABLES,
  LEGACY_DELEGATED_MANIFEST_VERSION,
  LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION,
  NEVER_RESTORE_TABLES,
  backupIntegrityPayload,
  canonicalize,
  checksumBackup,
  classifyDatabaseTables,
  isHistoricalChecksumBackup,
  isLegacyDelegatedBackup,
  isSafeIdentifier,
  legacyDelegatedChecksum,
  safeTableName,
  sameStringSet,
  signBackup,
  sortedUniqueIdentifiers,
  stableBackupJson,
  validateBackupContract,
};
