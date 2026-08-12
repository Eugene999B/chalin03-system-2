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

test("blocks a backup missing a current table in strict mode", () => {
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

test("blocks schema and migration drift in strict mode", () => {
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

test("accepts an older signed backup across safe additive schema changes", () => {
  const backup = makeBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products", "payroll_settings"],
    currentTableColumns: {
      users: ["id", "username", "token_version"],
      products: ["id", "name", "barcode"],
      payroll_settings: ["id", "branch_id"],
    },
    currentTableMetadata: {
      users: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "username", nullable: false, hasDefault: false, extra: "" },
        { name: "token_version", nullable: false, hasDefault: true, extra: "" },
      ],
      products: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "name", nullable: false, hasDefault: false, extra: "" },
        { name: "barcode", nullable: true, hasDefault: false, extra: "" },
      ],
      payroll_settings: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "branch_id", nullable: false, hasDefault: false, extra: "" },
      ],
    },
    currentSchemaMigrations: [
      ...currentSchemaMigrations,
      { migration_name: "payroll_foundation" },
    ],
    signingSecret,
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.deepEqual(report.currentOnlyTables, ["payroll_settings"]);
  assert.equal(report.additiveSchemaCompatibilityApplied, true);
  assert.match(report.warnings.join(" "), /preserved|predates|newer migrations/i);
});

test("blocks an older backup when a new current column cannot be safely omitted", () => {
  const backup = makeBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns: {
      ...currentTableColumns,
      products: ["id", "name", "required_code"],
    },
    currentTableMetadata: {
      products: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "name", nullable: false, hasDefault: false, extra: "" },
        { name: "required_code", nullable: false, hasDefault: false, extra: "" },
      ],
    },
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /cannot safely supply required columns/i);
});

test("blocks a backup migration unknown to the current runtime even in additive mode", () => {
  const backup = makeBackup();
  backup.schema_migrations.push({ migration_name: "future_runtime" });
  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, signingSecret);

  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentTableMetadata: {
      users: currentTableColumns.users.map((name) => ({ name, nullable: true, hasDefault: false, extra: "" })),
      products: currentTableColumns.products.map((name) => ({ name, nullable: true, hasDefault: false, extra: "" })),
    },
    currentSchemaMigrations,
    signingSecret,
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /unknown backup migrations/i);
});
