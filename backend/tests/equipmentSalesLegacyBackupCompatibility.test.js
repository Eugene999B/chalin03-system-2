const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_TYPE,
  LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION,
  legacyDelegatedChecksum,
  validateBackupContract,
} = require("../services/backupSafetyService");

function makeHistoricalBackup() {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    created_at: "2026-07-25T05:41:32.525Z",
    included_tables: ["users", "products", "sms_log", "schema_migrations"],
    skipped_tables: [],
    table_counts: {
      users: 1,
      products: 1,
      sms_log: 1,
      schema_migrations: 1,
    },
    // Historical July backups could contain a one-row count drift while their
    // checksum still authenticated the exact stored manifest and row payload.
    total_record_count: 4,
    tables: {
      users: [
        {
          id: 1,
          username: "admin",
          token_version: 0,
          avatar_blob: { type: "Buffer", data: [1, 2, 3, 4] },
        },
      ],
      products: [{ id: 1, name: "Filter" }],
      sms_log: [
        { id: 1, recipient: "233000000000", message: "one" },
        { id: 2, recipient: "233000000001", message: "two" },
      ],
      schema_migrations: [{ id: 1, migration_name: "legacy_phase" }],
    },
    manifest: {
      manifest_version: LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION,
    },
  };
  backup.checksum_sha256 = legacyDelegatedChecksum(backup);
  return backup;
}

const currentIncludedTables = ["users", "products", "sms_log", "payroll_settings"];
const currentTableColumns = {
  users: ["id", "username", "token_version", "avatar_blob"],
  products: ["id", "name", "barcode"],
  sms_log: ["id", "recipient", "message"],
  payroll_settings: ["id", "branch_id"],
};
const currentTableMetadata = {
  users: currentTableColumns.users.map((name) => ({
    name,
    nullable: name === "avatar_blob",
    hasDefault: name === "token_version",
    extra: name === "id" ? "auto_increment" : "",
  })),
  products: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "name", nullable: false, hasDefault: false, extra: "" },
    { name: "barcode", nullable: true, hasDefault: false, extra: "" },
  ],
  sms_log: currentTableColumns.sms_log.map((name) => ({
    name,
    nullable: true,
    hasDefault: false,
    extra: name === "id" ? "auto_increment" : "",
  })),
  payroll_settings: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "branch_id", nullable: false, hasDefault: false, extra: "" },
  ],
};

test("accepts July equipment-sales legacy backup with authenticated historical count drift", () => {
  const backup = makeHistoricalBackup();
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
  assert.equal(report.backupFormat, LEGACY_EQUIPMENT_SALES_MANIFEST_VERSION);
  assert.equal(report.legacyUnsignedBackup, true);
  assert.deepEqual(report.currentOnlyTables, ["payroll_settings"]);
  assert.match(report.warnings.join(" "), /count warning/i);
  assert.equal(backup.tables.users[0].avatar_blob.__chalin03_type, "buffer_base64");
});

test("still rejects tampering in July equipment-sales legacy backup", () => {
  const backup = makeHistoricalBackup();
  backup.tables.products[0].name = "Tampered";

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
