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
const sanitizerPath = path.join(
  backendRoot,
  "scripts",
  "runCustomerMergeAuditDateSanitizer20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const sanitizerSource = fs.readFileSync(sanitizerPath, "utf8");
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
const {
  sanitizeMergeMetadata,
  toMysqlDateTime,
} = require("../scripts/runCustomerMergeAuditDateSanitizer20260805");

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

test("malformed audit date objects are converted or safely cleared before rollback", () => {
  assert.equal(toMysqlDateTime({ date: "2026-08-05T10:11:12.000Z" }), "2026-08-05 10:11:12");
  assert.equal(toMysqlDateTime({ unexpected: true }), null);
  const result = sanitizeMergeMetadata({
    source_customers: [
      { id: 1, created_at: { date: "2026-08-05T10:11:12.000Z" } },
      { id: 2, created_at: { unexpected: true } },
    ],
  });
  assert.equal(result.changed, true);
  assert.equal(result.metadata.source_customers[0].created_at, "2026-08-05 10:11:12");
  assert.equal(result.metadata.source_customers[1].created_at, null);
  assert.match(sanitizerSource, /UPDATE activity_log SET metadata_json = \?/);
  assert.doesNotMatch(sanitizerSource, /DELETE\s+FROM/i);
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

test("maintenance sanitizes audit dates, then runs rollback, before the API starts independently", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const startupPlan = `${maintenance} && ${packageJson.scripts.start}`;
  const sanitizerIndex = startupPlan.indexOf("runCustomerMergeAuditDateSanitizer20260805.js");
  const rollbackIndex = startupPlan.indexOf("runAutomaticCustomerMergeRollback20260805.js");
  const serverIndex = startupPlan.indexOf("server.js");
  assert.ok(sanitizerIndex >= 0);
  assert.ok(rollbackIndex > sanitizerIndex);
  assert.ok(serverIndex > rollbackIndex);
  assert.equal(
    packageJson.scripts["repair:customer-merge-audit-dates:20260805:production"],
    "node scripts/runCustomerMergeAuditDateSanitizer20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:customer-merges:20260805:production"],
    "node scripts/runAutomaticCustomerMergeRollback20260805.js"
  );
});
