const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const routePath = path.join(
  root,
  "backend",
  "routes",
  "topDebtAccountMergeRoutes.js"
);
const wrapperPath = path.join(
  root,
  "backend",
  "routes",
  "customerDebtConsolidationRoutes.js"
);
const source = fs.readFileSync(routePath, "utf8");
const wrapper = fs.readFileSync(wrapperPath, "utf8");
const {
  parseAccountKey,
  assertFinancialSnapshot,
  assertLegacyRowsPreserved,
} = require(routePath);

function baseSnapshot() {
  return {
    customer_count: 100,
    sale_count: 645,
    sale_total: 900000,
    sale_paid: 700000,
    sale_balance: 200000,
    unlinked_sale_count: 21,
    debt_count: 201,
    debt_owed: 713785,
    debt_paid: 228434,
    debt_balance: 485351,
    unlinked_debt_count: 21,
    payment_count: 80,
    payment_total: 228434,
    product_count: 1200,
    stock_quantity: 9500,
    daily_closing_count: 30,
  };
}

test("top merge parses saved and receipt-level account keys", () => {
  assert.deepEqual(parseAccountKey("customer-460"), {
    key: "customer-460",
    type: "customer",
    id: 460,
  });
  assert.deepEqual(parseAccountKey("legacy-107"), {
    key: "legacy-107",
    type: "legacy",
    id: 107,
  });
  assert.equal(parseAccountKey("MASTER MICKEY"), null);
  assert.equal(parseAccountKey("customer-0"), null);
  assert.equal(parseAccountKey("legacy--1"), null);
});

test("financial snapshot permits only expected ownership-count changes", () => {
  const before = baseSnapshot();
  const after = {
    ...before,
    customer_count: 99,
    unlinked_sale_count: 20,
    unlinked_debt_count: 20,
  };

  assert.doesNotThrow(() =>
    assertFinancialSnapshot(before, after, {
      removedCustomerCount: 1,
      linkedLegacySaleCount: 1,
      linkedLegacyDebtCount: 1,
    })
  );
  assert.throws(
    () =>
      assertFinancialSnapshot(before, { ...after, debt_balance: 485350 }, {
        removedCustomerCount: 1,
        linkedLegacySaleCount: 1,
        linkedLegacyDebtCount: 1,
      }),
    /debt_balance/
  );
  assert.throws(
    () =>
      assertFinancialSnapshot(before, { ...after, payment_total: 228435 }, {
        removedCustomerCount: 1,
        linkedLegacySaleCount: 1,
        linkedLegacyDebtCount: 1,
      }),
    /payment_total/
  );
});

test("receipt-level verification allows only customer ownership to change", () => {
  const before = [
    {
      debt_id: 77,
      sale_id: 88,
      debt_customer_id: null,
      sale_customer_id: null,
      debt_customer_name: "MASTER MICKEY",
      sale_customer_name: "MASTER MICKEY",
      amount_owed: 1900,
      debt_amount_paid: 0,
      debt_balance: 1900,
      debt_status: "unpaid",
      sale_total: 1900,
      sale_amount_paid: 0,
      sale_balance: 1900,
      payment_count: 0,
      payment_total: 0,
    },
  ];
  const after = [
    {
      ...before[0],
      debt_customer_id: 460,
      sale_customer_id: 460,
    },
  ];

  assert.doesNotThrow(() => assertLegacyRowsPreserved(before, after, 460));
  assert.throws(
    () =>
      assertLegacyRowsPreserved(
        before,
        [{ ...after[0], debt_balance: 1800 }],
        460
      ),
    /changed financially/
  );
  assert.throws(
    () =>
      assertLegacyRowsPreserved(
        before,
        [{ ...after[0], payment_count: 1, payment_total: 100 }],
        460
      ),
    /payment history/
  );
});

test("top merge endpoint is transactional, role-gated and ID-only", () => {
  assert.match(source, /router\.post\(\s*"\/merge-accounts"/);
  assert.match(source, /requireRole\("admin", "manager"\)/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /connection\.rollback/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(source, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(source, /MERGE_DEBT_DESK_ACCOUNTS/);
  assert.match(source, /financial_values_changed: false/);
  assert.match(source, /payment_history_changed: false/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:debts|debt_payments)/i);
  assert.doesNotMatch(
    source,
    /SET\s+(?:amount_owed|amount_paid|balance|status|total|quantity)\s*=/i
  );
});

test("top account router is mounted before preserved legacy routes", () => {
  assert.match(wrapper, /topDebtAccountMergeRoutes/);
  assert.match(wrapper, /legacyCustomerDebtConsolidationRoutes/);
  assert.ok(
    wrapper.indexOf("router.use(topDebtAccountMergeRoutes)") <
      wrapper.indexOf("router.use(legacyCustomerDebtConsolidationRoutes)")
  );
});
