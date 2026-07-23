const crypto = require("crypto");

const { BACKUP_MANIFEST_VERSION } = require("../config/version");
const { loadCanonicalContract } = require("./fullSystemBackupService");

const ALLOWED_SOURCES = new Set([
  "chalin03_verified_backup",
  "chalin03_prerelease_backup",
  "railway_snapshot",
]);
const DEFAULT_MAX_AGE_HOURS = 24;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const PRERELEASE_MANIFEST_VERSION = "chalin03-equipment-sales-foundation-v1";
const PRERELEASE_REFERENCE_PATTERN =
  /^chalin03-prerelease-v1:([a-f0-9]{16}):([1-9][0-9]{1,3}):([0-9]{1,12})$/;

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function attestationError(message, code, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

function parseTimestamp(value) {
  const date = new Date(cleanText(value, 80));
  return Number.isNaN(date.getTime()) ? null : date;
}

function maxAgeHours() {
  const configured = Number(process.env.MIGRATION_BACKUP_MAX_AGE_HOURS || 0);
  return Number.isFinite(configured) && configured >= 1 && configured <= 168
    ? configured
    : DEFAULT_MAX_AGE_HOURS;
}

function assertFreshTimestamp(date, label) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw attestationError(
      `${label} is invalid.`,
      "MIGRATION_BACKUP_TIMESTAMP_INVALID"
    );
  }
  const ageMs = Date.now() - date.getTime();
  const maxAgeMs = maxAgeHours() * 60 * 60 * 1000;
  if (ageMs < -CLOCK_TOLERANCE_MS || ageMs > maxAgeMs) {
    throw attestationError(
      `${label} is outside the approved ${maxAgeHours()}-hour change window.`,
      "MIGRATION_BACKUP_STALE",
      {
        backupCreatedAt: date.toISOString(),
        maxAgeHours: maxAgeHours(),
      }
    );
  }
}

function snapshotAttestationChecksum(reference, createdAt) {
  const timestamp =
    createdAt instanceof Date ? createdAt.toISOString() : parseTimestamp(createdAt)?.toISOString();
  if (!timestamp) {
    throw attestationError(
      "Railway snapshot timestamp is invalid.",
      "MIGRATION_BACKUP_TIMESTAMP_INVALID"
    );
  }
  return crypto
    .createHash("sha256")
    .update(`railway_snapshot:${cleanText(reference, 180)}:${timestamp}`)
    .digest("hex");
}

function readProductionAttestationEnvironment(entry) {
  const production =
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  if (!production || !entry?.backupRequired || entry?.mode !== "sql") {
    return {
      required: false,
      source: null,
      checksum: null,
      reference: null,
      createdAt: null,
      approvedBy: cleanText(process.env.MIGRATION_APPROVED_BY, 180) || null,
      changeTicket: cleanText(process.env.MIGRATION_CHANGE_TICKET, 180) || null,
    };
  }

  const source = cleanText(process.env.MIGRATION_BACKUP_SOURCE, 40).toLowerCase();
  const checksum = cleanText(process.env.MIGRATION_BACKUP_SHA256, 64).toLowerCase();
  const reference = cleanText(process.env.MIGRATION_BACKUP_REFERENCE, 180);
  const createdAt = parseTimestamp(process.env.MIGRATION_BACKUP_CREATED_AT);
  const approvedBy = cleanText(process.env.MIGRATION_APPROVED_BY, 180);
  const changeTicket = cleanText(process.env.MIGRATION_CHANGE_TICKET, 180);

  if (!ALLOWED_SOURCES.has(source)) {
    throw attestationError(
      `Production migration ${entry.name} requires MIGRATION_BACKUP_SOURCE=chalin03_verified_backup, chalin03_prerelease_backup or railway_snapshot.`,
      "MIGRATION_BACKUP_SOURCE_REQUIRED"
    );
  }
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw attestationError(
      `Production migration ${entry.name} requires a valid MIGRATION_BACKUP_SHA256.`,
      "MIGRATION_BACKUP_CHECKSUM_REQUIRED"
    );
  }
  if (!reference) {
    throw attestationError(
      `Production migration ${entry.name} requires MIGRATION_BACKUP_REFERENCE.`,
      "MIGRATION_BACKUP_REFERENCE_REQUIRED"
    );
  }
  if (!createdAt) {
    throw attestationError(
      `Production migration ${entry.name} requires a valid MIGRATION_BACKUP_CREATED_AT.`,
      "MIGRATION_BACKUP_TIMESTAMP_REQUIRED"
    );
  }
  if (!approvedBy) {
    throw attestationError(
      `Production migration ${entry.name} requires MIGRATION_APPROVED_BY.`,
      "MIGRATION_APPROVER_REQUIRED"
    );
  }
  if (!changeTicket) {
    throw attestationError(
      `Production migration ${entry.name} requires MIGRATION_CHANGE_TICKET.`,
      "MIGRATION_CHANGE_TICKET_REQUIRED"
    );
  }

  assertFreshTimestamp(createdAt, "Migration backup evidence");

  return {
    required: true,
    source,
    checksum,
    reference,
    createdAt,
    approvedBy,
    changeTicket,
  };
}

