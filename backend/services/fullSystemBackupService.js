const core = require("./fullSystemBackupCoreService");

const SCHEMA_CONTRACT_VERSION =
  "tables-columns-foreign-keys-indexes-triggers-v1";

function sortedTableNames(tableNames) {
  return Array.from(new Set(tableNames || [])).sort((left, right) =>
    left.localeCompare(right)
  );
}

async function loadIndexMetadata(connection, tableNames) {
  const tables = sortedTableNames(tableNames);
  if (!tables.length) return [];

  const [rows] = await connection.query(
    `SELECT
       TABLE_NAME,
       INDEX_NAME,
       NON_UNIQUE,
       SEQ_IN_INDEX,
       COLUMN_NAME,
       COLLATION,
       SUB_PART,
       INDEX_TYPE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tables.map(() => "?").join(", ")})
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    tables
  );

  return rows.map((row) => ({
    table_name: row.TABLE_NAME,
    index_name: row.INDEX_NAME,
    non_unique: Number(row.NON_UNIQUE || 0),
    sequence: Number(row.SEQ_IN_INDEX || 0),
    column_name: row.COLUMN_NAME || null,
    collation: row.COLLATION || null,
    sub_part: row.SUB_PART === null ? null : Number(row.SUB_PART || 0),
    index_type: row.INDEX_TYPE || null,
  }));
}

function normalizeTriggerStatement(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

async function loadTriggerMetadata(connection, tableNames) {
  const tables = sortedTableNames(tableNames);
  if (!tables.length) return [];

  const [rows] = await connection.query(
    `SELECT
       TRIGGER_NAME,
       EVENT_MANIPULATION,
       EVENT_OBJECT_TABLE,
       ACTION_TIMING,
       ACTION_ORIENTATION,
       ACTION_STATEMENT
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND EVENT_OBJECT_TABLE IN (${tables.map(() => "?").join(", ")})
     ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`,
    tables
  );

  return rows.map((row) => ({
    trigger_name: row.TRIGGER_NAME,
    event: row.EVENT_MANIPULATION,
    table_name: row.EVENT_OBJECT_TABLE,
    timing: row.ACTION_TIMING,
    orientation: row.ACTION_ORIENTATION,
    statement: normalizeTriggerStatement(row.ACTION_STATEMENT),
  }));
}

async function loadCanonicalContract(connection) {
  const baseContract = await core.loadCanonicalContract(connection);
  const indexes = await loadIndexMetadata(
    connection,
    baseContract.canonicalTables
  );
  const triggers = await loadTriggerMetadata(
    connection,
    baseContract.canonicalTables
  );
  const schemaContract = {
    ...baseContract.schemaContract,
    contract_version: SCHEMA_CONTRACT_VERSION,
    indexes,
    triggers,
  };

  return {
    ...baseContract,
    coreSchemaFingerprintSha256: baseContract.schemaFingerprintSha256,
    indexes,
    triggers,
    schemaContract,
    schemaFingerprintSha256: core.stableSchemaFingerprint(schemaContract),
  };
}

function applyEnhancedManifest(backup, contract) {
  backup.schema_fingerprint_sha256 = contract.schemaFingerprintSha256;
  backup.manifest = {
    ...backup.manifest,
    schema_contract_version: SCHEMA_CONTRACT_VERSION,
    schema_fingerprint_sha256: contract.schemaFingerprintSha256,
    schema_index_entry_count: contract.indexes.length,
    schema_trigger_count: contract.triggers.length,
  };
  backup.checksum_sha256 = core.stableBackupChecksum(backup);
  backup.manifest.checksum_sha256 = backup.checksum_sha256;
  return backup;
}

async function createFullSystemBackup(connection, options = {}) {
  const result = await core.createFullSystemBackup(connection, options);
  const contract = await loadCanonicalContract(connection);

  if (
    result.contract.schemaFingerprintSha256 !==
    contract.coreSchemaFingerprintSha256
  ) {
    const error = new Error(
      "The database schema changed while the full-system backup was being created. Retry after schema changes finish."
    );
    error.code = "BACKUP_SCHEMA_CHANGED_DURING_SNAPSHOT";
    error.statusCode = 503;
    throw error;
  }

  return {
    backup: applyEnhancedManifest(result.backup, contract),
    contract,
  };
}

function cloneForCoreValidation(backup, contract) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    return backup;
  }

  const clone = {
    ...backup,
    manifest:
      backup.manifest && typeof backup.manifest === "object"
        ? { ...backup.manifest }
        : backup.manifest,
    schema_fingerprint_sha256: contract.coreSchemaFingerprintSha256,
  };

  if (clone.manifest && typeof clone.manifest === "object") {
    clone.manifest.schema_fingerprint_sha256 =
      contract.coreSchemaFingerprintSha256;
  }
  clone.checksum_sha256 = core.stableBackupChecksum(clone);
  if (clone.manifest && typeof clone.manifest === "object") {
    clone.manifest.checksum_sha256 = clone.checksum_sha256;
  }

  return clone;
}

function enhancedValidationErrors(backup, contract) {
  const errors = [];
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    return errors;
  }

  if (
    String(backup.schema_fingerprint_sha256 || "") !==
      contract.schemaFingerprintSha256 ||
    String(backup.manifest?.schema_fingerprint_sha256 || "") !==
      contract.schemaFingerprintSha256
  ) {
    errors.push(
      "Backup schema fingerprint does not match the current table, column, foreign-key, index and trigger contract."
    );
  }
  if (
    String(backup.manifest?.schema_contract_version || "") !==
    SCHEMA_CONTRACT_VERSION
  ) {
    errors.push(
      `Backup schema contract ${SCHEMA_CONTRACT_VERSION} is required.`
    );
  }
  if (
    Number(backup.manifest?.schema_index_entry_count) !==
    contract.indexes.length
  ) {
    errors.push("Backup index-contract count does not match the current schema.");
  }
  if (
    Number(backup.manifest?.schema_trigger_count) !== contract.triggers.length
  ) {
    errors.push("Backup trigger-contract count does not match the current schema.");
  }
  if (
    /^[a-f0-9]{64}$/i.test(String(backup.checksum_sha256 || "")) &&
    core.stableBackupChecksum(backup) !== backup.checksum_sha256
  ) {
    errors.push("Backup checksum does not match the enhanced recovery package.");
  }

  return errors;
}

async function validateFullSystemBackup(connection, backup, options = {}) {
  const contract = await loadCanonicalContract(connection);
  const enhancedErrors = enhancedValidationErrors(backup, contract);
  const coreBackup = cloneForCoreValidation(backup, contract);
  const validation = await core.validateFullSystemBackup(
    connection,
    coreBackup,
    options
  );

  return {
    ...validation,
    valid: validation.valid && enhancedErrors.length === 0,
    errors: [...validation.errors, ...enhancedErrors],
    contract,
    checksumSha256: backup?.checksum_sha256 || null,
  };
}

module.exports = {
  ...core,
  SCHEMA_CONTRACT_VERSION,
  createFullSystemBackup,
  loadCanonicalContract,
  loadIndexMetadata,
  loadTriggerMetadata,
  normalizeTriggerStatement,
  validateFullSystemBackup,
};
