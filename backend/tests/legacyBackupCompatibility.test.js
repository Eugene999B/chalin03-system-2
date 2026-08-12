const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_TYPE,
  LEGACY_DELEGATED_MANIFEST_VERSION,
  legacyDelegatedChecksum,
  validateBackupContract,
} = require("../services/backupSafetyService");

function makeLegacyBackup() {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: LEGACY_DELEGATED_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    created_at: "2026-06-10T12:00:00.000Z",
    included_tables: [
      "users",
      "products",
      "auth_sessions",
      "schema_migrations",
    ],
    table_counts: {
      users: 1,
      products: 1,
      auth_sessions: 1,
      schema_migrations: 1,
    },
    total_record_count: 4,
    tables: {
      users: [
        {
          id: 1,
          username: "admin",
          token_version: 2,
          avatar_blob: { type: "Buffer", data: [1, 2, 3, 4] },
        },
      ],
      products: [{ id: 1, name: "Filter" }],
      auth_sessions: [{ id: "session-1", user_id: 1 }],
      schema_migrations: [{ id: 1, migration_name: "legacy_phase" }],
    },
  };
  backup.checksum_sha256 = legacyDelegatedChecksum(backup);
  return backup;
}

const currentIncludedTables = ["users", "products", "payroll_settings"];
const currentTableColumns = {
  users: ["id", "username", "token_version", "avatar_blob"],
  products: ["id", "name", "barcode"],
  payroll_settings: ["id", "branch_id"],
};
const currentTableMetadata = {
  users: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "username", nullable: false, hasDefault: false, extra: "" },
    { name: "token_version", nullable: false, hasDefault: true, extra: "" },
    { name: "avatar_blob", nullable: true, hasDefault: false, extra: "" },
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
};

test("accepts a legitimate historical delegated-v1 backup for owner recovery", () => {
  const backup = makeLegacyBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables,
    currentTableColumns,
    currentTableMetadata,
    currentSchemaMigrations: [{ migration_name: "current_release" }],
    signingSecret: "a".repeat(64),
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.deepEqual(report.includedTables, ["products", "users"]);
  assert.deepEqual(report.currentOnlyTables, ["payroll_settings"]);
  assert.equal(report.legacyUnsignedBackup, true);
  assert.deepEqual(backup.table_columns.products, ["id", "name"]);
  assert.deepEqual(backup.table_columns.users, [
    "avatar_blob",
    "id",
    "token_version",
    "username",
  ]);
  assert.equal(
    backup.tables.users[0].avatar_blob.__chalin03_type,
    "buffer_base64"
  );
  assert.match(report.warnings.join(" "), /legacy|historical|preserved/i);
});

test("still blocks tampering in a historical delegated-v1 backup", () => {
  const backup = makeLegacyBackup();
  backup.tables.products[0].name = "Tampered after checksum";

  const report = validateBackupContract({
    backup,
    currentIncludedTables,
    currentTableColumns,
    currentTableMetadata,
    currentSchemaMigrations: [],
    signingSecret: "a".repeat(64),
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /checksum/i);
});

test("blocks a legacy backup when current required columns cannot be omitted", () => {
  const backup = makeLegacyBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: ["users", "products"],
    currentTableColumns: {
      users: currentTableColumns.users,
      products: ["id", "name", "required_code"],
    },
    currentTableMetadata: {
      users: currentTableMetadata.users,
      products: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "name", nullable: false, hasDefault: false, extra: "" },
        { name: "required_code", nullable: false, hasDefault: false, extra: "" },
      ],
    },
    currentSchemaMigrations: [],
    signingSecret: "a".repeat(64),
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /required current columns/i);
});
