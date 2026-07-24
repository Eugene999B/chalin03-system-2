const crypto = require("crypto");

const { BACKUP_MANIFEST_VERSION } = require("../config/version");

const LEGACY_ALIAS_TABLES = new Set([
  "stores",
  "user_store_access",
  "activity_logs",
]);

const NON_RESTORABLE_TABLES = new Set(["schema_migrations"]);
const REQUIRED_CORE_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
]);
const GENERATION_KEY = "bank_biometric_generation";

function recoveryError(message, code, statusCode = 400, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, metadata);
  return error;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSafeIdentifier(value) {
  return /^[A-Za-z0-9_]+$/.test(String(value || ""));
}

function safeIdentifier(value) {
  if (!isSafeIdentifier(value)) {
    throw recoveryError(
      `Unsafe database identifier: ${value}`,
      "UNSAFE_DATABASE_IDENTIFIER",
      500
    );
  }
  return `\`${value}\``;
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function checksumPayload(backup) {
  return {
    app: backup.app,
    version: backup.version,
    backup_id: backup.backup_id,
    backup_type: backup.backup_type,
    created_at: backup.created_at,
    included_tables: backup.included_tables,
    table_counts: backup.table_counts,
    total_record_count: backup.total_record_count,
    schema_fingerprint_sha256: backup.schema_fingerprint_sha256,
    tables: backup.tables,
  };
}

function stableBackupChecksum(backup) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(checksumPayload(backup)))
    .digest("hex");
}

function stableSchemaFingerprint(schemaContract) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(schemaContract))
    .digest("hex");
}

async function listBaseTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );

  return sortedUnique(
    rows
      .map((row) => row.TABLE_NAME)
      .filter(isSafeIdentifier)
      .filter((tableName) => !LEGACY_ALIAS_TABLES.has(tableName))
  );
}

async function loadForeignKeyMetadata(connection, tableNames) {
  if (!tableNames.length) return [];
  const [rows] = await connection.query(
    `SELECT
       CONSTRAINT_NAME,
       TABLE_NAME,
       COLUMN_NAME,
       REFERENCED_TABLE_NAME,
       REFERENCED_COLUMN_NAME,
       ORDINAL_POSITION
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND REFERENCED_TABLE_NAME IS NOT NULL
       AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})
     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    tableNames
  );

  return rows.map((row) => ({
    constraint_name: row.CONSTRAINT_NAME,
    child_table: row.TABLE_NAME,
    child_column: row.COLUMN_NAME,
    parent_table: row.REFERENCED_TABLE_NAME,
    parent_column: row.REFERENCED_COLUMN_NAME,
    ordinal_position: Number(row.ORDINAL_POSITION || 0),
  }));
}

async function loadColumnMetadata(connection, tableNames) {
  if (!tableNames.length) return [];
  const [rows] = await connection.query(
    `SELECT
       TABLE_NAME,
       COLUMN_NAME,
       ORDINAL_POSITION,
       COLUMN_TYPE,
       IS_NULLABLE,
       COLUMN_DEFAULT,
       COLUMN_KEY,
       EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    tableNames
  );

  return rows.map((row) => ({
    table_name: row.TABLE_NAME,
    column_name: row.COLUMN_NAME,
    ordinal_position: Number(row.ORDINAL_POSITION || 0),
    column_type: row.COLUMN_TYPE,
    is_nullable: row.IS_NULLABLE,
    column_default:
      row.COLUMN_DEFAULT === undefined ? null : row.COLUMN_DEFAULT,
    column_key: row.COLUMN_KEY || "",
    extra: row.EXTRA || "",
  }));
}

