const assert = require("node:assert/strict");
const test = require("node:test");

const { BACKUP_MANIFEST_VERSION } = require("../config/version");
const { loadCanonicalContract } = require("../services/fullSystemBackupService");
const {
  readProductionAttestationEnvironment,
  snapshotAttestationChecksum,
  verifyProductionBackupAttestation,
} = require("../services/migrationBackupAttestationService");

const ENV_KEYS = [
  "NODE_ENV",
  "MIGRATION_BACKUP_SOURCE",
  "MIGRATION_BACKUP_SHA256",
  "MIGRATION_BACKUP_REFERENCE",
  "MIGRATION_BACKUP_CREATED_AT",
  "MIGRATION_BACKUP_MAX_AGE_HOURS",
  "MIGRATION_APPROVED_BY",
  "MIGRATION_CHANGE_TICKET",
];

function withEnvironment(values, work) {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(work)
    .finally(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function productionEntry() {
  return {
    name: "20260723_release31_database_safety_guards",
    mode: "sql",
    backupRequired: true,
  };
}

function fakeSchemaConnection(recordHolder) {
  const tableNames = ["backup_history", "branches", "schema_migrations", "users"];
  const columns = {
    backup_history: ["id", "backup_id", "schema_version", "package_checksum_sha256"],
    branches: ["id", "code", "branch_code", "name", "is_active"],
    schema_migrations: ["id", "migration_name", "applied_at", "description"],
    users: ["id", "username", "password_hash", "role", "is_active", "token_version"],
  };

  return {
    async query(sql) {
      if (/FROM backup_history/i.test(sql)) {
        return [[recordHolder.record].filter(Boolean)];
      }
      if (/information_schema\.TABLES/i.test(sql)) {
        return [tableNames.map((TABLE_NAME) => ({ TABLE_NAME }))];
      }
      if (/information_schema\.KEY_COLUMN_USAGE/i.test(sql)) {
        return [[]];
      }
      if (/information_schema\.COLUMNS/i.test(sql)) {
        const rows = [];
        for (const tableName of tableNames) {
          columns[tableName].forEach((columnName, index) => {
            rows.push({
              TABLE_NAME: tableName,
              COLUMN_NAME: columnName,
              ORDINAL_POSITION: index + 1,
              COLUMN_TYPE: columnName === "id" ? "bigint" : "varchar(255)",
              IS_NULLABLE: columnName === "id" ? "NO" : "YES",
              COLUMN_DEFAULT: null,
              COLUMN_KEY: columnName === "id" ? "PRI" : "",
              EXTRA: columnName === "id" ? "auto_increment" : "",
            });
          });
        }
        return [rows];
      }
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return [
          tableNames.map((TABLE_NAME) => ({
            TABLE_NAME,
            INDEX_NAME: "PRIMARY",
            NON_UNIQUE: 0,
            SEQ_IN_INDEX: 1,
            COLUMN_NAME: "id",
            COLLATION: "A",
            SUB_PART: null,
            INDEX_TYPE: "BTREE",
          })),
        ];
      }
      if (/information_schema\.TRIGGERS/i.test(sql)) {
        return [[]];
      }
      throw new Error(`Unexpected fake query: ${sql}`);
    },
  };
}

test("Railway snapshot checksum is deterministic and bound to exact evidence", () => {
  const reference = "railway-snapshot-release31-001";
  const createdAt = new Date("2026-07-23T12:30:00.000Z");
  const first = snapshotAttestationChecksum(reference, createdAt);
  const second = snapshotAttestationChecksum(reference, createdAt.toISOString());
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    first,
    snapshotAttestationChecksum(`${reference}-changed`, createdAt)
  );
});

test("stale migration evidence is rejected before database access", async () => {
  const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const reference = "railway-snapshot-stale";
  await withEnvironment(
    {
      NODE_ENV: "production",
      MIGRATION_BACKUP_SOURCE: "railway_snapshot",
      MIGRATION_BACKUP_REFERENCE: reference,
      MIGRATION_BACKUP_CREATED_AT: createdAt.toISOString(),
      MIGRATION_BACKUP_SHA256: snapshotAttestationChecksum(reference, createdAt),
      MIGRATION_APPROVED_BY: "Original System Administrator",
      MIGRATION_CHANGE_TICKET: "CHALIN03-REL31",
    },
    () =>
      assert.throws(
        () => readProductionAttestationEnvironment(productionEntry()),
        /outside the approved/
      )
  );
});

test("Railway snapshot checksum mismatch fails closed", async () => {
  const createdAt = new Date();
  await withEnvironment(
    {
      NODE_ENV: "production",
      MIGRATION_BACKUP_SOURCE: "railway_snapshot",
      MIGRATION_BACKUP_REFERENCE: "railway-snapshot-release31-002",
      MIGRATION_BACKUP_CREATED_AT: createdAt.toISOString(),
      MIGRATION_BACKUP_SHA256: "a".repeat(64),
      MIGRATION_APPROVED_BY: "Original System Administrator",
      MIGRATION_CHANGE_TICKET: "CHALIN03-REL31",
    },
    () =>
      assert.rejects(
        () => verifyProductionBackupAttestation({}, productionEntry()),
        /not bound to the supplied Railway snapshot/
      )
  );
});

test("verified Chalin 03 backup must match current schema fingerprint", async () => {
  const holder = { record: null };
  const connection = fakeSchemaConnection(holder);
  const contract = await loadCanonicalContract(connection);
  const createdAt = new Date();
  const verifiedAt = new Date(createdAt.getTime() + 1000);
  const checksum = "b".repeat(64);
  const backupId = "11111111-1111-4111-8111-111111111111";

  holder.record = {
    backup_id: backupId,
    manifest_version: BACKUP_MANIFEST_VERSION,
    schema_version: contract.schemaFingerprintSha256,
    package_checksum_sha256: checksum,
    status: "validated",
    verification_status: "verified",
    created_at: createdAt,
    verified_at: verifiedAt,
  };

  await withEnvironment(
    {
      NODE_ENV: "production",
      MIGRATION_BACKUP_SOURCE: "chalin03_verified_backup",
      MIGRATION_BACKUP_REFERENCE: backupId,
      MIGRATION_BACKUP_CREATED_AT: createdAt.toISOString(),
      MIGRATION_BACKUP_SHA256: checksum,
      MIGRATION_APPROVED_BY: "Original System Administrator",
      MIGRATION_CHANGE_TICKET: "CHALIN03-REL31-NEXT",
    },
    async () => {
      const evidence = await verifyProductionBackupAttestation(
        connection,
        productionEntry()
      );
      assert.equal(evidence.backupSource, "chalin03_verified_backup");
      assert.equal(evidence.backupReference, backupId);
      assert.equal(
        evidence.backupSchemaFingerprintSha256,
        contract.schemaFingerprintSha256
      );
    }
  );
});
