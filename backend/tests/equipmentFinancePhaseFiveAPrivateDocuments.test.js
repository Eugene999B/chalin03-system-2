const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const migration = read(
  "database/migrations/20260802_equipment_finance_phase5a_private_documents.sql"
);
const verifier = read(
  "database/migrations/20260802_equipment_finance_phase5a_private_documents_verify.sql"
);
const runner = read(
  "backend/scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js"
);
const serviceSource = read(
  "backend/services/equipmentFinancePrivateDocumentsService.js"
);
const routes = read(
  "backend/routes/equipmentFinancePrivateDocumentsRoutes.js"
);
const independentRoutes = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const packageJson = JSON.parse(read("backend/package.json"));

const {
  decryptDocument,
  detectedMimeType,
  encryptBuffer,
} = require("../services/equipmentFinancePrivateDocumentsService");

const requiredTables = [
  "equipment_finance_document_delivery_policy",
  "equipment_finance_private_documents",
  "equipment_finance_case_activity",
];

test("Phase 5A migration is additive and contains only the private vault foundation", () => {
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verifier, new RegExp(`'${table}'`));
  }
  assert.match(migration, /encrypted_payload LONGBLOB NOT NULL/);
  assert.match(migration, /encryption_iv VARBINARY\(12\) NOT NULL/);
  assert.match(migration, /encryption_tag VARBINARY\(16\) NOT NULL/);
  assert.match(migration, /content_checksum CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /delivery_authorizations/i);
  assert.doesNotMatch(migration, /delivery_confirmations/i);
  assert.doesNotMatch(migration, /review_status/i);
  assert.doesNotMatch(migration, /approval_status/i);
  assert.doesNotMatch(migration, /file_url|public_url|storage_url|download_url/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test("AES-256-GCM round trip preserves content and rejects tampering", () => {
  const previous = process.env.CHALIN03_FINANCE_DOCUMENT_KEY;
  process.env.CHALIN03_FINANCE_DOCUMENT_KEY =
    "phase5a-test-document-key-with-more-than-thirty-two-characters";
  try {
    const original = Buffer.from("%PDF-1.4 private finance evidence", "utf8");
    const encrypted = encryptBuffer(original);
    assert.notDeepEqual(encrypted.encrypted, original);
    const row = {
      encryption_version: "aes-256-gcm-v1",
      encrypted_payload: encrypted.encrypted,
      encryption_iv: encrypted.iv,
      encryption_tag: encrypted.tag,
      content_checksum: encrypted.checksum,
    };
    assert.deepEqual(decryptDocument(row), original);
    const tampered = {
      ...row,
      encrypted_payload: Buffer.from(encrypted.encrypted),
    };
    tampered.encrypted_payload[0] ^= 1;
    assert.throws(
      () => decryptDocument(tampered),
      /failed its integrity check/i
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CHALIN03_FINANCE_DOCUMENT_KEY;
    } else {
      process.env.CHALIN03_FINANCE_DOCUMENT_KEY = previous;
    }
  }
});

test("file signatures are verified independently of browser metadata", () => {
  assert.equal(
    detectedMimeType(Buffer.from("%PDF-1.7 evidence", "utf8")),
    "application/pdf"
  );
  assert.equal(
    detectedMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    "image/jpeg"
  );
  assert.equal(
    detectedMimeType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ),
    "image/png"
  );
  assert.equal(detectedMimeType(Buffer.from("not a document")), null);
  assert.match(serviceSource, /FINANCE_DOCUMENT_SIGNATURE_MISMATCH/);
});

test("private document routes have explicit permission and rate-limit guards", () => {
  assert.match(routes, /require\("express-rate-limit"\)/);
  assert.match(routes, /privateDocumentReadLimiter/);
  assert.match(routes, /privateDocumentUploadLimiter/);
  assert.match(routes, /privateDocumentDownloadLimiter/);
  assert.match(routes, /max:\s*30/);
  assert.match(routes, /max:\s*120/);
  assert.match(routes, /max:\s*240/);
  assert.ok(
    (routes.match(/requirePermission\("fleet\.assets\.(view|manage)"\)/g) || [])
      .length >= 7
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/cases\/:agreementId\/documents",\s*privateDocumentUploadLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(
    routes,
    /router\.get\(\s*"\/documents\/:documentId\/content",\s*privateDocumentDownloadLimiter,\s*requirePermission\("fleet\.assets\.view"\)/
  );
  assert.match(routes, /Cache-Control", "private, no-store, max-age=0"/);
  assert.doesNotMatch(routes, /[?&](token|access_token)=/i);
});

test("Phase 5A exposes upload, download and activity only—not later approvals or delivery", () => {
  assert.match(serviceSource, /document_uploaded/);
  assert.match(serviceSource, /document_downloaded/);
  assert.match(serviceSource, /INSERT INTO equipment_finance_case_activity/);
  assert.match(serviceSource, /writeAuditEvent\(/);
  assert.doesNotMatch(routes, /"\/documents\/:documentId\/review"/);
  assert.doesNotMatch(routes, /"\/documents\/:documentId\/approval"/);
  assert.doesNotMatch(routes, /delivery-authorizations/);
  assert.doesNotMatch(routes, /delivery-confirmations/);
  assert.doesNotMatch(independentRoutes, /PhaseFiveDeliveryRoutes/);
  assert.match(
    independentRoutes,
    /router\.use\("\/private-documents", equipmentFinancePrivateDocumentsRoutes\)/
  );
});

test("controlled maintenance runs Phase 5A after Phase 4 while API startup stays independent", () => {
  assert.match(runner, /chalin03:equipment-finance:phase5a-private-documents/);
  assert.match(runner, /information_schema\.TABLES/);
  assert.match(runner, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runner, /GET_LOCK/);
  assert.match(runner, /RELEASE_LOCK/);
  assert.match(runner, /validateVerifierResults/);
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseFour = maintenance.indexOf("runEquipmentFinancePhaseFourStartup.js");
  const phaseFiveA = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js"
  );
  assert.ok(phaseFour >= 0 && phaseFiveA > phaseFour);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase5a:production"],
    "node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js"
  );
});