function orderTablesByDependencies(tableNames, foreignKeys) {
  const tableSet = new Set(tableNames);
  const childrenByParent = new Map(
    tableNames.map((tableName) => [tableName, new Set()])
  );
  const indegree = new Map(tableNames.map((tableName) => [tableName, 0]));

  for (const foreignKey of foreignKeys) {
    const child = foreignKey.child_table;
    const parent = foreignKey.parent_table;
    if (!tableSet.has(child) || !tableSet.has(parent) || child === parent) continue;
    const children = childrenByParent.get(parent);
    if (!children.has(child)) {
      children.add(child);
      indegree.set(child, Number(indegree.get(child) || 0) + 1);
    }
  }

  const ready = tableNames
    .filter((tableName) => Number(indegree.get(tableName) || 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const ordered = [];

  while (ready.length) {
    const tableName = ready.shift();
    ordered.push(tableName);
    const children = Array.from(childrenByParent.get(tableName) || []).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const child of children) {
      const nextDegree = Number(indegree.get(child) || 0) - 1;
      indegree.set(child, nextDegree);
      if (nextDegree === 0) {
        ready.push(child);
        ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  const cycleTables = tableNames
    .filter((tableName) => !ordered.includes(tableName))
    .sort((a, b) => a.localeCompare(b));

  return {
    insertOrder: [...ordered, ...cycleTables],
    deleteOrder: [...ordered, ...cycleTables].reverse(),
    cycleTables,
  };
}

function buildSchemaContract(tableNames, columns, foreignKeys) {
  const tableColumns = {};
  for (const tableName of tableNames) tableColumns[tableName] = [];
  for (const column of columns) {
    if (tableColumns[column.table_name]) {
      tableColumns[column.table_name].push(column);
    }
  }

  return {
    canonical_tables: tableNames,
    table_columns: tableColumns,
    foreign_keys: foreignKeys,
  };
}

async function loadCanonicalContract(connection) {
  const baseTables = await listBaseTables(connection);
  const missingCoreTables = REQUIRED_CORE_TABLES.filter(
    (tableName) => !baseTables.includes(tableName)
  );
  if (missingCoreTables.length) {
    throw recoveryError(
      `The database is not ready for a full-system backup. Missing core tables: ${missingCoreTables.join(
        ", "
      )}.`,
      "BACKUP_CORE_SCHEMA_NOT_READY",
      503,
      { missingTables: missingCoreTables }
    );
  }

  const foreignKeys = await loadForeignKeyMetadata(connection, baseTables);
  const ordering = orderTablesByDependencies(baseTables, foreignKeys);
  const orderedTables = ordering.insertOrder;
  const columns = await loadColumnMetadata(connection, orderedTables);
  const schemaContract = buildSchemaContract(orderedTables, columns, foreignKeys);

  return {
    canonicalTables: orderedTables,
    restoreTables: orderedTables.filter(
      (tableName) => !NON_RESTORABLE_TABLES.has(tableName)
    ),
    insertOrder: ordering.insertOrder.filter(
      (tableName) => !NON_RESTORABLE_TABLES.has(tableName)
    ),
    deleteOrder: ordering.deleteOrder.filter(
      (tableName) => !NON_RESTORABLE_TABLES.has(tableName)
    ),
    cycleTables: ordering.cycleTables,
    columns,
    foreignKeys,
    schemaContract,
    schemaFingerprintSha256: stableSchemaFingerprint(schemaContract),
  };
}

async function getTableCounts(connection, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count FROM ${safeIdentifier(tableName)}`
    );
    counts[tableName] = Number(rows[0]?.total_count || 0);
  }
  return counts;
}

async function createFullSystemBackup(connection, { createdBy = null } = {}) {
  let transactionStarted = false;
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    transactionStarted = true;

    const contract = await loadCanonicalContract(connection);
    const tables = {};
    const tableCounts = {};

    for (const tableName of contract.canonicalTables) {
      const [rows] = await connection.query(
        `SELECT * FROM ${safeIdentifier(tableName)}`
      );
      tables[tableName] = rows;
      tableCounts[tableName] = rows.length;
    }

    await connection.commit();
    transactionStarted = false;

    const createdAt = new Date().toISOString();
    const backup = {
      app: "Chalin 03 Group Operations Platform",
      version: BACKUP_MANIFEST_VERSION,
      backup_id: crypto.randomUUID(),
      backup_type: "full_system_backup",
      created_at: createdAt,
      created_by: createdBy
        ? {
            id: Number(createdBy.id || 0) || null,
            username: createdBy.username || null,
            authority: createdBy.authority || "system_administrator",
          }
        : null,
      warning:
        "Sensitive full-system recovery package. It contains business records, password hashes, security evidence and protected configuration. Keep it private.",
      included_tables: contract.canonicalTables,
      skipped_tables: Array.from(LEGACY_ALIAS_TABLES).sort(),
      table_counts: tableCounts,
      total_record_count: Object.values(tableCounts).reduce(
        (total, count) => total + Number(count || 0),
        0
      ),
      schema_fingerprint_sha256: contract.schemaFingerprintSha256,
      tables,
    };

    backup.checksum_sha256 = stableBackupChecksum(backup);
    backup.manifest = {
      manifest_version: BACKUP_MANIFEST_VERSION,
      backup_id: backup.backup_id,
      created_at: createdAt,
      canonical_table_count: contract.canonicalTables.length,
      canonical_tables: contract.canonicalTables,
      non_restorable_tables: Array.from(NON_RESTORABLE_TABLES),
      dependency_cycle_tables: contract.cycleTables,
      schema_fingerprint_algorithm: "sha256",
      schema_fingerprint_sha256: contract.schemaFingerprintSha256,
      checksum_algorithm: "sha256",
      checksum_sha256: backup.checksum_sha256,
      table_counts: tableCounts,
    };

    return { backup, contract };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original backup failure.
      }
    }
    throw error;
  }
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
  if (!requester?.id) return false;
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

function validateTableRows(tableName, rows, errors) {
  if (!Array.isArray(rows)) {
    errors.push(`Backup table ${tableName} must be an array.`);
    return;
  }

  const seenIds = new Set();
  for (const row of rows) {
    if (!isPlainObject(row)) {
      errors.push(`Backup table ${tableName} contains an invalid row.`);
      return;
    }
    if (row.id !== undefined && row.id !== null) {
      const id = String(row.id);
      if (seenIds.has(id)) {
        errors.push(`Backup table ${tableName} contains duplicate id ${id}.`);
        return;
      }
      seenIds.add(id);
    }
  }
}

async function validateFullSystemBackup(
  connection,
  backup,
  { requester = null, requireRequesterPresence = false } = {}
) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(backup)) {
    return {
      valid: false,
      errors: ["Backup data must be a JSON object."],
      warnings,
      restoreTables: [],
      tablesToRestore: [],
    };
  }

  if (backup.backup_type !== "full_system_backup") {
    errors.push("Only a Chalin 03 full-system backup can be restored.");
  }
  if (backup.version !== BACKUP_MANIFEST_VERSION) {
    errors.push(
      `Backup manifest ${BACKUP_MANIFEST_VERSION} is required. Create a fresh backup from the current system before restoring.`
    );
  }
  if (!isPlainObject(backup.tables)) {
    errors.push("Backup tables must be a JSON object.");
  }
  if (!isPlainObject(backup.manifest)) {
    errors.push("Backup manifest metadata is missing.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(backup.checksum_sha256 || ""))) {
    errors.push("A valid SHA-256 backup checksum is required.");
  }

  const contract = await loadCanonicalContract(connection);
  const backupTableNames = isPlainObject(backup.tables)
    ? Object.keys(backup.tables).filter(isSafeIdentifier)
    : [];
  const includedTables = Array.isArray(backup.included_tables)
    ? backup.included_tables.filter(isSafeIdentifier)
    : [];
  const manifestTables = Array.isArray(backup.manifest?.canonical_tables)
    ? backup.manifest.canonical_tables.filter(isSafeIdentifier)
    : [];

  const missingTables = contract.canonicalTables.filter(
    (tableName) => !Array.isArray(backup.tables?.[tableName])
  );
  const unsupportedTables = backupTableNames.filter(
    (tableName) => !contract.canonicalTables.includes(tableName)
  );

  if (missingTables.length) {
    errors.push(
      `The backup is incomplete and cannot replace the current database. Missing current tables: ${missingTables.join(
        ", "
      )}.`
    );
  }
  if (unsupportedTables.length) {
    errors.push(
      `The backup belongs to a different or newer schema. Unsupported tables: ${unsupportedTables.join(
        ", "
      )}.`
    );
  }
  if (!arraysEqual(includedTables, contract.canonicalTables)) {
    errors.push("Backup included_tables does not match the current canonical table contract.");
  }
  if (!arraysEqual(manifestTables, contract.canonicalTables)) {
    errors.push("Backup manifest table contract does not match the current database.");
  }
  if (
    String(backup.schema_fingerprint_sha256 || "") !==
      contract.schemaFingerprintSha256 ||
    String(backup.manifest?.schema_fingerprint_sha256 || "") !==
      contract.schemaFingerprintSha256
  ) {
    errors.push(
      "Backup schema fingerprint does not match the current production schema. Create a fresh backup after all approved migrations."
    );
  }

  const tableCounts = isPlainObject(backup.table_counts)
    ? backup.table_counts
    : {};
  let calculatedTotal = 0;
  for (const tableName of backupTableNames) {
    const rows = backup.tables[tableName];
    validateTableRows(tableName, rows, errors);
    if (Array.isArray(rows)) {
      calculatedTotal += rows.length;
      if (Number(tableCounts[tableName]) !== rows.length) {
        errors.push(`Backup row count does not match for ${tableName}.`);
      }
    }
  }
  if (Number(backup.total_record_count) !== calculatedTotal) {
    errors.push("Backup total record count does not match its table contents.");
  }

  if (!configuredOwnerPresent(backup)) {
    errors.push(
      "The backup does not contain the permanently protected original System Administrator."
    );
  }
  if (requireRequesterPresence && !requesterPresent(backup, requester)) {
    errors.push(
      "A delegated restore requires the same active Administrator account to exist in the backup. The original owner can perform controlled recovery when this is not possible."
    );
  }

  if (/^[a-f0-9]{64}$/i.test(String(backup.checksum_sha256 || ""))) {
    const actualChecksum = stableBackupChecksum(backup);
    if (actualChecksum !== backup.checksum_sha256) {
      errors.push("Backup checksum does not match the backup contents.");
    }
    if (backup.manifest?.checksum_sha256 !== backup.checksum_sha256) {
      errors.push("Backup manifest checksum does not match the package checksum.");
    }
  }

  if (contract.cycleTables.length) {
    warnings.push(
      `The current schema contains cyclic or self-referencing table dependencies: ${contract.cycleTables.join(
        ", "
      )}. Foreign-key reconciliation will be required before commit.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    contract,
    restoreTables: contract.restoreTables,
    tablesToRestore: contract.insertOrder,
    insertOrder: contract.insertOrder,
    deleteOrder: contract.deleteOrder,
    missingTables,
    unsupportedTables,
    checksumSha256: backup.checksum_sha256 || null,
    previewCounts: Object.fromEntries(
      contract.restoreTables.map((tableName) => [
        tableName,
        Array.isArray(backup.tables?.[tableName])
          ? backup.tables[tableName].length
          : null,
      ])
    ),
  };
}

async function getInsertableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );
  return rows
    .filter((row) => !/GENERATED/i.test(String(row.EXTRA || "")))
    .map((row) => row.COLUMN_NAME)
    .filter(isSafeIdentifier);
}

function normalizeRestoreValue(value) {
  if (value === undefined) return null;
  if (
    isPlainObject(value) &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return value;
}

async function insertTableRows(connection, tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const insertableColumns = await getInsertableColumns(connection, tableName);
  const firstRow = rows[0];
  const columns = insertableColumns.filter((column) =>
    Object.prototype.hasOwnProperty.call(firstRow, column)
  );
  if (!columns.length) {
    throw recoveryError(
      `Backup table ${tableName} has no insertable columns.`,
      "BACKUP_TABLE_COLUMNS_INVALID",
      400
    );
  }

  const sql = `INSERT INTO ${safeIdentifier(tableName)} (${columns
    .map(safeIdentifier)
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;

  for (const row of rows) {
    await connection.query(
      sql,
      columns.map((column) => normalizeRestoreValue(row[column]))
    );
  }
}

function groupForeignKeys(foreignKeys) {
  const groups = new Map();
  for (const foreignKey of foreignKeys) {
    const key = `${foreignKey.child_table}:${foreignKey.constraint_name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        constraintName: foreignKey.constraint_name,
        childTable: foreignKey.child_table,
        parentTable: foreignKey.parent_table,
        columns: [],
      });
    }
    groups.get(key).columns.push({
      child: foreignKey.child_column,
      parent: foreignKey.parent_column,
      ordinal: foreignKey.ordinal_position,
    });
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    columns: group.columns.sort((a, b) => a.ordinal - b.ordinal),
  }));
}