async function verifyChalin03Backup(connection, attestation) {
  const [rows] = await connection.query(
    `SELECT
       backup_id,
       manifest_version,
       schema_version,
       package_checksum_sha256,
       status,
       verification_status,
       created_at,
       verified_at
     FROM backup_history
     WHERE backup_id = ?
       AND package_checksum_sha256 = ?
     LIMIT 1`,
    [attestation.reference, attestation.checksum]
  );
  const record = rows[0];
  if (!record) {
    throw attestationError(
      "The supplied Chalin 03 backup is not recorded in backup_history with this checksum.",
      "MIGRATION_BACKUP_HISTORY_NOT_FOUND"
    );
  }
  if (record.manifest_version !== BACKUP_MANIFEST_VERSION) {
    throw attestationError(
      `The recorded backup uses ${record.manifest_version}; ${BACKUP_MANIFEST_VERSION} is required.`,
      "MIGRATION_BACKUP_MANIFEST_MISMATCH"
    );
  }
  if (String(record.status || "").toLowerCase() !== "validated") {
    throw attestationError(
      "The recorded Chalin 03 backup has not completed protected validation.",
      "MIGRATION_BACKUP_STATUS_INVALID"
    );
  }
  if (String(record.verification_status || "").toLowerCase() !== "verified") {
    throw attestationError(
      "The recorded Chalin 03 backup has not passed protected dry-run verification.",
      "MIGRATION_BACKUP_NOT_VERIFIED"
    );
  }
  if (!record.verified_at) {
    throw attestationError(
      "The recorded Chalin 03 backup does not contain verification evidence.",
      "MIGRATION_BACKUP_VERIFICATION_EVIDENCE_MISSING"
    );
  }

  const recordedCreatedAt = parseTimestamp(record.created_at);
  const recordedVerifiedAt = parseTimestamp(record.verified_at);
  assertFreshTimestamp(recordedCreatedAt, "Recorded Chalin 03 backup");
  assertFreshTimestamp(recordedVerifiedAt, "Recorded Chalin 03 verification");
  if (
    Math.abs(recordedCreatedAt.getTime() - attestation.createdAt.getTime()) >
    CLOCK_TOLERANCE_MS
  ) {
    throw attestationError(
      "MIGRATION_BACKUP_CREATED_AT does not match the recorded Chalin 03 backup.",
      "MIGRATION_BACKUP_TIMESTAMP_MISMATCH"
    );
  }
  if (recordedVerifiedAt.getTime() + CLOCK_TOLERANCE_MS < recordedCreatedAt.getTime()) {
    throw attestationError(
      "The backup verification timestamp predates the backup package.",
      "MIGRATION_BACKUP_VERIFICATION_TIMESTAMP_INVALID"
    );
  }

  const contract = await loadCanonicalContract(connection);
  if (record.schema_version !== contract.schemaFingerprintSha256) {
    throw attestationError(
      "The verified backup was created for a different database schema fingerprint.",
      "MIGRATION_BACKUP_SCHEMA_MISMATCH",
      {
        recordedSchemaFingerprint: record.schema_version,
        currentSchemaFingerprint: contract.schemaFingerprintSha256,
      }
    );
  }

  return {
    source: attestation.source,
    checksum: attestation.checksum,
    reference: record.backup_id,
    createdAt: recordedCreatedAt,
    verifiedAt: recordedVerifiedAt,
    schemaFingerprintSha256: record.schema_version,
  };
}

