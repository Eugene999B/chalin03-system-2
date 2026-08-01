const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const migration = read("database/migrations/20260801_equipment_finance_phase5_documents_delivery.sql");
const verifier = read("database/migrations/20260801_equipment_finance_phase5_documents_delivery_verify.sql");
const runner = read("backend/scripts/runEquipmentFinancePhaseFiveStartup.js");
const service = read("backend/services/equipmentFinanceDocumentsDeliveryService.js");
const routes = read("backend/routes/equipmentFinanceDocumentsDeliveryRoutes.js");
const deliveryRoutes = read("backend/routes/equipmentFinancePhaseFiveDeliveryRoutes.js");
const independentRoutes = read("backend/routes/equipmentFinanceIndependentRoutes.js");
const packageJson = JSON.parse(read("backend/package.json"));

const requiredTables = [
  "equipment_finance_document_delivery_policy",
  "equipment_finance_document_delivery_policy_history",
  "equipment_finance_private_documents",
  "equipment_finance_delivery_authorizations",
  "equipment_finance_delivery_confirmations",
  "equipment_finance_case_activity",
];

test("Phase 5 migration is additive and stores private encrypted payloads instead of public URLs", () => {
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verifier, new RegExp(`'${table}'`));
  }
  assert.match(migration, /encrypted_payload LONGBLOB NOT NULL/);
  assert.match(migration, /encryption_iv VARBINARY\(12\) NOT NULL/);
  assert.match(migration, /encryption_tag VARBINARY\(16\) NOT NULL/);
  assert.match(migration, /content_checksum CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /file_url/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test("private documents use authenticated AES-256-GCM encryption and integrity checks", () => {
  assert.match(service, /crypto\.createCipheriv\("aes-256-gcm"/);
  assert.match(service, /cipher\.getAuthTag\(\)/);
  assert.match(service, /crypto\.createDecipheriv\("aes-256-gcm"/);
  assert.match(service, /decipher\.setAuthTag/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.match(service, /FINANCE_DOCUMENT_INTEGRITY_FAILED/);
  assert.match(service, /private_access_only:\s*true/);
  assert.doesNotMatch(service, /public_url/i);
});

test("private document uploads are explicitly rate limited before database access", () => {
  assert.match(routes, /require\("express-rate-limit"\)/);
  assert.match(routes, /const privateDocumentUploadLimiter = rateLimit\(/);
  assert.match(routes, /windowMs:\s*15 \* 60 \* 1000/);
  assert.match(routes, /max:\s*30/);
  assert.match(routes, /FINANCE_DOCUMENT_UPLOAD_RATE_LIMITED/);
  assert.match(
    routes,
    /router\.post\(\s*"\/cases\/:agreementId\/documents",\s*privateDocumentUploadLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
});

test("document review and approval require independent actors", () => {
  assert.match(service, /uploaded_by[\s\S]*cannot independently review/i);
  assert.match(service, /FINANCE_DOCUMENT_INDEPENDENT_REVIEW_REQUIRED/);
  assert.match(service, /document\.uploaded_by, document\.reviewed_by/);
  assert.match(service, /FINANCE_DOCUMENT_INDEPENDENT_APPROVAL_REQUIRED/);
  assert.match(routes, /DOCUMENT_REVIEW_ROLES/);
  assert.match(routes, /DOCUMENT_APPROVAL_ROLES/);
  assert.match(routes, /uploader_cannot_review:\s*true/);
  assert.match(routes, /uploader_or_reviewer_cannot_approve:\s*true/);
});

test("delivery requires a separate request, authorization and physical confirmer", () => {
  assert.match(service, /requested_by[\s\S]*cannot authorize it/i);
  assert.match(service, /FINANCE_DELIVERY_INDEPENDENT_AUTHORIZER_REQUIRED/);
  assert.match(service, /authorized_by[\s\S]*cannot also confirm/i);
  assert.match(service, /FINANCE_DELIVERY_INDEPENDENT_CONFIRMATION_REQUIRED/);
  assert.match(service, /FINANCE_DELIVERY_AUTHORIZATION_STALE/);
  assert.match(deliveryRoutes, /authorization_number/);
  assert.match(deliveryRoutes, /validateDeliveryAuthorization/);
  assert.match(deliveryRoutes, /completeDeliveryAuthorization/);
  assert.match(service, /authorization_status = 'consumed'/);
  assert.match(deliveryRoutes, /EQUIPMENT_FINANCE_DELIVERY_COMPLETED/);
});

test("the existing lifecycle delivery URL is intercepted before the legacy final lifecycle router", () => {
  assert.match(
    independentRoutes,
    /router\.use\("\/finance-lifecycle", equipmentFinancePhaseFiveDeliveryRoutes\)/
  );
  const overrideIndex = independentRoutes.indexOf(
    'router.use("/finance-lifecycle", equipmentFinancePhaseFiveDeliveryRoutes)'
  );
  const readinessIndex = independentRoutes.indexOf(
    'router.use("/finance-lifecycle", async (_req, res, next)'
  );
  assert.ok(overrideIndex >= 0 && readinessIndex > overrideIndex);
  assert.match(deliveryRoutes, /router\.post\(\s*"\/accounts\/:agreementId\/delivery"/);
});

test("Phase 5 writes an append-only activity record and the global audit trail for protected actions", () => {
  assert.match(service, /INSERT INTO equipment_finance_case_activity/);
  assert.match(service, /writeAuditEvent\(/);
  assert.match(service, /document_uploaded/);
  assert.match(service, /document_downloaded/);
  assert.match(service, /document_verified/);
  assert.match(service, /document_approved/);
  assert.match(service, /delivery_authorization_requested/);
  assert.match(service, /delivery_authorized/);
  assert.match(service, /delivery_confirmed/);
  assert.doesNotMatch(routes, /router\.(delete|patch)\([^\n]*activity/i);
});

test("staff capabilities are explicit and all private endpoints retain server permission guards", () => {
  assert.match(routes, /DOCUMENT_UPLOAD_ROLES/);
  assert.match(routes, /PRIVATE_DOCUMENT_VIEW_ROLES/);
  assert.match(routes, /DELIVERY_REQUEST_ROLES/);
  assert.match(routes, /DELIVERY_AUTHORIZATION_ROLES/);
  assert.match(routes, /DELIVERY_CONFIRMATION_ROLES/);
  assert.match(routes, /router\.get\(\s*"\/capabilities"/);
  assert.ok((routes.match(/requirePermission\("fleet\.assets\.(view|manage)"\)/g) || []).length >= 12);
});

test("Railway startup runs the Phase 5 migration after Phase 4 and before the API", () => {
  assert.match(runner, /chalin03:equipment-finance:phase5/);
  assert.match(runner, /information_schema\.TABLES/);
  assert.match(runner, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runner, /GET_LOCK/);
  assert.match(runner, /RELEASE_LOCK/);
  assert.match(runner, /validatePhaseFiveSchema/);
  const start = packageJson.scripts.start;
  const phaseFour = start.indexOf("runEquipmentFinancePhaseFourStartup.js");
  const phaseFive = start.indexOf("runEquipmentFinancePhaseFiveStartup.js");
  const server = start.indexOf("server.js");
  assert.ok(phaseFour >= 0 && phaseFive > phaseFour && server > phaseFive);
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase5:production"],
    "node scripts/runEquipmentFinancePhaseFiveStartup.js"
  );
});