async function findForeignKeyOrphans(connection, contract) {
  const restoreSet = new Set(contract.restoreTables);
  const orphanReports = [];

  for (const group of groupForeignKeys(contract.foreignKeys)) {
    if (
      !restoreSet.has(group.childTable) ||
      !restoreSet.has(group.parentTable)
    ) {
      continue;
    }
    const joinClause = group.columns
      .map(
        ({ child, parent }) =>
          `parent_row.${safeIdentifier(parent)} = child_row.${safeIdentifier(child)}`
      )
      .join(" AND ");
    const childNotNull = group.columns
      .map(({ child }) => `child_row.${safeIdentifier(child)} IS NOT NULL`)
      .join(" AND ");
    const parentMissing = `parent_row.${safeIdentifier(
      group.columns[0].parent
    )} IS NULL`;
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS orphan_count
       FROM ${safeIdentifier(group.childTable)} child_row
       LEFT JOIN ${safeIdentifier(group.parentTable)} parent_row
         ON ${joinClause}
       WHERE ${childNotNull}
         AND ${parentMissing}`
    );
    const orphanCount = Number(rows[0]?.orphan_count || 0);
    if (orphanCount > 0) {
      orphanReports.push({
        constraint_name: group.constraintName,
        child_table: group.childTable,
        parent_table: group.parentTable,
        orphan_count: orphanCount,
      });
    }
  }

  return orphanReports;
}

async function invalidateRestoredSecurityState(connection, contract) {
  const tables = new Set(contract.canonicalTables);
  const counts = {};

  async function updateIfPresent(tableName, sql, params = []) {
    if (!tables.has(tableName)) return;
    const [result] = await connection.query(sql, params);
    counts[tableName] = Number(result.affectedRows || 0);
  }

  await updateIfPresent(
    "users",
    `UPDATE users
     SET token_version = COALESCE(token_version, 0) + 1`
  );
  await updateIfPresent(
    "auth_sessions",
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
         revocation_reason = COALESCE(revocation_reason, 'full_system_restore')`
  );
  await updateIfPresent(
    "protected_action_sessions",
    `UPDATE protected_action_sessions
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())`
  );
  await updateIfPresent(
    "owner_recovery_sessions",
    `UPDATE owner_recovery_sessions
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())`
  );
  await updateIfPresent(
    "owner_break_glass_mfa_enrollments",
    `UPDATE owner_break_glass_mfa_enrollments
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())`
  );
  await updateIfPresent(
    "password_recovery_otps",
    `UPDATE password_recovery_otps
     SET invalidated_at = COALESCE(invalidated_at, UTC_TIMESTAMP()),
         invalidation_reason = COALESCE(invalidation_reason, 'full_system_restore')`
  );
  await updateIfPresent(
    "passkey_challenges",
    `UPDATE passkey_challenges
     SET used_at = COALESCE(used_at, UTC_TIMESTAMP())`
  );
  await updateIfPresent(
    "user_passkeys",
    `UPDATE user_passkeys
     SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
         revoked_reason = COALESCE(revoked_reason, 'full_system_restore')`
  );

  if (tables.has("passkey_security_state")) {
    await connection.query(
      `INSERT INTO passkey_security_state (state_key, state_value)
       VALUES (?, 2)
       ON DUPLICATE KEY UPDATE
         state_value = state_value + 1,
         updated_at = UTC_TIMESTAMP()`,
      [GENERATION_KEY]
    );
  }
  if (tables.has("passkey_security_events")) {
    await connection.query(
      `INSERT INTO passkey_security_events
         (event_type, affected_count, details)
       VALUES ('full_system_restore_device_reset', ?, ?)`,
      [
        Number(counts.user_passkeys || 0),
        "All restored fingerprint and face credentials were revoked after full-system recovery. Users must sign in with passwords and enroll this device again.",
      ]
    );
  }

  return counts;
}

