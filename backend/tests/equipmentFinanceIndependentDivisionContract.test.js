const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const scope = read("backend", "services", "hireLocationScope.js");
const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const integrityMiddleware = read(
  "backend",
  "middleware",
  "equipmentCatalogueIntegrityMiddleware.js"
);
const hireRoutes = read("backend", "routes", "equipmentHireRoutes.js");
const lifecycleRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceFinalLifecycleRoutes.js"
);

const frontendContext = read("frontend", "src", "context", "WorkspaceContext.jsx");
const axiosClient = read("frontend", "src", "api", "axiosClient.js");
const financeLayout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);

function position(source, expression, label) {
  const index = source.search(expression);
  assert.notEqual(index, -1, `${label} was not found`);
  return index;
}

test("Finance requests run before the shared legacy sales router", () => {
  const independentPosition = position(
    integrityMiddleware,
    /equipmentFinanceIndependentRoutes\(req, res/,
    "independent Finance router"
  );
  const sharedPosition = position(
    integrityMiddleware,
    /equipmentSalesRoutes\(req, res/,
    "shared equipment sales router"
  );

  assert.ok(independentPosition < sharedPosition);
  assert.match(integrityMiddleware, /req\.url = req\.url\.replace\(\/\^\\\/sales/);
});

test("Finance scope derives internal origin from its own records", () => {
  assert.match(scope, /FINANCE_DIVISION_HEADER = "installment_finance"/);
  assert.match(scope, /hasEquipmentDivisionAccess/);
  assert.match(scope, /resolveIndependentFinanceScope/);
  assert.match(scope, /equipment_credit_applications/);
  assert.match(scope, /equipment_sale_agreements/);
  assert.match(scope, /equipment_sales_quotations/);
  assert.match(scope, /fleet_assets/);
  assert.match(scope, /independentFinance: true/);
  assert.match(scope, /equipmentOriginReference/);
  assert.doesNotMatch(
    scope,
    /isFinanceDivisionRequest[\s\S]*userHasHireLocationAccess\(/
  );
});

test("Finance is company-wide but active Hire machine safety remains", () => {
  assert.match(independentRoutes, /scope: "company_wide"/);
  assert.match(independentRoutes, /hire_location_selection_required: false/);
  assert.match(independentRoutes, /machine_active_hire_check_enabled: true/);
  assert.match(independentRoutes, /hire_asset\.status IN \('assigned','dispatched','active'\)/);
  assert.match(lifecycleRoutes, /EQUIPMENT_ACTIVE_ON_HIRE/);
  assert.match(lifecycleRoutes, /active_hire_count/);
});

test("automatic Finance SMS remains fail-closed", () => {
  assert.match(independentRoutes, /automatic_sms_enabled: false/);
  assert.match(independentRoutes, /FINANCE_AUTOMATIC_REMINDERS_DISABLED/);
  assert.match(independentRoutes, /Automatic installment reminders are disabled/);
  assert.doesNotMatch(independentRoutes, /sendSmsAlertToPhone|sendManualInstallmentReminder/);
});

test("Hire operations keep their original location-scoped logic", () => {
  assert.match(hireRoutes, /resolveHireLocationScope/);
  assert.match(hireRoutes, /selectedHireLocationId\(req\)/);
  assert.match(hireRoutes, /hire_location_id = \?/);
  assert.match(scope, /Choose an Equipment Hire location before continuing/);
  assert.match(scope, /user_hire_location_access/);
});

test("Finance UI no longer sends or displays Hire location context", () => {
  assert.match(frontendContext, /Company-wide Finance portfolio/);
  assert.match(frontendContext, /isManagedWorkspace: false/);
  assert.match(frontendContext, /equipment_installment_finance/);
  assert.match(axiosClient, /X-Chalin03-Division/);
  assert.match(axiosClient, /"installment_finance"/);
  assert.match(axiosClient, /financeScreen[\s\S]*workspaceContextId/);
  assert.match(financeLayout, /workspaceCode="equipment_installment_finance"/);
  assert.match(financeLayout, /Finance staff do not select Hire locations/);
  assert.match(financeLayout, /No access to Hire jobs or contracts/);
});
