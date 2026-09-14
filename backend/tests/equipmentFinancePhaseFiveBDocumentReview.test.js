const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const migration = read(
  "database/migrations/20260802_equipment_finance_phase5b_document_review.sql"
);
const verifier = read(
  "database/migrations/20260802_equipment_finance_phase5b_document_review_verify.sql"
);
const phaseFiveARunner = read(
  "backend/scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js"
);
const runner = read(
  "backend/scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js"
);
const serviceSource = read(
  "backend/services/equipmentFinanceDocumentReviewService.js"
);
const routes = read(
  "backend/routes/equipmentFinanceDocumentReviewRoutes.js"
);
const independentRoutes = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const packageJson = JSON.parse(read("backend/package.json"));

const {
  requiredDocumentStatus,
} = require("../services/equipmentFinanceDocumentReviewService");

test("Phase 5B migration is additive and contains review decisions but no delivery tables", () => {
  assert.match(migration, /required_document_categories_json/);
  assert.match(migration, /independent_document_review_required/);
  assert.match(migration, /separate_document_approval_required/);
  assert.match(migration, /replacement_of_document_id/);
  assert.match(migration, /review_status/);
  assert.match(migration, /approval_status/);
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS equipment_finance_document_review_history/
  );
  assert.match(migration, /FIN-DOC-REVIEW-2/);
  assert.doesNotMatch(migration, /equipment_finance_delivery_authorizations/);
  assert.doesNotMatch(migration, /equipment_finance_delivery_confirmations/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test("required-document readiness needs approved KYC, guarantor and agreement evidence", () => {
  const policy = {
    required_document_categories: [
      "kyc_identity",
      "guarantor_identity",
      "agreement_attachment",
    ],
  };
  const partial = requiredDocumentStatus(policy, [
    {
      document_category: "kyc_identity",
      document_status: "active",
      review_status: "verified",
      approval_status: "approved",
    },
    {
      document_category: "guarantor_identity",
      document_status: "active",
      review_status: "verified",
      approval_status: "pending",
    },
  ]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, [
    "guarantor_identity",
    "agreement_attachment",
  ]);

  const complete = requiredDocumentStatus(policy, [
    ...policy.required_document_categories.map((document_category) => ({
      document_category,
      document_status: "active",
      review_status: "verified",
      approval_status: "approved",
    })),
    {
      document_category: "kyc_identity",
      document_status: "archived",
      review_status: "verified",
      approval_status: "approved",
    },
  ]);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);
});

test("uploader, reviewer and approver are enforced as independent actors", () => {
  assert.match(
    serviceSource,
    /uploaded a document cannot independently review it/
  );
  assert.match(
    serviceSource,
    /FINANCE_DOCUMENT_INDEPENDENT_REVIEW_REQUIRED/
  );
  assert.match(
    serviceSource,
    /approver must be different from both uploader and reviewer/
  );
  assert.match(
    serviceSource,
    /FINANCE_DOCUMENT_INDEPENDENT_APPROVAL_REQUIRED/
  );
  assert.match(
    serviceSource,
    /Only an independently verified document can be approved/
  );
  assert.match(serviceSource, /FINANCE_DOCUMENT_REVIEW_REQUIRED/);
  assert.match(serviceSource, /LIMIT 1 FOR UPDATE/);
});

test("every decision is preserved in history, case activity and the global audit trail", () => {
  assert.match(
    serviceSource,
    /INSERT INTO equipment_finance_document_review_history/
  );
  assert.match(serviceSource, /document_verified/);
  assert.match(serviceSource, /document_review_rejected/);
  assert.match(serviceSource, /document_approved/);
  assert.match(serviceSource, /document_approval_rejected/);
  assert.match(serviceSource, /document_archived/);
  assert.match(serviceSource, /recordActivity\(/);
  assert.match(serviceSource, /document_checksum/);
  assert.match(serviceSource, /policy_version/);
  assert.doesNotMatch(serviceSource, /DELETE\s+FROM/i);
});

test("review, approval and archive routes have explicit role, permission and rate-limit guards", () => {
  assert.match(routes, /require\("express-rate-limit"\)/);
  assert.match(routes, /reviewReadLimiter/);
  assert.match(routes, /reviewDecisionLimiter/);
  assert.match(routes, /approvalDecisionLimiter/);
  assert.match(routes, /max:\s*240/);
  assert.match(routes, /max:\s*60/);
  assert.match(routes, /max:\s*40/);
  assert.match(
    routes,
    /router\.post\(\s*"\/documents\/:documentId\/review",\s*reviewDecisionLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/documents\/:documentId\/approval",\s*approvalDecisionLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/documents\/:documentId\/archive",\s*approvalDecisionLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(routes, /DOCUMENT_REVIEW_ROLES/);
  assert.match(routes, /DOCUMENT_APPROVAL_ROLES/);
  assert.doesNotMatch(routes, /delivery-authorizations/);
  assert.doesNotMatch(routes, /delivery-confirmations/);
});

test("Phase 5A startup verifies vault invariants across later policy upgrades without editing released SQL", () => {
  assert.match(
    phaseFiveARunner,
    /applyForwardCompatiblePolicyVerification/
  );
  assert.match(phaseFiveARunner, /policy_version IS NOT NULL/);
  assert.match(
    phaseFiveARunner,
    /allowed_document_categories_json IS NOT NULL/
  );
  assert.match(phaseFiveARunner, /allowed_mime_types_json IS NOT NULL/);
  assert.match(phaseFiveARunner, /maximum_file_size_bytes > 0/);
  assert.match(phaseFiveARunner, /normalized\[2\] = \[policyRow/);
});

test("Phase 5B verifier and Railway gate fail closed on invalid independent decisions", () => {
  assert.match(verifier, /missing_review_columns/);
  assert.match(verifier, /missing_history_table/);
  assert.match(verifier, /invalid_review_policy/);
  assert.match(verifier, /invalid_document_decisions/);
  assert.match(verifier, /reviewed_by = uploaded_by/);
  assert.match(verifier, /approved_by = uploaded_by/);
  assert.match(verifier, /approved_by = reviewed_by/);
  assert.match(runner, /chalin03:equipment-finance:phase5b-document-review/);
  assert.match(runner, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runner, /GET_LOCK/);
  assert.match(runner, /RELEASE_LOCK/);
  assert.match(runner, /validateVerifierResults/);
  assert.match(runner, /process\.exit\(1\)/);
});

test("Phase 5B review layer mounts after the encrypted vault and remains ordered in controlled maintenance", () => {
  assert.match(
    independentRoutes,
    /router\.use\("\/private-documents", equipmentFinancePrivateDocumentsRoutes\);[\s\S]*router\.use\("\/private-documents", equipmentFinanceDocumentReviewRoutes\);/
  );
  assert.match(independentRoutes, /private_document_review_enabled:\s*true/);
  assert.match(
    independentRoutes,
    /separate_document_approval_enabled:\s*true/
  );
  assert.doesNotMatch(routes, /delivery-authorizations/);
  assert.doesNotMatch(routes, /delivery-confirmations/);
  assert.doesNotMatch(serviceSource, /INSERT INTO equipment_deliveries/);
  assert.doesNotMatch(
    serviceSource,
    /equipment_finance_delivery_confirmations/
  );

  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseFiveA = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js"
  );
  const phaseFiveB = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveBDocumentReviewStartup.js"
  );
  assert.ok(phaseFiveA >= 0 && phaseFiveB > phaseFiveA);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase5b:production"],
    "node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js"
  );
});
