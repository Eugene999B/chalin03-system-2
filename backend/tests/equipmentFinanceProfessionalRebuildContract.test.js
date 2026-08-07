const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const lifecycleRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceFinalLifecycleRoutes.js"
);
const integrityMiddleware = read(
  "backend",
  "middleware",
  "equipmentCatalogueIntegrityMiddleware.js"
);

test("one authoritative router owns Finance lifecycle accounts", () => {
  assert.doesNotMatch(
    independentRoutes,
    /router\.get\(\s*"\/finance-lifecycle\/accounts"/
  );
  assert.match(lifecycleRoutes, /router\.get\("\/accounts"/);
  assert.match(lifecycleRoutes, /assertSchemaReady\(\)/);
  assert.match(lifecycleRoutes, /EQUIPMENT_FINANCE_FINAL_LIFECYCLE_FOUNDATION_REQUIRED/);
  assert.match(
    integrityMiddleware,
    /equipmentFinanceIndependentRoutes\(req, res[\s\S]*equipmentSalesRoutes\(req, res/
  );
});

test("the Finance redesign remains additive and preserves existing records", () => {
  assert.doesNotMatch(
    independentRoutes,
    /DELETE\s+FROM\s+(equipment_sale_agreements|equipment_sale_payments|equipment_installment_schedule)/i
  );
  assert.match(independentRoutes, /scope: "company_wide"/);
  assert.match(independentRoutes, /machine_active_hire_check_enabled: true/);
});
