const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeRestoreValue,
  orderTablesByDependencies,
  stableBackupChecksum,
} = require("../services/fullSystemBackupService");

const backendRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

test("full-system table ordering restores parents before children", () => {
  const ordering = orderTablesByDependencies(
    ["sale_items", "sales", "branches", "users"],
    [
      {
        constraint_name: "fk_sale_item_sale",
        child_table: "sale_items",
        child_column: "sale_id",
        parent_table: "sales",
        parent_column: "id",
        ordinal_position: 1,
      },
      {
        constraint_name: "fk_sale_branch",
        child_table: "sales",
        child_column: "branch_id",
        parent_table: "branches",
        parent_column: "id",
        ordinal_position: 1,
      },
      {
        constraint_name: "fk_sale_user",
        child_table: "sales",
        child_column: "created_by",
        parent_table: "users",
        parent_column: "id",
        ordinal_position: 1,
      },
    ]
  );

  assert.ok(ordering.insertOrder.indexOf("branches") < ordering.insertOrder.indexOf("sales"));
  assert.ok(ordering.insertOrder.indexOf("users") < ordering.insertOrder.indexOf("sales"));
  assert.ok(ordering.insertOrder.indexOf("sales") < ordering.insertOrder.indexOf("sale_items"));
  assert.deepEqual(ordering.deleteOrder, [...ordering.insertOrder].reverse());
});

test("backup checksum covers schema identity, counts and table contents", () => {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: "test-v2",
    backup_id: "11111111-1111-4111-8111-111111111111",
    backup_type: "full_system_backup",
    created_at: "2026-07-23T12:00:00.000Z",
    included_tables: ["users"],
    table_counts: { users: 1 },
    total_record_count: 1,
    schema_fingerprint_sha256: "a".repeat(64),
    tables: { users: [{ id: 1, username: "admin" }] },
  };

  const original = stableBackupChecksum(backup);
  const changed = stableBackupChecksum({
    ...backup,
    tables: { users: [{ id: 1, username: "changed" }] },
  });

  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(original, changed);
});

test("binary credential evidence survives JSON backup restoration", () => {
  const restored = normalizeRestoreValue({ type: "Buffer", data: [1, 2, 3, 255] });
  assert.ok(Buffer.isBuffer(restored));
  assert.deepEqual([...restored], [1, 2, 3, 255]);
});

test("recovery service fails closed and invalidates restored security state", () => {
  const source = read("services/fullSystemBackupService.js");

  assert.match(source, /The backup is incomplete and cannot replace the current database/);
  assert.match(source, /A valid SHA-256 backup checksum is required/);
  assert.match(source, /schema fingerprint does not match/i);
  assert.match(source, /RESTORE_ROW_COUNT_MISMATCH/);
  assert.match(source, /RESTORE_FOREIGN_KEY_RECONCILIATION_FAILED/);
  assert.match(source, /SET token_version = COALESCE\(token_version, 0\) \+ 1/);
  assert.match(source, /UPDATE auth_sessions/);
  assert.match(source, /UPDATE protected_action_sessions/);
  assert.match(source, /UPDATE password_recovery_otps/);
  assert.match(source, /UPDATE passkey_challenges/);
  assert.match(source, /UPDATE user_passkeys/);
});

test("backup routes delegate all data work to the protected recovery service", () => {
  const source = read("routes/delegatedBackupRoutes.js");

  assert.match(source, /createFullSystemBackup/);
  assert.match(source, /validateFullSystemBackup/);
  assert.match(source, /restoreFullSystemBackup/);
  assert.match(source, /requireProtectedAction/);
  assert.match(source, /requireBackupAuthority/);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(source, /ALTER\s+TABLE/i);
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
});
