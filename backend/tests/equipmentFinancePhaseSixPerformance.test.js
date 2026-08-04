const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const serviceSource = read(
  "backend",
  "services",
  "equipmentFinanceOperationalPolishService.js"
);
const routeSource = read(
  "backend",
  "routes",
  "equipmentFinanceOperationalPolishRoutes.js"
);
const frontendSource = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceOperationalPolishPage.jsx"
);
const applicationsFrontendSource = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);
const migrationSource = read(
  "database",
  "migrations",
  "20260803_equipment_finance_phase6_performance.sql"
);
const verifierSource = read(
  "database",
  "migrations",
  "20260803_equipment_finance_phase6_performance_verify.sql"
);
const packageSource = read("backend", "package.json");

const {
  normalizePagination,
} = require("../services/equipmentFinanceOperationalPolishService");
const {
  slowRequestThreshold,
} = require("../middleware/equipmentFinancePerformanceMiddleware");
const {
  EXPECTED_INDEXES,
  MIGRATION_RECORD,
  validateVerifierResults,
} = require("../scripts/runEquipmentFinancePhaseSixPerformanceStartup");
const {
  splitSqlScript,
} = require("../scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("Phase 6 case and inbox pagination is bounded server-side", () => {
  assert.deepEqual(normalizePagination({}, 25), { page: 1, pageSize: 25, offset: 0 });
  assert.deepEqual(normalizePagination({ page: 3, page_size: 40 }, 25), {
    page: 3,
    pageSize: 40,
    offset: 80,
  });
  assert.equal(normalizePagination({ page_size: 5000 }, 25).pageSize, 100);
  assert.match(serviceSource, /async function listCasesPage/);
  assert.match(serviceSource, /LIMIT \? OFFSET \?/);
  assert.match(routeSource, /page_size: req\.query\.page_size/);
  assert.match(routeSource, /pagination: casePage\.pagination/);
  assert.match(routeSource, /documents\/:documentId\/approval/);
});

test("data-quality checks are batched and selected cases never recalculate the portfolio", () => {
  const alertsBody = functionBody(serviceSource, "getDataQualityAlerts", "listInbox");
  assert.match(alertsBody, /loadAlertCaseFacts\(caseRows\)/);
  assert.doesNotMatch(alertsBody, /await resolveCaseIdentity/);
  assert.match(alertsBody, /equipment_finance_private_documents/);
  assert.doesNotMatch(alertsBody, /equipment_finance_case_documents/);

  const caseBody = functionBody(serviceSource, "getCaseOperations", "getOperationalBootstrap");
  assert.match(caseBody, /getDataQualityAlerts\(\{ cases: \[identity\], schemaReady: true \}\)/);
  assert.doesNotMatch(caseBody, /getDataQualityAlerts\(\)/);
  assert.doesNotMatch(caseBody, /listCaseDocuments/);
  assert.doesNotMatch(caseBody, /pool\.query/);
  assert.match(serviceSource, /issued_documents: issuedResult\[0\]\.filter/);
  assert.match(serviceSource, /ORDER BY payment\.payment_date DESC, payment\.id DESC/);
});

test("the operational inbox uses authoritative encrypted documents and bounded source queries", () => {
  const inboxBody = functionBody(serviceSource, "listInbox", "recordEvent");
  assert.match(inboxBody, /equipment_finance_private_documents/);
  assert.match(inboxBody, /review_status = 'pending'/);
  assert.match(inboxBody, /approval_status = 'pending'/);
  assert.ok((inboxBody.match(/LIMIT \?/g) || []).length >= 4);
  assert.match(inboxBody, /total_is_lower_bound/);
  assert.match(frontendSource, /kyc_identity/);
  assert.match(frontendSource, /agreement_attachment/);
  assert.match(frontendSource, /approval_status === "pending"/);
  assert.doesNotMatch(frontendSource, /buyer_id_front/);
});

test("case detail is lazy, cancellable and does not carry list image bytes", () => {
  assert.match(frontendSource, /CASE_TABS\.has\(tab\)/);
  assert.ok((frontendSource.match(/new AbortController\(\)/g) || []).length >= 2);
  assert.match(frontendSource, /signal: controller\.signal/);
  assert.match(serviceSource, /list_contains_image_bytes: false/);
  assert.match(applicationsFrontendSource, /IntersectionObserver/);
  assert.match(applicationsFrontendSource, /loading="lazy"/);
  assert.match(applicationsFrontendSource, /decoding="async"/);
  assert.match(
    applicationsFrontendSource,
    /void axiosClient\s*\.get\(`\$\{API\}\/readiness`/
  );
  assert.match(
    applicationsFrontendSource,
    /const response = await axiosClient\.get\(API/
  );
  assert.doesNotMatch(applicationsFrontendSource, /Promise\.all\(\[/);
  const listBody = functionBody(serviceSource, "listCasesPage", "listCases");
  assert.doesNotMatch(listBody, /asset\.main_image_url[,\s]/);
});

test("slow Finance requests emit structured, PII-minimized telemetry", () => {
  assert.equal(slowRequestThreshold({}), 1500);
  assert.equal(slowRequestThreshold({ EQUIPMENT_FINANCE_SLOW_REQUEST_MS: "800" }), 800);
  assert.equal(slowRequestThreshold({ EQUIPMENT_FINANCE_SLOW_REQUEST_MS: "10" }), 1500);
  const middlewareSource = read(
    "backend",
    "middleware",
    "equipmentFinancePerformanceMiddleware.js"
  );
  assert.match(middlewareSource, /equipment_finance_slow_request/);
  assert.match(middlewareSource, /req\.path/);
  assert.doesNotMatch(middlewareSource, /originalUrl|req\.query|req\.body/);
});

test("Phase 6 performance migration is additive, verified and Railway-gated", () => {
  assert.equal(MIGRATION_RECORD, "20260803_equipment_finance_phase6_performance");
  assert.equal(EXPECTED_INDEXES.size, 8);
  assert.match(migrationSource, /ADDITIVE MIGRATION ONLY/);
  assert.match(migrationSource, /BACKUP REQUIRED/);
  assert.doesNotMatch(migrationSource, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.equal(splitSqlScript(verifierSource).length, 3);
  assert.ok(splitSqlScript(migrationSource).length >= 13);
  assert.match(migrationSource, /buyer_id_front[\s\S]+kyc_identity/);
  assert.match(migrationSource, /signed_agreement[\s\S]+agreement_attachment/);
  const indexRows = [...EXPECTED_INDEXES].map(([key, indexed_columns]) => {
    const separator = key.lastIndexOf(".");
    return {
      TABLE_NAME: key.slice(0, separator),
      INDEX_NAME: key.slice(separator + 1),
      indexed_columns,
    };
  });
  assert.doesNotThrow(() =>
    validateVerifierResults([
      [{ migration_name: MIGRATION_RECORD }],
      indexRows,
      [{ misclassified_legacy_documents: 0 }],
    ])
  );
  assert.throws(
    () =>
      validateVerifierResults([
        [{ migration_name: MIGRATION_RECORD }],
        indexRows.slice(1),
        [{ misclassified_legacy_documents: 0 }],
      ]),
    /found 7 indexes instead of 8/
  );
  assert.throws(
    () =>
      validateVerifierResults([
        [{ migration_name: MIGRATION_RECORD }],
        indexRows,
        [{ misclassified_legacy_documents: 1 }],
      ]),
    /misclassified encrypted legacy documents/
  );
  assert.match(packageSource, /runEquipmentFinancePhaseSixPerformanceStartup\.js/);
});
