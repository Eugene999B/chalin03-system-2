const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const scriptPath = path.join(
  backendDir,
  "scripts",
  "runUnpaidReceiptIdentityIsolation20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendDir, "package.json"), "utf8")
);
const {
  REPAIR_RECORD,
  REQUIRED_EXACT_REPAIR,
  assertCoreUnchanged,
  assertProtectedRowsUnchanged,
  normalizeName,
  validateCandidate,
} = require(scriptPath);

test("normalizes receipt names exactly without using phone or fuzzy matching", () => {
  assert.equal(normalizeName("  Master   Mickey "), "MASTER MICKEY");
  assert.notEqual(normalizeName("MASTER MICKEY"), normalizeName("MASTER MICKY"));
  assert.doesNotMatch(source, /levenshtein|similarity|soundex|fuzzy/i);
  assert.doesNotMatch(source, /customer_phone\s*<>|phone_required\s*:\s*true/i);
});

test("candidate must be one exact unpaid open receipt with a conflicting profile name", () => {
  assert.doesNotThrow(() =>
    validateCandidate({
      sale_id: 7928,
      receipt_number: "CHL-MAIN-20260731-103020-7928",
      receipt_customer_name: "MASTER MICKEY",
      profile_customer_name: "PT G2",
      amount_paid: 0,
      balance: 1900,
      status: "unpaid",
    })
  );
  assert.throws(
    () =>
      validateCandidate({
        sale_id: 1,
        receipt_number: "R-1",
        receipt_customer_name: "PT G2",
        profile_customer_name: "PT G2",
        amount_paid: 0,
        balance: 100,
        status: "unpaid",
      }),
    /proven name conflict/
  );
  assert.throws(
    () =>
      validateCandidate({
        sale_id: 1,
        receipt_number: "R-2",
        receipt_customer_name: "MASTER MICKEY",
        profile_customer_name: "PT G2",
        amount_paid: 1,
        balance: 99,
        status: "unpaid",
      }),
    /not an unpaid open debt/
  );
});

test("paid and partial statuses can never become isolation candidates", () => {
  for (const status of ["paid", "partial", "PAID", " Partial "]) {
    assert.throws(
      () =>
        validateCandidate({
          sale_id: 20,
          receipt_number: `R-${status}`,
          receipt_customer_name: "MASTER MICKEY",
          profile_customer_name: "PT G2",
          amount_paid: 0,
          balance: 100,
          status,
        }),
      /protected paid or partial status/
    );
  }
  assert.match(
    source,
    /LOWER\(COALESCE\(d\.status, ''\)\) NOT IN \('paid', 'partial'\)/
  );
});

test("SQL excludes every receipt with real payment evidence", () => {
  assert.match(source, /d\.amount_paid <= 0\.005/);
  assert.match(source, /COALESCE\(s\.amount_paid, 0\) <= 0\.005/);
  assert.match(source, /NOT EXISTS\s*\(\s*SELECT 1\s*FROM debt_payments/s);
  assert.match(source, /protected\.debt_status IN \('paid', 'partial'\)/);
  assert.match(source, /assertProtectedRowsUnchanged\(protectedBefore, protectedAfter\)/);
});

test("repair detaches only customer IDs and never rewrites financial fields", () => {
  const updateStatements = [...source.matchAll(/UPDATE\s+(sales|debts)\s+SET\s+([\s\S]*?)\s+WHERE/gi)];
  assert.equal(updateStatements.length, 2);
  assert.deepEqual(
    updateStatements.map((match) => [match[1].toLowerCase(), match[2].replace(/\s+/g, " ").trim()]),
    [
      ["sales", "customer_id = NULL"],
      ["debts", "customer_id = NULL"],
    ]
  );
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE/i);
});

test("financial and paid-record guards fail closed", () => {
  const core = {
    sale_count: 645,
    debt_count: 199,
    payment_count: 20,
    product_count: 100,
    stock_quantity: 500,
    daily_closing_count: 10,
    sale_total: 1000,
    sale_paid: 500,
    sale_balance: 500,
    debt_owed: 700,
    debt_paid: 200,
    debt_balance: 500,
    payment_total: 200,
  };
  assert.doesNotThrow(() => assertCoreUnchanged(core, { ...core }));
  assert.throws(
    () => assertCoreUnchanged(core, { ...core, payment_total: 201 }),
    /payment_total/
  );

  const protectedRows = [
    {
      debt_id: 10,
      amount_paid: 50,
      balance: 50,
      status: "partial",
      payment_count: 1,
    },
  ];
  assert.doesNotThrow(() =>
    assertProtectedRowsUnchanged(protectedRows, JSON.parse(JSON.stringify(protectedRows)))
  );
  assert.throws(
    () => assertProtectedRowsUnchanged(protectedRows, [{ ...protectedRows[0], balance: 0 }]),
    /paid, partially paid, or payment-linked receipt changed/
  );
});

test("controlled maintenance runs isolation after the exact Mickey repair", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const exactIndex = maintenance.indexOf("runMasterMickeyJuly31ExactDebtRepair20260805.js");
  const isolationIndex = maintenance.indexOf("runUnpaidReceiptIdentityIsolation20260805.js");
  assert.ok(exactIndex >= 0 && isolationIndex > exactIndex);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(REPAIR_RECORD, "20260805_unpaid_receipt_identity_isolation");
  assert.equal(REQUIRED_EXACT_REPAIR, "20260805_master_mickey_july31_exact_debt_repair");
  assert.equal(
    packageJson.scripts["repair:unpaid-receipt-identity-isolation:20260805:production"],
    "node scripts/runUnpaidReceiptIdentityIsolation20260805.js"
  );
});