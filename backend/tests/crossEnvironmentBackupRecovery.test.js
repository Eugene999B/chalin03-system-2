const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  checksumBackup,
  signBackup,
  validateBackupContract,
} = require("../services/backupSafetyService");

const productionSecret = "p".repeat(64);
const stagingSecret = "s".repeat(64);

function sourceBackup() {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-08-12T12:59:47.484Z",
    included_tables: ["products", "source_only_table", "users"],
    excluded_tables: ["schema_migrations"],
    table_columns: {
      products: ["id", "name", "source_only_column"],
      source_only_table: ["id", "value"],
      users: ["id", "username", "token_version"],
    },
    table_counts: {
      products: 1,
      source_only_table: 1,
      users: 1,
    },
    total_record_count: 3,
    schema_migrations: [
      { migration_name: "source_newer_migration", description: null, applied_at: null },
    ],
    tables: {
      products: [{ id: 1, name: "Filter", source_only_column: "newer" }],
      source_only_table: [{ id: 1, value: "source" }],
      users: [{ id: 1, username: "admin", token_version: 1 }],
    },
  };
  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, productionSecret);
  return backup;
}

const targetTables = ["products", "target_only_table", "users"];
const targetColumns = {
  products: ["id", "name"],
  target_only_table: ["id", "value"],
  users: ["id", "username", "token_version"],
};
const targetMetadata = {
  products: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "name", nullable: false, hasDefault: false, extra: "" },
  ],
  target_only_table: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "value", nullable: true, hasDefault: false, extra: "" },
  ],
  users: [
    { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
    { name: "username", nullable: false, hasDefault: false, extra: "" },
    { name: "token_version", nullable: false, hasDefault: true, extra: "" },
  ],
};

test("non-production accepts an intact production-signed v2 backup across schema and HMAC boundaries", () => {
  const backup = sourceBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: targetTables,
    currentTableColumns: targetColumns,
    currentTableMetadata: targetMetadata,
    currentSchemaMigrations: [{ migration_name: "target_migration" }],
    signingSecret: stagingSecret,
    requireSignature: false,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.crossEnvironmentRecovery, true);
  assert.equal(report.signatureVerified, false);
  assert.deepEqual(report.includedTables, ["products", "users"]);
  assert.deepEqual(report.sourceOnlyTables, ["source_only_table"]);
  assert.deepEqual(report.currentOnlyTables, ["target_only_table"]);
  assert.deepEqual(backup.table_columns.products, ["id", "name"]);
  assert.match(report.warnings.join(" "), /cross-environment|trial/i);
});

test("production remains strict for a backup signed by a different server", () => {
  const backup = sourceBackup();
  const report = validateBackupContract({
    backup,
    currentIncludedTables: targetTables,
    currentTableColumns: targetColumns,
    currentTableMetadata: targetMetadata,
    currentSchemaMigrations: [{ migration_name: "target_migration" }],
    signingSecret: stagingSecret,
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /signature|newer|not supported/i);
});

test("cross-environment mode still rejects checksum tampering", () => {
  const backup = sourceBackup();
  backup.tables.products[0].name = "Tampered";

  const report = validateBackupContract({
    backup,
    currentIncludedTables: targetTables,
    currentTableColumns: targetColumns,
    currentTableMetadata: targetMetadata,
    currentSchemaMigrations: [],
    signingSecret: stagingSecret,
    requireSignature: false,
    allowAdditiveSchemaDrift: true,
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /checksum/i);
});