async function verifyRestoredCounts(connection, backup, tableNames) {
  const actualCounts = await getTableCounts(connection, tableNames);
  const mismatches = [];
  for (const tableName of tableNames) {
    const expected = Number(backup.table_counts?.[tableName] || 0);
    const actual = Number(actualCounts[tableName] || 0);
    if (expected !== actual) {
      mismatches.push({ table_name: tableName, expected, actual });
    }
  }
  return { actualCounts, mismatches };
}

async function restoreFullSystemBackup(
  connection,
  backup,
  validation,
  { writeRestoreAudit = null } = {}
) {
  if (!validation?.valid) {
    throw recoveryError(
      "Backup validation must pass before restore begins.",
      "BACKUP_VALIDATION_REQUIRED",
      400
    );
  }

  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of validation.deleteOrder) {
      await connection.query(`DELETE FROM ${safeIdentifier(tableName)}`);
    }
    for (const tableName of validation.insertOrder) {
      await insertTableRows(connection, tableName, backup.tables[tableName]);
    }

    const countVerification = await verifyRestoredCounts(
      connection,
      backup,
      validation.restoreTables
    );
    if (countVerification.mismatches.length) {
      throw recoveryError(
        "Restored row counts do not match the backup. The restore was rolled back.",
        "RESTORE_ROW_COUNT_MISMATCH",
        500,
        { countMismatches: countVerification.mismatches }
      );
    }

    const orphanReports = await findForeignKeyOrphans(
      connection,
      validation.contract
    );
    if (orphanReports.length) {
      throw recoveryError(
        "Foreign-key reconciliation failed. The restore was rolled back.",
        "RESTORE_FOREIGN_KEY_RECONCILIATION_FAILED",
        500,
        { orphanReports }
      );
    }

    const securityInvalidation = await invalidateRestoredSecurityState(
      connection,
      validation.contract
    );

    if (typeof writeRestoreAudit === "function") {
      await writeRestoreAudit(connection, {
        restoredTables: validation.restoreTables,
        restoredTableCounts: countVerification.actualCounts,
        securityInvalidation,
      });
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();
    transactionStarted = false;

    return {
      restoredTables: validation.restoreTables,
      restoredTableCounts: countVerification.actualCounts,
      securityInvalidation,
      orphanReports: [],
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original restore error.
      }
    }
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // The connection is released by the route.
    }
    throw error;
  }
}

