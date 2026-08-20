const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const readRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceApplicationReadRoutes.js"
);
const parentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const legacyRoutes = read(
  "backend",
  "routes",
  "equipmentCreditApplicationRoutes.js"
);
const applicationsPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);

test("company-wide application reads execute before every legacy application handler", () => {
  assert.match(
    parentRoutes,
    /require\("\.\/equipmentFinanceApplicationReadRoutes"\)/
  );
  const readMount = parentRoutes.indexOf(
    'router.use("/credit-applications", equipmentFinanceApplicationReadRoutes)'
  );
  assert.ok(readMount >= 0);
  for (const laterMount of [
    "router.use(equipmentFinanceRuntimeHotfixRoutes)",
    'router.use("/credit-applications", equipmentCreditOptionalDecisionRoutes)',
    'router.use("/credit-applications", equipmentFinanceDraftRecoveryRoutes)',
  ]) {
    assert.ok(
      readMount < parentRoutes.indexOf(laterMount),
      `${laterMount} must execute after company-wide application reads`
    );
  }
});

test("readiness has an exact owner and cannot fall into the generic application id route", () => {
  assert.match(readRoutes, /"\/readiness"/);
  assert.match(readRoutes, /EQUIPMENT_CREDIT_FOUNDATION_REQUIRED/);
  assert.match(readRoutes, /missing_tables/);
  assert.match(readRoutes, /missing_columns/);
  assert.match(readRoutes, /hire_location_selection_required: false/);
  assert.match(legacyRoutes, /router\.get\(\s*"\/readiness"/);
});

test("application register accepts the frontend all-status filter and returns its complete contract", () => {
  assert.match(readRoutes, /status === "all"/);
  assert.match(readRoutes, /router\.get\("\/", requirePermission/);
  assert.match(readRoutes, /applications,/);
  assert.match(readRoutes, /pagination:/);
  assert.match(readRoutes, /page_size:/);
  assert.match(readRoutes, /total_pages:/);
  assert.match(readRoutes, /summary:/);
  assert.match(readRoutes, /drafts:/);
  assert.match(readRoutes, /awaiting_review:/);
  assert.match(readRoutes, /approved:/);
  assert.match(readRoutes, /proposed_exposure:/);
  assert.match(readRoutes, /scope: "company_wide"/);
  assert.match(readRoutes, /list_contains_image_bytes: false/);
  assert.doesNotMatch(readRoutes, /SELECT\s+application\.\*/i);
  assert.doesNotMatch(readRoutes, /SELECT\s+\*/i);
});

test("protected application image loads separately from list metadata", () => {
  assert.match(readRoutes, /"\/:id\/image"/);
  assert.match(readRoutes, /Cache-Control", "private, no-store"/);
  assert.match(readRoutes, /imageFromDataUrl/);
  assert.match(readRoutes, /MAX_IMAGE_BYTES/);
  assert.match(readRoutes, /protected_image_endpoint/);
});

test("applications page requests readiness independently from its truthful list", () => {
  assert.match(applicationsPage, /useState\("all"\)/);
  assert.match(
    applicationsPage,
    /void axiosClient\s*\.get\(`\$\{API\}\/readiness`/
  );
  assert.match(
    applicationsPage,
    /const response = await axiosClient\.get\(API, \{\s*params,/
  );
  assert.doesNotMatch(applicationsPage, /Promise\.all\(\[/);
  assert.match(applicationsPage, /payload\.pagination/);
  assert.match(applicationsPage, /payload\.summary/);
  assert.match(applicationsPage, /payload\.status !== "success"/);
});
