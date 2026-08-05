const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(
  backendRoot,
  "scripts",
  "runAutomaticCustomerMergeRollback20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);
const {
  RECOVERY_DATE,
  RECOVERY_LOCK,
  RECOVERY_RECORD,
  normalizePhone,
  selectSourceProfile,
} = require("../scripts/runAutomaticCustomerMergeRollback20260805");

test("automatic rollback is locked, production-only and one-time", () => {
  assert.equal(RECOVERY_DATE, "2026-08-05");
  assert.equal(RECOVERY_RECORD, "20260805_automatic_customer_merge_rollback");
  assert.ok(RECOVERY_LOCK.length <= 64);
  assert.match(source, /NODE_ENV/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(source, /schema_migrations/);
  assert.match(source, /recoveryRecordExists/);
});

test("Ghana phone snapshots return a receipt to the unique original source", () => {
  assert.equal(normalizePhone("024 555 1212"), normalizePhone("+233 24 555 1212"));
  const sourceCustomer = { id: 91, name: "Kwaku Mensah", phone: "0245551212" };
  const targetCustomer = { id: 30, name: "Master Mickey", phone: "0201112222" };
  assert.equal(
    selectSourceProfile(
      "Kwaku Mensah",
      "+233245551212",
      [sourceCustomer],
      targetCustomer
    )?.id,
    91
  );
});

test("ambiguous identical identities are not guessed", () => {
  const sources = [
    { id: 1, name: "Ama Boateng", phone: "0240000000" },
    { id: 2, name: "Ama Boateng", phone: "0240000000" },
  ];
  assert.equal(
    selectSourceProfile("Ama Boateng", "0240000000", sources, {
      id: 3,
      name: "Different Target",
      phone: "0200000000",
    }),
    null
  );
});

test("all same-day merges are processed newest first and exact ownership is restored", () => {
  assert.match(source, /DATE\(created_at\) = \?/);
  assert.match(source, /ORDER BY created_at DESC, id DESC/);
  assert.match(source, /INSERT INTO customers \(id, branch_id, name, phone, location/);
  assert.match(source, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(source, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(source, /UPDATE installment_agreements ia/);
  assert.match(source, /UPDATE customers\s+SET name = \?, phone = \?, location = \?/);
  assert.match(source, /\[MergeUndo:\$\{audit\.id\}\]/);
});

test("debt ownership is synchronized to its sale without rewriting money or deleting history", () => {
  assert.match(source, /SET d\.customer_id = s\.customer_id/);
  assert.match(source, /remaining_sale_debt_customer_mismatches/);
  assert.match(source, /monetary_anomalies_reported_not_changed/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:sales|debts|debt_payments)/i);
  assert.doesNotMatch(source, /UPDATE\s+debts[\s\S]{0,120}SET[\s\S]{0,120}(?:amount_owed|amount_paid|balance)\s*=/i);
  assert.doesNotMatch(source, /UPDATE\s+sales[\s\S]{0,120}SET[\s\S]{0,120}(?:total|amount_paid|balance)\s*=/i);
});

test("Railway runs the authorized rollback before the API server", () => {
  const start = packageJson.scripts.start;
  const rollbackIndex = start.indexOf("runAutomaticCustomerMergeRollback20260805.js");
  const serverIndex = start.indexOf("server.js");
  assert.ok(rollbackIndex >= 0);
  assert.ok(serverIndex > rollbackIndex);
  assert.equal(
    packageJson.scripts["repair:customer-merges:20260805:production"],
    "node scripts/runAutomaticCustomerMergeRollback20260805.js"
  );
});
