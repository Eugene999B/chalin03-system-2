const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const independent = read("backend", "routes", "equipmentFinanceIndependentRoutes.js");
const workflow = read("backend", "routes", "equipmentFinancePhaseThreeWorkflowRoutes.js");
const creationGuard = read(
  "backend",
  "routes",
  "equipmentFinancePhaseThreeCreationGuardRoutes.js"
);
const creation = read("backend", "routes", "equipmentFinanceImageSafeStartRoutes.js");
const operationalStartup = read(
  "backend",
  "scripts",
  "runEquipmentFinanceOperationalPolishStartup.js"
);
const migration = read(
  "database",
  "migrations",
  "20260804_equipment_finance_phase3_application_pipeline.sql"
);
const verifier = read(
  "database",
  "migrations",
  "20260804_equipment_finance_phase3_application_pipeline_verify.sql"
);
const packageJson = JSON.parse(read("backend", "package.json"));

const {
  FinanceWorkflowError,
  classifyFinanceWorkflowError,
} = require("../routes/equipmentFinancePhaseThreeWorkflowRoutes");
const {
  validateVerifierResults,
} = require("../scripts/runEquipmentFinancePhaseThreeApplicationStartup");

function classified(code, message = "") {
  return classifyFinanceWorkflowError({ code, message });
}

test("Phase 3 owns the application lifecycle before every legacy route", () => {
  assert.match(
    independent,
    /require\("\.\/equipmentFinancePhaseThreeWorkflowRoutes"\)/
  );
  assert.match(
    independent,
    /require\("\.\/equipmentFinancePhaseThreeCreationGuardRoutes"\)/
  );
  const phase3 = independent.indexOf("router.use(equipmentFinancePhaseThreeWorkflowRoutes)");
  const guard = independent.indexOf(
    "router.use(equipmentFinancePhaseThreeCreationGuardRoutes)"
  );
  const critical = independent.indexOf("router.use(equipmentFinanceCriticalEntryRoutes)");
  const start = independent.indexOf("router.use(equipmentFinanceImageSafeStartRoutes)");
  const legacyRead = independent.indexOf(
    'router.use("/credit-applications", equipmentFinanceApplicationReadRoutes)'
  );
  const legacyDecision = independent.indexOf(
    'router.use("/credit-applications", equipmentCreditOptionalDecisionRoutes)'
  );
  assert.ok(phase3 >= 0 && guard >= 0);
  assert.ok(phase3 < critical);
  assert.ok(guard < start);
  assert.ok(phase3 < legacyRead);
  assert.ok(phase3 < legacyDecision);
});

