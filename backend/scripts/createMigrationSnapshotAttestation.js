const {
  parseTimestamp,
  snapshotAttestationChecksum,
} = require("../services/migrationBackupAttestationService");

function cleanText(value, maxLength = 180) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createSnapshotAttestation(reference, createdAtValue) {
  const normalizedReference = cleanText(reference, 180);
  const createdAt = parseTimestamp(createdAtValue);
  if (!/^[-A-Za-z0-9_.:/]{6,180}$/.test(normalizedReference)) {
    throw new Error(
      "Enter the exact Railway snapshot reference using letters, numbers, dash, underscore, dot, colon or slash."
    );
  }
  if (!createdAt) {
    throw new Error(
      "Enter the Railway snapshot creation time in ISO-8601 format, for example 2026-07-23T12:30:00.000Z."
    );
  }

  return {
    MIGRATION_BACKUP_SOURCE: "railway_snapshot",
    MIGRATION_BACKUP_REFERENCE: normalizedReference,
    MIGRATION_BACKUP_CREATED_AT: createdAt.toISOString(),
    MIGRATION_BACKUP_SHA256: snapshotAttestationChecksum(
      normalizedReference,
      createdAt
    ),
  };
}

function main(argv = process.argv.slice(2)) {
  const [reference, createdAt] = argv;
  const result = createSnapshotAttestation(reference, createdAt);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createSnapshotAttestation,
  main,
};