async function recordBackupHistory(
  connection,
  {
    backup,
    userId = null,
    status = "created",
    verificationStatus = "not_verified",
    verificationMessage = null,
    verifiedBy = null,
  }
) {
  const tables = await listBaseTables(connection);
  if (!tables.includes("backup_history")) return;

  await connection.query(
    `INSERT INTO backup_history (
       backup_id, scope_code, category_code, manifest_version,
       schema_version, included_table_count, total_record_count,
       package_checksum_sha256, status, verification_status,
       verification_message, created_by, created_at, verified_by, verified_at
     ) VALUES (?, 'full_system', 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       verification_status = VALUES(verification_status),
       verification_message = VALUES(verification_message),
       verified_by = VALUES(verified_by),
       verified_at = VALUES(verified_at),
       package_checksum_sha256 = VALUES(package_checksum_sha256)`,
    [
      backup.backup_id,
      BACKUP_MANIFEST_VERSION,
      backup.schema_fingerprint_sha256 || null,
      Number(backup.included_tables?.length || 0),
      Number(backup.total_record_count || 0),
      backup.checksum_sha256 || null,
      status,
      verificationStatus,
      verificationMessage,
      userId,
      backup.created_at ? new Date(backup.created_at) : new Date(),
      verifiedBy,
      verifiedBy ? new Date() : null,
    ]
  );
}

module.exports = {
  BACKUP_MANIFEST_VERSION,
  LEGACY_ALIAS_TABLES,
  NON_RESTORABLE_TABLES,
  arraysEqual,
  createFullSystemBackup,
  findForeignKeyOrphans,
  invalidateRestoredSecurityState,
  isSafeIdentifier,
  loadCanonicalContract,
  normalizeRestoreValue,
  orderTablesByDependencies,
  recordBackupHistory,
  restoreFullSystemBackup,
  safeIdentifier,
  stableBackupChecksum,
  stableSchemaFingerprint,
  validateFullSystemBackup,
};
