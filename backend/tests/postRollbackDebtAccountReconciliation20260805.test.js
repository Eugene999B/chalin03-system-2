const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(
  backendRoot,
  "scripts",
  "runPostRollbackDebtAccountReconciliation20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);
const {
  RECONCILIATION_LOCK,
  RECONCILIATION_RECORD,
  nameSimilarity,
  normalizePhone,
  profilesAreSafeMatch,
} = require("../scripts/runPostRollbackDebtAccountReconciliation20260805");

test("same Ghana phone reunites Mickey profiles even with a small spelling difference", () => {
  assert.equal(normalizePhone("024 555 1212"), normalizePhone("+233 24 555 1212"));
  assert.ok(nameSimilarity("Master Mickey", "Master Micky") >= 0.88);
  assert.equal(
    profilesAreSafeMatch(
      { name: "Master Mickey", phone: "0245551212" },
      { name: "Master Micky", phone: "+233245551212" }
    ),
    true
  );
});

test("conflicting phones are never merged automatically", () => {
  assert.equal(
    profilesAreSafeMatch(
      { name: "Master Mickey", phone: "0245551212" },
      { name: "Master Mickey", phone: "0200000000" }
    ),
    false
  );
});

test("repair is one-time, production-only, locked and transactional", () => {
  assert.equal(RECONCILIATION_RECORD, "20260805_post_rollback_debt_account_reconciliation");
  assert.ok(RECONCILIATION_LOCK.length <= 64);
  assert.match(source, /NODE_ENV/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /rollback/);
  assert.match(source, /schema_migrations/);
});

test("repair changes ownership only and preserves profiles, amounts and payment history", () => {
  assert.match(source, /UPDATE sales SET customer_id = \?/);
  assert.match(source, /UPDATE debts SET customer_id = \?/);
  assert.match(source, /source_profiles_preserved: true/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+customers/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:sales|debts|debt_payments)/i);
  assert.doesNotMatch(source, /SET\s+(?:total|amount_owed|amount_paid|balance)\s*=/i);
});

test("Railway runs reconciliation after rollback and before the API", () => {
  const start = packageJson.scripts.start;
  const rollbackIndex = start.indexOf("runAutomaticCustomerMergeRollback20260805.js");
  const reconciliationIndex = start.indexOf(
    "runPostRollbackDebtAccountReconciliation20260805.js"
  );
  const serverIndex = start.indexOf("server.js");
  assert.ok(rollbackIndex >= 0);
  assert.ok(reconciliationIndex > rollbackIndex);
  assert.ok(serverIndex > reconciliationIndex);
  assert.equal(
    packageJson.scripts["repair:post-rollback-debt-accounts:20260805:production"],
    "node scripts/runPostRollbackDebtAccountReconciliation20260805.js"
  );
});