test("register uses bounded count, summary and page queries without windows", () => {
  assert.doesNotMatch(workflow, /\bOVER\s*\(/i);
  assert.match(workflow, /SELECT COUNT\(application\.id\) AS total/);
  assert.match(workflow, /AS drafts/);
  assert.match(workflow, /LIMIT \? OFFSET \?/);
  assert.match(workflow, /query_plan: \["count", "summary", "page"\]/);
  assert.match(workflow, /window_functions_required: false/);
  assert.match(workflow, /LEFT JOIN hire_customers/);
  assert.match(workflow, /LEFT JOIN equipment_sales_quotations/);
  assert.match(workflow, /LEFT JOIN fleet_assets/);
  assert.match(workflow, /orphaned_join_records_remain_visible: true/);
  assert.match(workflow, /const QUERY_TIMEOUT_MS = 8000/);
  assert.match(workflow, /acquireConnection\(CONNECTION_TIMEOUT_MS\)/);
});

test("detail, submit and manager review are one company-wide bounded authority", () => {
  assert.match(workflow, /"\/credit-applications\/:id"/);
  assert.match(workflow, /"\/credit-applications\/:id\/submit"/);
  assert.match(workflow, /"\/credit-applications\/:id\/review"/);
  assert.match(workflow, /\$\{lock \? "FOR UPDATE" : ""\}/);
  assert.ok((workflow.match(/loadApplicationRecord\(connection, applicationId, true\)/g) || []).length >= 2);
  assert.match(workflow, /decision_version = \?/);
  assert.match(workflow, /EQUIPMENT_CREDIT_DECISION_VERSION_CONFLICT/);
  assert.match(workflow, /application_status = 'submitted'/);
  assert.match(workflow, /transition\.to/);
  assert.match(workflow, /hire_location_selection_required: false/);
  assert.match(workflow, /detail_contains_image_bytes: false/);
  assert.match(workflow, /main_image_url: null/);
  assert.doesNotMatch(workflow, /asset\.main_image_url\s+AS\s+main_image_url/i);
});

test("audit is outside committed submission and review transactions", () => {
  const submissionStart = workflow.indexOf('"/credit-applications/:id/submit"');
  const reviewStart = workflow.indexOf('"/credit-applications/:id/review"');
  const submissionSection = workflow.slice(submissionStart, reviewStart);
  const reviewSection = workflow.slice(reviewStart);
  assert.ok(
    submissionSection.indexOf("await connection.commit()") <
      submissionSection.indexOf("writeWorkflowAudit(")
  );
  assert.ok(
    reviewSection.indexOf("await connection.commit()") <
      reviewSection.indexOf("writeWorkflowAudit(")
  );
  assert.match(workflow, /AUDIT_TIMEOUT_MS = 3000/);
  assert.match(workflow, /must never be rolled back by audit failure/);
});

test("creation guard verifies schema, enums and linked records before writes", () => {
  assert.match(creationGuard, /inspectWorkflowSchema\(connection\)/);
  assert.match(creationGuard, /invalidWorkflowEnums\(connection\)/);
  assert.match(creationGuard, /FINANCE_LOCATION_NULLABILITY_REQUIRED/);
  assert.match(creationGuard, /FINANCE_WORKFLOW_ENUM_REQUIRED/);
  assert.match(creationGuard, /FINANCE_FOREIGN_KEY_CONFLICT/);
  assert.match(creationGuard, /SELECT id FROM fleet_assets/);
  assert.match(creationGuard, /SELECT id FROM hire_customers/);
  assert.match(creation, /ER_DUP_ENTRY/);
  assert.match(creation, /transactionActive/);
  assert.match(creation, /main_image_url_snapshot: null/);
});

test("safe database failures are specific and retryable only when appropriate", () => {
  const cases = [
    ["ER_NO_SUCH_TABLE", "FINANCE_APPLICATION_TABLE_MISSING", 503],
    ["ER_BAD_FIELD_ERROR", "FINANCE_APPLICATION_COLUMN_MISSING", 503],
    ["ER_NO_REFERENCED_ROW_2", "FINANCE_FOREIGN_KEY_CONFLICT", 409],
    ["ER_DUP_ENTRY", "DUPLICATE_FINANCE_WORKFLOW_RECORD", 409],
    ["WARN_DATA_TRUNCATED", "FINANCE_WORKFLOW_ENUM_REQUIRED", 503],
    ["ETIMEDOUT", "FINANCE_WORKFLOW_TIMEOUT", 503],
  ];
  for (const [input, expectedCode, expectedStatus] of cases) {
    const error = classified(input);
    assert.ok(error instanceof FinanceWorkflowError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.statusCode, expectedStatus);
  }
  const nullability = classified(
    "ER_BAD_NULL_ERROR",
    "Column 'hire_location_id' cannot be null"
  );
  assert.equal(nullability.code, "FINANCE_LOCATION_NULLABILITY_REQUIRED");
});

test("Phase 3 migration is additive and startup verified", () => {
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.match(migration, /finance_phase3_add_column_if_missing/);
  assert.match(migration, /finance_phase3_make_location_nullable/);
  assert.match(migration, /finance_phase3_add_index_if_missing/);
  assert.match(migration, /20260804_equipment_finance_phase3_application_pipeline/);
  assert.match(verifier, /missing_phase3_tables/);
  assert.match(verifier, /missing_phase3_columns/);
  assert.match(verifier, /invalid_phase3_location_nullability/);
  assert.match(verifier, /invalid_phase3_workflow_enums/);
  assert.match(verifier, /missing_phase3_indexes/);
  assert.match(verifier, /phase3_migration_record_missing/);
  assert.match(
    packageJson.scripts["maintenance:legacy-startup-repairs"],
    /runEquipmentFinanceOperationalPolishStartup\.js/
  );
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runEquipmentFinancePhaseThreeApplicationStartup\.js/
  );
  assert.match(
    operationalStartup,
    /runEquipmentFinancePhaseThreeApplicationStartup/
  );
  assert.ok(
    operationalStartup.indexOf("await runEquipmentFinancePhaseThreeApplicationStartup();") <
      operationalStartup.indexOf("const state = await inspectAndVerifyAppliedRelease();")
  );
});

test("Phase 3 verifier refuses any non-zero production problem", () => {
  const healthy = [
    [{ missing_phase3_tables: 0 }],
    [{ missing_phase3_columns: 0 }],
    [{ invalid_phase3_location_nullability: 0 }],
    [{ invalid_phase3_workflow_enums: 0 }],
    [{ missing_phase3_indexes: 0 }],
    [{ phase3_migration_record_missing: 0 }],
  ];
  assert.equal(validateVerifierResults(healthy), true);
  const broken = structuredClone(healthy);
  broken[3][0].invalid_phase3_workflow_enums = 1;
  assert.throws(
    () => validateVerifierResults(broken),
    /invalid_phase3_workflow_enums=1/
  );
});
