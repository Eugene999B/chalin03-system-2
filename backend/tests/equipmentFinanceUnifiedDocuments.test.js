const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const migration = read(
  "database/migrations/20260803_equipment_finance_phase5_unified_documents.sql"
);
const verifier = read(
  "database/migrations/20260803_equipment_finance_phase5_unified_documents_verify.sql"
);
const startupSource = read(
  "backend/scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js"
);
const privateService = read(
  "backend/services/equipmentFinancePrivateDocumentsService.js"
);
const privateRoutes = read(
  "backend/routes/equipmentFinancePrivateDocumentsRoutes.js"
);
const reviewService = read(
  "backend/services/equipmentFinanceDocumentReviewService.js"
);
const reviewRoutes = read(
  "backend/routes/equipmentFinanceDocumentReviewRoutes.js"
);
const deliveryService = read(
  "backend/services/equipmentFinanceDeliveryAuthorizationService.js"
);
const compatibilityRoutes = read(
  "backend/routes/equipmentFinanceOperationalPolishRoutes.js"
);
const workspacePage = read(
  "frontend/src/pages/EquipmentSalesWorkspacePage.jsx"
);
const documentPage = read(
  "frontend/src/pages/EquipmentFinanceCaseWorkspacePage.jsx"
);
const packageJson = JSON.parse(read("backend/package.json"));

const {
  encryptLegacyBuffer,
  normalizeLegacyCategory,
  splitSqlScript,
  validateVerifierResults,
} = require("../scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup");

test("unified document migration is additive and preserves both stores", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(migration, /BACKUP REQUIRED/i);
  assert.match(migration, /legacy_case_document_id/);
  assert.match(migration, /version_number/);
  assert.match(migration, /document_stage/);
  assert.match(migration, /MODIFY COLUMN agreement_id BIGINT NULL/);
  assert.match(migration, /UNIQUE INDEX `uq_finance_unified_legacy_document`/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /UPDATE\s+equipment_finance_case_documents/i);
  assert.doesNotMatch(verifier, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});

test("comment-aware SQL splitter keeps the migration and verifier complete", () => {
  const migrationStatements = splitSqlScript(migration);
  const verifierStatements = splitSqlScript(verifier);
  assert.ok(migrationStatements.length >= 15);
  assert.equal(verifierStatements.length, 5);
  assert.ok(migrationStatements.some((statement) => /CREATE PROCEDURE/.test(statement)));
  assert.ok(migrationStatements.some((statement) => /schema_migrations/.test(statement)));
  assert.throws(
    () => splitSqlScript("SELECT 1\nDELIMITER $$\n"),
    /before the previous statement was complete/i
  );
});

test("legacy plaintext bytes are encrypted with an integrity checksum", () => {
  const key = Buffer.alloc(32, 7);
  const original = Buffer.from("%PDF-1.7 preserved legacy Finance evidence");
  const encrypted = encryptLegacyBuffer(original, key);
  assert.notDeepEqual(encrypted.encrypted, original);
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.tag.length, 16);
  assert.equal(encrypted.checksum.length, 64);
  assert.equal(normalizeLegacyCategory("KYC Identity"), "kyc_identity");
  assert.equal(normalizeLegacyCategory("buyer_id_front"), "kyc_identity");
  assert.equal(normalizeLegacyCategory("proof_of_address"), "kyc_address");
  assert.equal(normalizeLegacyCategory("income_evidence"), "kyc_income");
  assert.equal(normalizeLegacyCategory("guarantor_id"), "guarantor_identity");
  assert.equal(normalizeLegacyCategory("signed_agreement"), "agreement_attachment");
  assert.equal(normalizeLegacyCategory("unknown legacy category"), "other");
  assert.match(startupSource, /original_record_preserved:\s*true/);
  assert.match(startupSource, /LEFT JOIN equipment_finance_private_documents/);
  assert.match(startupSource, /legacy_case_document_id/);
  assert.doesNotMatch(startupSource, /DELETE FROM equipment_finance_case_documents/i);
});

test("unified verifier fails closed for missing, unmapped, or invalid data", () => {
  const valid = [
    [{ migration_name: "20260803_equipment_finance_phase5_unified_documents" }],
    [{}, {}, {}, {}],
    [{ IS_NULLABLE: "YES" }, { IS_NULLABLE: "YES" }],
    [{ unmapped_legacy_documents: 0 }],
    [{ invalid_unified_document_links: 0 }],
  ];
  assert.doesNotThrow(() => validateVerifierResults(valid));
  assert.throws(
    () => validateVerifierResults([...valid.slice(0, 3), [{ unmapped_legacy_documents: 1 }], valid[4]]),
    /not fully mapped/i
  );
  assert.throws(
    () => validateVerifierResults([...valid.slice(0, 4), [{ invalid_unified_document_links: 1 }]]),
    /invalid case links/i
  );
});

test("application and agreement evidence use one encrypted authority", () => {
  assert.match(privateRoutes, /"\/applications"/);
  assert.match(privateRoutes, /"\/applications\/:applicationId\/documents"/);
  assert.match(reviewRoutes, /"\/application-review-cases\/:applicationId"/);
  assert.match(privateService, /equipment_finance_private_documents/);
  assert.match(privateService, /documentStage = "application"/);
  assert.match(privateService, /replacement_of_document_id/);
  assert.match(privateService, /FINANCE_DOCUMENT_REPLACEMENT_INVALID/);
  assert.match(reviewService, /listApplicationReviewDocuments/);
  assert.match(reviewService, /WHERE document\.application_id = \?/);
  assert.match(deliveryService, /listReviewDocuments/);
});

test("legacy operational endpoints are fenced into the encrypted authority", () => {
  assert.match(
    compatibilityRoutes,
    /require\("\.\.\/services\/equipmentFinancePrivateDocumentsService"\)/
  );
  assert.match(compatibilityRoutes, /loadAuthoritativeDocuments/);
  assert.match(compatibilityRoutes, /source_store: "equipment_finance_private_documents"/);
  assert.match(compatibilityRoutes, /uploadDocument\(\{/);
  assert.match(compatibilityRoutes, /getDocumentContent\(\{/);
  assert.match(compatibilityRoutes, /reviewDocument\(\{/);
  assert.match(compatibilityRoutes, /assertFinanceDocumentRole/);
  assert.doesNotMatch(
    compatibilityRoutes,
    /\b(uploadCaseDocument|getCaseDocument|reviewCaseDocument)\b/
  );
});

test("Finance navigation distinguishes evidence from generated documents", () => {
  assert.match(workspacePage, /stage === "documents"/);
  assert.match(workspacePage, /stage === "generated-documents"/);
  assert.match(documentPage, /application-review-cases/);
  assert.match(documentPage, /Customer evidence/);
  assert.match(documentPage, /Generated agreements/);
  assert.match(documentPage, /replacement_of_document_id/);
});

test("controlled maintenance runs unification after review schema and before delivery gates", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const review = maintenance.indexOf("runEquipmentFinancePhaseFiveBDocumentReviewStartup.js");
  const unified = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js"
  );
  const authorization = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js"
  );
  assert.ok(review >= 0 && unified > review && authorization > unified);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts[
      "migrate:equipment-finance:phase5-unified-documents:production"
    ],
    "node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js"
  );
});