async function verifyPrereleaseBackup(attestation) {
  const match = PRERELEASE_REFERENCE_PATTERN.exec(attestation.reference);
  if (!match) {
    throw attestationError(
      "The pre-release Chalin 03 backup reference is invalid.",
      "MIGRATION_PRERELEASE_BACKUP_REFERENCE_INVALID"
    );
  }

  const [, checksumPrefix, tableCountText, recordCountText] = match;
  const tableCount = Number(tableCountText);
  const recordCount = Number(recordCountText);

  if (checksumPrefix !== attestation.checksum.slice(0, 16)) {
    throw attestationError(
      "The pre-release backup reference is not bound to the supplied package checksum.",
      "MIGRATION_PRERELEASE_BACKUP_CHECKSUM_MISMATCH"
    );
  }
  if (!Number.isInteger(tableCount) || tableCount < 100) {
    throw attestationError(
      "The pre-release backup does not attest a complete full-system table set.",
      "MIGRATION_PRERELEASE_BACKUP_TABLE_COUNT_INVALID"
    );
  }
  if (!Number.isInteger(recordCount) || recordCount < 1) {
    throw attestationError(
      "The pre-release backup does not attest any recoverable records.",
      "MIGRATION_PRERELEASE_BACKUP_RECORD_COUNT_INVALID"
    );
  }

  return {
    source: attestation.source,
    checksum: attestation.checksum,
    reference: attestation.reference,
    createdAt: attestation.createdAt,
    verifiedAt: attestation.createdAt,
    schemaFingerprintSha256: null,
    prereleaseManifestVersion: PRERELEASE_MANIFEST_VERSION,
    canonicalTableCount: tableCount,
    totalRecordCount: recordCount,
  };
}

async function verifyRailwaySnapshot(attestation) {
  if (!/^[-A-Za-z0-9_.:/]{6,180}$/.test(attestation.reference)) {
    throw attestationError(
      "Railway snapshot reference contains unsupported characters or is too short.",
      "MIGRATION_RAILWAY_SNAPSHOT_REFERENCE_INVALID"
    );
  }

  const expectedChecksum = snapshotAttestationChecksum(
    attestation.reference,
    attestation.createdAt
  );
  if (attestation.checksum !== expectedChecksum) {
    throw attestationError(
      "MIGRATION_BACKUP_SHA256 is not bound to the supplied Railway snapshot reference and timestamp.",
      "MIGRATION_RAILWAY_SNAPSHOT_CHECKSUM_MISMATCH",
      { expectedChecksum }
    );
  }

  return {
    source: attestation.source,
    checksum: attestation.checksum,
    reference: attestation.reference,
    createdAt: attestation.createdAt,
    verifiedAt: null,
    schemaFingerprintSha256: null,
  };
}

async function verifyProductionBackupAttestation(connection, entry) {
  const attestation = readProductionAttestationEnvironment(entry);
  if (!attestation.required) {
    return {
      required: false,
      backupAttestation: null,
      backupSource: null,
      backupReference: null,
      backupCreatedAt: null,
      approvedBy: attestation.approvedBy,
      changeTicket: attestation.changeTicket,
    };
  }

  let evidence;
  if (attestation.source === "chalin03_verified_backup") {
    evidence = await verifyChalin03Backup(connection, attestation);
  } else if (attestation.source === "chalin03_prerelease_backup") {
    evidence = await verifyPrereleaseBackup(attestation);
  } else {
    evidence = await verifyRailwaySnapshot(attestation);
  }

  return {
    required: true,
    backupAttestation: evidence.checksum,
    backupSource: evidence.source,
    backupReference: evidence.reference,
    backupCreatedAt: evidence.createdAt,
    backupVerifiedAt: evidence.verifiedAt,
    backupSchemaFingerprintSha256: evidence.schemaFingerprintSha256,
    approvedBy: attestation.approvedBy,
    changeTicket: attestation.changeTicket,
  };
}

module.exports = {
  ALLOWED_SOURCES,
  CLOCK_TOLERANCE_MS,
  DEFAULT_MAX_AGE_HOURS,
  PRERELEASE_MANIFEST_VERSION,
  PRERELEASE_REFERENCE_PATTERN,
  assertFreshTimestamp,
  maxAgeHours,
  parseTimestamp,
  readProductionAttestationEnvironment,
  snapshotAttestationChecksum,
  verifyPrereleaseBackup,
  verifyProductionBackupAttestation,
};
