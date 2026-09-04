const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveIndependentFinanceScope,
} = require("../services/hireLocationScope");

test("company-wide Finance lifecycle scope accepts a controlled agreement without hire location", async () => {
  const connection = {
    async query(sql, params) {
      assert.match(sql, /FROM equipment_sale_agreements/);
      assert.deepEqual(params, [6]);
      return [[{ id: 6 }], []];
    },
  };

  const scope = await resolveIndependentFinanceScope(
    {
      method: "POST",
      originalUrl: "/api/equipment-catalogue/sales/finance-lifecycle/accounts/6/collections",
      body: {},
    },
    { connection, requireSelection: true }
  );

  assert.equal(scope.independentFinance, true);
  assert.equal(scope.allLocations, true);
  assert.equal(scope.locationId, null);
  assert.equal(scope.financeRecordReference, 6);
  assert.equal(scope.equipmentOriginReference, true);
});

test("unknown Finance lifecycle agreement remains blocked", async () => {
  const connection = {
    async query() {
      return [[], []];
    },
  };

  await assert.rejects(
    () =>
      resolveIndependentFinanceScope(
        {
          method: "POST",
          originalUrl: "/api/equipment-catalogue/sales/finance-lifecycle/accounts/999999/collections",
          body: {},
        },
        { connection, requireSelection: true }
      ),
    (error) => {
      assert.equal(error.code, "FINANCE_RECORD_SCOPE_REQUIRED");
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});
