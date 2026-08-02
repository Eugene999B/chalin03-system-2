const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(backendDir, "routes", "equipmentFinanceExportPeriodRoutes.js"),
  "utf8"
);
const independentSource = fs.readFileSync(
  path.join(backendDir, "routes", "equipmentFinanceIndependentRoutes.js"),
  "utf8"
);
const {
  dateRange,
  displayDate,
  periodLabel,
} = require("../routes/equipmentFinanceExportPeriodRoutes");

test("auditor-selected dates are displayed in day-month-year order", () => {
  assert.equal(displayDate("2026-07-01"), "01-07-2026");
  assert.equal(displayDate("2026-07-30"), "30-07-2026");
  assert.equal(
    periodLabel({ date_from: "2026-07-01", date_to: "2026-07-30" }),
    "01-07-2026 to 30-07-2026"
  );
});

test("the selected report period is preserved and reversed periods fail closed", () => {
  assert.deepEqual(
    dateRange({ query: { date_from: "2026-07-01", date_to: "2026-07-30" } }),
    { date_from: "2026-07-01", date_to: "2026-07-30" }
  );
  assert.throws(
    () => dateRange({ query: { date_from: "2026-07-30", date_to: "2026-07-01" } }),
    /start date cannot be after the end date/i
  );
});

test("management CSV filters database rows by the exact selected period", () => {
  assert.match(routeSource, /DATE\(esa\.created_at\) BETWEEN \? AND \?/);
  assert.match(routeSource, /period\.date_from, period\.date_to/);
  assert.match(routeSource, /Selected Period/);
  assert.match(routeSource, /Date From/);
  assert.match(routeSource, /Date To/);
  assert.match(routeSource, /X-Report-Date-From/);
  assert.match(routeSource, /X-Report-Date-To/);
  assert.doesNotMatch(
    routeSource,
    /equipment-sales-report-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}/
  );
});

test("accounting CSV and Excel show the selected period separately from generation time", () => {
  assert.match(routeSource, /Equipment Finance Accounting Journal/);
  assert.match(routeSource, /SELECTED PERIOD:/);
  assert.match(routeSource, /Date From:/);
  assert.match(routeSource, /Date To:/);
  assert.match(routeSource, /Generated At:/);
  assert.match(routeSource, /sheet\.getCell\("A2"\)/);
  assert.match(routeSource, /sheet\.autoFilter = \{ from: "A6", to: "K6" \}/);
});

test("period-aware exports execute before legacy and original Phase 6 exports", () => {
  const periodIndex = independentSource.indexOf(
    "router.use(equipmentFinanceExportPeriodRoutes)"
  );
  const phaseSixIndex = independentSource.indexOf(
    "router.use(equipmentFinancePhaseSixRoutes)"
  );
  assert.ok(periodIndex >= 0, "period-aware export router must be mounted");
  assert.ok(
    periodIndex < phaseSixIndex,
    "period-aware export router must execute before original Phase 6 export routes"
  );
});
