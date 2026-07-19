const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  calculateCardDates,
  formatEmployeeNumber,
  normalizeEmployeePrefix,
} = require("../services/workerIdentityService");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-D2 formats automatic employee numbers by workspace", () => {
  assert.equal(formatEmployeeNumber("ch 03", "spare_parts", 1), "CH03-SP-0001");
  assert.equal(formatEmployeeNumber("CH03", "mining", 12), "CH03-MN-0012");
  assert.equal(formatEmployeeNumber("CH03", "equipment_hire", 203), "CH03-EH-0203");
  assert.equal(normalizeEmployeePrefix(" company-03 "), "COMPANY03");
});

test("Release 3F-D2 calculates settings-driven card validity", () => {
  assert.deepEqual(calculateCardDates("2026-07-18", 24), {
    issueDate: "2026-07-18",
    expiryDate: "2028-07-18",
  });
});

test("Release 3F-D2 migration is additive and preserves worker data", () => {
  const migration = read(
    "database/migrations/20260718_release3fd2_worker_identity_cards.sql"
  );
  assert.match(migration, /worker_id_card_validity_months/);
  assert.match(migration, /worker_employee_number_prefix/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS worker_identity_sequences/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM worker_profiles/i);
});

test("Release 3F-D2 worker creation allocates identity and supports reissue", () => {
  const routes = read("backend/routes/workerProfileExpansionRoutes.js");
  assert.match(routes, /allocateWorkerIdentity/);
  assert.match(routes, /reissue-id-card/);
  assert.match(routes, /WORKER_ID_CARD_REISSUED/);
  assert.match(routes, /employee_number_is_automatic/);
});

test("Release 3F-D2 settings expose prefix and card lifespan", () => {
  const routes = read("backend/routes/settingsRoutes.js");
  const page = read("frontend/src/pages/UsersSettingsPage.jsx");
  assert.match(routes, /worker_id_card_validity_months/);
  assert.match(routes, /worker_employee_number_prefix/);
  assert.match(page, /Worker Identity Cards/);
  assert.match(page, /Card lifespan/);
  assert.match(page, /Employee number prefix/);
});

test("Release 3F-D2 PDF uses the backend logo and premium company branding", () => {
  const printRoutes = read("backend/routes/workerPrintRoutes.js");
  assert.match(printRoutes, /backend[\\/]assets|assets[\\/]chalin03-logo\.png|"assets",\s*"chalin03-logo\.png"/);
  assert.match(printRoutes, /OFFICIAL PERSONNEL IDENTIFICATION/);
  assert.match(printRoutes, /data\.company\.name\.toUpperCase\(\)/);
  assert.match(printRoutes, /CHALIN 03/);
});


test("Release 3F-D2 skips matching legacy employee numbers and issues cards today", () => {
  const service = read("backend/services/workerIdentityService.js");
  const routes = read("backend/routes/workerProfileExpansionRoutes.js");
  assert.match(service, /FROM worker_profiles[\s\S]*WHERE employee_number = \?/);
  assert.match(service, /identityAllocated/);
  assert.match(routes, /allocateWorkerIdentity\(\s*connection,\s*workspaceCode,\s*new Date\(\)/);
});
