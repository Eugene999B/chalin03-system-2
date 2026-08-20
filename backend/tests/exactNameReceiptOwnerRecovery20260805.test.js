const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(
  backendRoot,
  "scripts",
  "runExactNameReceiptOwnerRecovery20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);
const {
  RECOVERY_DATE,
  RECOVERY_LOCK,
  RECOVERY_RECORD,
  chooseExactNameOwner,
  normalizeName,
} = require("../scripts/runExactNameReceiptOwnerRecovery20260805");

const profiles = [
  { customer_id: 30, name: "Master Mickey", profile_type: "target" },
  { customer_id: 91, name: "Master Mickey", profile_type: "source" },
  { customer_id: 92, name: "Kwaku Mensah", profile_type: "source" },
];

test("exact preserved name sends every Mickey receipt to the original master without a phone", () => {
  assert.equal(normalizeName(" Master-Mickey "), "master mickey");
  assert.deepEqual(
    chooseExactNameOwner({
      snapshotName: "MASTER MICKEY",
      profiles,
      targetCustomerId: 30,
      previousCustomerId: 91,
    }),
    { customer_id: 30, reason: "exact_name_original_target" }
  );
});

test("another customer's exact preserved name removes that receipt from Mickey", () => {
  assert.deepEqual(
    chooseExactNameOwner({
      snapshotName: "Kwaku Mensah",
      profiles,
      targetCustomerId: 30,
      previousCustomerId: null,
    }),
    { customer_id: 92, reason: "exact_name_unique_source" }
  );
});

test("no exact match restores the previous receipt-level rollback assignment", () => {
  assert.deepEqual(
    chooseExactNameOwner({
      snapshotName: "K. Mensah",
      profiles,
      targetCustomerId: 30,
      previousCustomerId: 92,
    }),
    { customer_id: 92, reason: "previous_rollback_assignment" }
  );
});

test("recovery ignores phones and forbids fuzzy or broad identity grouping", () => {
  assert.doesNotMatch(source, /normalizePhone|phoneSimilarity|levenshtein|nameSimilarity|UnionFind|profilesAreSafeMatch/);
  assert.doesNotMatch(source, /runPostRollbackDebtAccountReconciliation20260805/);
  assert.match(source, /exact_name_original_target/);
  assert.match(source, /exact_name_unique_source/);
  assert.match(source, /previous_rollback_assignment/);
  assert.match(source, /phone_numbers_used_for_matching: false/);
  assert.match(source, /fuzzy_name_matching_used: false/);
});

test("recovery is locked, transactional and preserves all financial totals", () => {
  assert.equal(RECOVERY_DATE, "2026-08-05");
  assert.equal(RECOVERY_RECORD, "20260805_exact_name_receipt_owner_recovery");
  assert.ok(RECOVERY_LOCK.length <= 64);
  assert.match(source, /NODE_ENV/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /rollback/);
  assert.match(source, /assertFinancialSnapshotPreserved/);
  assert.match(source, /UPDATE sales SET customer_id = \?/);
  assert.match(source, /UPDATE debts SET customer_id = \?/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:customers|sales|debts|debt_payments)/i);
  assert.doesNotMatch(source, /SET\s+(?:total|amount_owed|amount_paid|balance)\s*=/i);
});

test("controlled maintenance runs exact receipt recovery after rollback and never broad regrouping", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const rollbackIndex = maintenance.indexOf("runAutomaticCustomerMergeRollback20260805.js");
  const exactIndex = maintenance.indexOf("runExactNameReceiptOwnerRecovery20260805.js");
  assert.ok(rollbackIndex >= 0);
  assert.ok(exactIndex > rollbackIndex);
  assert.equal(maintenance.includes("runPostRollbackDebtAccountReconciliation20260805.js"), false);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["repair:exact-name-receipt-owners:20260805:production"],
    "node scripts/runExactNameReceiptOwnerRecovery20260805.js"
  );
});
