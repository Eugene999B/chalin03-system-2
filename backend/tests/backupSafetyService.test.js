const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  checksumBackup,
  classifyDatabaseTables,
  signBackup,
  validateBackupContract,
} = require("../services/backupSafetyService");

const signingSecret = "a".repeat(64);

function makeBackup() {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-07-24T19:00:00.000Z",
    included_tables: ["products", "users"],
    excluded_tables: ["auth_sessions", "schema_migrations"],
    table_columns: {
      products: ["id", "name"],
      users: ["id", "username", "token_version"],
    },
    table_counts: { products: 1, users: 1 },
    total_record_count: 2,
    schema_migrations: [
      { migration_name: "phase0", description: "test", applied_at: null },
    ],
    tables: {
      products: [{ id: 1, name: "Filter" }],
      users: [{ id: 1, username: "admin", token_version: 2 }],
    },
  };
  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, signingSecret);
  return backup;
}

const currentTableColumns = {
  products: ["id", "name"],
  users: ["id", "username", "token_version"],
};
const currentSchemaMigrations = [
  { migration_name: "phase0", description: "test", applied_at: null },
];

test("classifies durable and ephemeral tables", () => {
  const inventory = classifyDatabaseTables([
    "users",
    "products",
    "auth_sessions",
    "password_recovery_otps",
    "schema_migrations",
    "stores",
  ]);
  assert.deepEqual(inventory.includedTables, ["products", "users"]);
  assert.deepEqual(inventory.ephemeralSecurityTables, [
    "auth_sessions",
    "password_recovery_otps",
  ]);
  assert.ok(inventory.excludedTables.includes("schema_migrations"));
  assert.ok(inventory.excludedTables.includes("stores"));
});

test("accepts a complete signed backup with an exact schema contract", () => {
  const report = validateBackupContract({
    backup: makeBackup(),
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
  });
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.totalRows, 2);
});

test("blocks a backup missing a current table", () => {
  const backup = makeBackup();
  delete backup.tables.products;
  backup.included_tables = ["users"];
  backup.table_counts = { users: 1 };
  backup.total_record_count = 1;
  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, signingSecret);

  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
  });
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /missing current required tables/i);
});

test("blocks altered row data even when counts still look valid", () => {
  const backup = makeBackup();
  backup.tables.products[0].name = "Tampered";

  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
  });
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /checksum|signature/i);
});

test("blocks a valid checksum signed by the wrong server", () => {
  const backup = makeBackup();
  backup.signature_hmac_sha256 = signBackup(backup, "b".repeat(64));

  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
  });
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /signature/i);
});

test("blocks schema and migration drift", () => {
  const backup = makeBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns: {
      ...currentTableColumns,
      products: ["id", "name", "quantity"],
    },
    currentSchemaMigrations: [
      ...currentSchemaMigrations,
      { migration_name: "newer_release" },
    ],
    signingSecret,
    requireSignature: true,
  });
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /columns|migration history/i);
});
