const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const parent = read("backend/routes/equipmentFinanceIndependentRoutes.js");
const critical = read("backend/routes/equipmentFinanceCriticalEntryRoutes.js");
const start = read("backend/routes/equipmentFinanceImageSafeStartRoutes.js");
const excavators = read("frontend/src/pages/EquipmentFinanceExcavatorsPage.jsx");
const applications = read("frontend/src/pages/EquipmentFinanceApplicationsPage.jsx");

test("critical Finance entry routes own bootstrap, register and creation first", () => {
  assert.match(parent, /require\("\.\/equipmentFinanceCriticalEntryRoutes"\)/);
  assert.match(parent, /require\("\.\/equipmentFinanceImageSafeStartRoutes"\)/);
  const criticalIndex = parent.indexOf("router.use(equipmentFinanceCriticalEntryRoutes)");
  const safeStartIndex = parent.indexOf("router.use(equipmentFinanceImageSafeStartRoutes)");
  const applicationIndex = parent.indexOf(
    'router.use("/credit-applications", equipmentFinanceApplicationReadRoutes)'
  );
  const legacyIndex = parent.indexOf("router.use(equipmentFinancePhaseOneRoutes)");
  assert.ok(criticalIndex >= 0);
  assert.ok(safeStartIndex > criticalIndex);
  assert.ok(applicationIndex > safeStartIndex);
  assert.ok(legacyIndex > applicationIndex);
});

test("bootstrap is bounded, partial and contains only signed image references", () => {
  assert.match(critical, /CONNECTION_TIMEOUT_MS = 5000/);
  assert.match(critical, /QUERY_TIMEOUT_MS = 6000/);
  assert.match(critical, /CUSTOMER_LIMIT = 80/);
  assert.match(critical, /MACHINE_LIMIT = 80/);
  assert.match(critical, /Promise\.allSettled/);
  assert.match(critical, /signedImageUrl/);
  assert.match(critical, /crypto\.timingSafeEqual/);
  assert.match(critical, /list_contains_image_bytes: false/);
  assert.match(critical, /signed_machine_images: true/);
  assert.doesNotMatch(
    critical,
    /SELECT[^;]+media\.file_url[^;]+FROM equipment_media/is
  );
});

test("excavator register receives actual signed photos instead of only the symbol", () => {
  assert.match(excavators, /const BOOTSTRAP_API =/);
  assert.match(excavators, /machine\.main_image_url/);
  assert.match(excavators, /machine\.media/);
  assert.match(critical, /main_image_url:\s*primary\?\.file_url/);
  assert.match(critical, /file_url: signedImageUrl/);
  assert.match(critical, /\/phase-one\/machine-image\/:assetId\/:photoId/);
});

test("Applications and Approvals list uses one bounded register query", () => {
  assert.match(critical, /"\/credit-applications"/);
  assert.match(critical, /COUNT\(\*\) OVER\(\) AS total_count/);
  assert.match(critical, /LIMIT \? OFFSET \?/);
  assert.match(critical, /critical_read_path: true/);
  assert.match(applications, /FINANCE_APPLICATION_PATH|credit-applications/);
});

test("installment creation never loads or snapshots machine photo bytes", () => {
  assert.match(start, /SELECT asset\.id, asset\.asset_code, asset\.asset_name/);
  assert.doesNotMatch(start, /SELECT asset\.\*/);
  assert.doesNotMatch(start, /asset\.main_image_url/);
  assert.match(start, /main_image_url_snapshot: null/);
  assert.match(start, /machine_photo_bytes_loaded: false/);
  assert.match(start, /machine_photo_snapshot_stored: false/);
  assert.match(start, /QUERY_TIMEOUT_MS = 10000/);
  assert.match(start, /acquireConnection\(7000\)/);
});

test("all number generation finishes before the creation transaction begins", () => {
  const transactionIndex = start.indexOf("await connection.beginTransaction()");
  const applicationNumberIndex = start.indexOf(
    'documentNumber("EQUIPMENT_CREDIT_APPLICATION"'
  );
  const offerNumberIndex = start.indexOf(
    'documentNumber("EQUIPMENT_SALES_QUOTATION"'
  );
  assert.ok(applicationNumberIndex >= 0 && applicationNumberIndex < transactionIndex);
  assert.ok(offerNumberIndex >= 0 && offerNumberIndex < transactionIndex);
  const createCustomerBody = start.slice(
    start.indexOf("async function createCustomer"),
    start.indexOf("async function financeMachine")
  );
  assert.doesNotMatch(createCustomerBody, /documentNumber\(/);
});
