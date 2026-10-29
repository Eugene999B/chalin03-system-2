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
const routesSource = read(
  "backend",
  "routes",
  "equipmentFinanceOperationalPolishRoutes.js"
);
const aggregateSource = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const migrationSource = read(
  "database",
  "migrations",
  "20260731_equipment_finance_operational_polish.sql"
);
const verifierSource = read(
  "database",
  "migrations",
  "20260731_equipment_finance_operational_polish_verify.sql"
);
const runnerSource = read(
  "backend",
  "scripts",
  "runEquipmentFinanceOperationalPolishMigration.js"
);

const {
  MAX_DOCUMENT_BYTES,
  calculateDraftProgress,
  parseProtectedDocument,
  simulateSchedule,
} = require("../services/equipmentFinanceOperationalPolishService");
const {
  EXPECTED_PROBLEMS,
  PRESERVED_TABLES,
  RELEASE_CONFIRMATION,
  assertPreservedCounts,
  assertReleaseGates,
  splitSqlScript,
  validateVerifierResults,
} = require("../scripts/runEquipmentFinanceOperationalPolishMigration");

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

test("Phase 3 migration is additive and preserves core financial tables", () => {
  for (const tableName of [
    "equipment_finance_case_drafts",
    "equipment_finance_case_documents",
    "equipment_finance_case_tasks",
    "equipment_finance_case_amendments",
    "equipment_finance_schedule_simulations",
    "equipment_finance_document_shares",
    "equipment_finance_case_events",
  ]) {
    assert.match(migrationSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}`));
  }
  assert.match(migrationSource, /20260731_equipment_finance_operational_polish/);
  assert.doesNotMatch(migrationSource, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);
  assert.doesNotMatch(
    migrationSource,
    /UPDATE\s+(equipment_credit_applications|equipment_sale_agreements|equipment_sale_payments|equipment_installment_schedule)/i
  );
  assert.deepEqual(PRESERVED_TABLES, [
    "equipment_credit_applications",
    "equipment_sale_agreements",
    "equipment_sale_payments",
    "equipment_finance_issued_documents",
    "equipment_finance_payment_alerts",
  ]);
  assert.doesNotThrow(() =>
    assertPreservedCounts(
      Object.fromEntries(PRESERVED_TABLES.map((tableName) => [tableName, 4])),
      Object.fromEntries(PRESERVED_TABLES.map((tableName) => [tableName, 4]))
    )
  );
  assert.throws(
    () =>
      assertPreservedCounts(
        Object.fromEntries(PRESERVED_TABLES.map((tableName) => [tableName, 4])),
        { ...Object.fromEntries(PRESERVED_TABLES.map((tableName) => [tableName, 4])), equipment_sale_payments: 5 }
      ),
    /changed equipment_sale_payments row count/
  );
});

test("secure uploads enforce type, magic bytes, size, private storage and checksum", () => {
  assert.equal(MAX_DOCUMENT_BYTES, 8 * 1024 * 1024);
  const pdf = parseProtectedDocument({
    file_name: "Ghana Card.pdf",
    data_url: dataUrl("application/pdf", Buffer.from("%PDF-1.7\nfinance evidence")),
  });
  assert.equal(pdf.mime_type, "application/pdf");
  assert.equal(pdf.file_name, "Ghana Card.pdf");
  assert.equal(pdf.checksum_sha256.length, 64);
  assert.equal(pdf.byte_size, pdf.buffer.length);

  assert.throws(
    () =>
      parseProtectedDocument({
        file_name: "fake.pdf",
        data_url: dataUrl("application/pdf", Buffer.from("not really a pdf")),
      }),
    /contents do not match/
  );
  assert.throws(
    () =>
      parseProtectedDocument({
        file_name: "script.svg",
        data_url: dataUrl("image/svg+xml", Buffer.from("<svg></svg>")),
      }),
    /Only PDF, JPEG, PNG and WebP/
  );
  assert.match(serviceSource, /storage_scope, document_status/);
  assert.match(serviceSource, /'database_private', 'uploaded'/);
  assert.match(serviceSource, /FINANCE_DOCUMENT_DUPLICATE/);
  assert.match(serviceSource, /FINANCE_CASE_DOCUMENT_INTEGRITY_FAILED/);
  assert.doesNotMatch(serviceSource, /public_url|express\.static|writeFileSync|createWriteStream/);
});

test("draft progress and version conflicts protect guided work", () => {
  const incomplete = calculateDraftProgress({});
  assert.equal(incomplete.ready_for_review, false);
  assert.ok(incomplete.missing.length >= 6);

  const complete = calculateDraftProgress({
    customerMode: "existing",
    customer_id: 4,
    asset_id: 9,
    offer: {
      selling_price: "250000",
      deposit: "50000",
      installment_count: "24",
      first_due_date: "2026-09-01",
    },
    kyc: {
      id_number: "GHA-123",
      employment_type: "business_owner",
      occupation: "Contractor",
      residential_address: "Dunkwa",
      customer_consent_confirmed: true,
      credit_assessment_consent_confirmed: true,
      guarantor_name: "Guarantor",
      guarantor_phone: "0240000000",
      guarantor_id_number: "GHA-GUA",
    },
    affordability: { monthly_business_income: "50000" },
  });
  assert.equal(complete.ready_for_review, true);
  assert.equal(complete.completion_percent, 100);
  assert.match(serviceSource, /FINANCE_DRAFT_VERSION_CONFLICT/);
  assert.match(serviceSource, /knownVersion/);
  assert.match(serviceSource, /version_no = version_no \+ 1/);
});

test("schedule simulation is deterministic, oldest-first and never mutates live records", () => {
  const result = simulateSchedule({
    purchase_price: 1000,
    deposit: 100,
    finance_charge: 0,
    installment_count: 3,
    payment_frequency: "monthly",
    first_due_date: "2026-08-31",
    simulated_payment: 450,
  });
  assert.equal(result.totals.financed_balance, 900);
  assert.equal(result.schedule.length, 3);
  assert.equal(result.schedule[0].simulated_paid, 300);
  assert.equal(result.schedule[0].simulated_status, "paid");
  assert.equal(result.schedule[1].simulated_paid, 150);
  assert.equal(result.schedule[1].simulated_status, "partial");
  assert.equal(result.schedule.reduce((sum, line) => sum + line.scheduled_amount, 0), 900);
  assert.equal(result.allocation_policy, "oldest_due_first");
  assert.equal(result.rounding_policy, "final_schedule_line_only");
  assert.doesNotMatch(
    serviceSource,
    /UPDATE\s+equipment_installment_schedule[\s\S]{0,500}simulation/i
  );
});

test("timeline, inbox and data-quality controls cover the complete case lifecycle", () => {
  for (const tableName of [
    "equipment_credit_applications",
    "equipment_sale_agreements",
    "equipment_sale_payments",
    "equipment_installment_schedule",
    "equipment_deliveries",
    "equipment_ownership_transfers",
    "equipment_finance_document_signatures",
    "equipment_finance_issued_documents",
    "equipment_finance_payment_alerts",
    "equipment_finance_case_documents",
    "equipment_finance_case_tasks",
    "equipment_finance_case_amendments",
    "equipment_finance_document_shares",
    "equipment_finance_case_events",
  ]) {
    assert.match(serviceSource, new RegExp(tableName));
  }
  assert.match(serviceSource, /buyer_identity_missing/);
  assert.match(serviceSource, /customer_consent_missing/);
  assert.match(serviceSource, /machine_identity_missing/);
  assert.match(serviceSource, /document_\$\{category\}_missing/);
  assert.match(serviceSource, /kyc_identity/);
  assert.match(serviceSource, /official_agreement_missing/);
  assert.match(serviceSource, /Boss payment alert failed/);
  assert.match(serviceSource, /pending_approval/);
});

test("controlled amendments preserve original money and payment evidence", () => {
  assert.match(serviceSource, /DIRECT_SAFE_AMENDMENT_FIELDS/);
  assert.match(serviceSource, /HIGH_RISK_AMENDMENT_FIELDS/);
  assert.match(serviceSource, /numbered_variation/);
  assert.match(serviceSource, /preserved_original_financial_records: true/);
  assert.match(serviceSource, /document_type, document_format/);
  assert.match(serviceSource, /'numbered_amendment', 'json'/);
  assert.doesNotMatch(serviceSource, /UPDATE\s+equipment_sale_payments/i);
  assert.doesNotMatch(serviceSource, /DELETE\s+FROM\s+equipment_sale_payments/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+equipment_installment_schedule/i);
});

test("receipts expose allocation, immutable snapshot, boss-alert status and sharing evidence", () => {
  assert.match(serviceSource, /FIN-THERMAL-1/);
  assert.match(serviceSource, /equipment_sale_payment_allocations/);
  assert.match(serviceSource, /boss_alert_status/);
  assert.match(serviceSource, /boss_alert_attempt_count/);
  assert.match(serviceSource, /retryBossPaymentAlert: sendBossPaymentAlert/);
  assert.match(serviceSource, /equipment_finance_document_shares/);
  assert.match(serviceSource, /https:\/\/wa\.me\//);
  assert.match(serviceSource, /mailto:/);
  assert.match(serviceSource, /sendSmsAlertToPhone/);
});

test("Phase 3 routes apply permissions and private download headers", () => {
  assert.match(routesSource, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(routesSource, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(routesSource, /Cache-Control", "private, no-store, max-age=0/);
  assert.match(routesSource, /X-Content-Type-Options", "nosniff/);
  assert.match(routesSource, /X-Document-Checksum/);
  assert.match(routesSource, /boss-alert\/retry/);
  assert.match(routesSource, /schedule\/simulate/);
  assert.match(routesSource, /amendments\/:amendmentId\/apply/);
  assert.match(aggregateSource, /equipmentFinanceOperationalPolishRoutes/);
  assert.match(aggregateSource, /router\.use\(equipmentFinanceOperationalPolishRoutes\)/);
});

test("controlled migration runner requires backups, release identity and seven zero verifier results", () => {
  assert.equal(RELEASE_CONFIRMATION, "20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH");
  assert.equal(EXPECTED_PROBLEMS.length, 7);
  assert.match(runnerSource, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(runnerSource, /CHALIN03_SQL_BACKUP_CONFIRMED/);
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /GET_LOCK/);
  assert.match(runnerSource, /assertPreservedCounts/);
  assert.throws(() => assertReleaseGates({ NODE_ENV: "production" }), /OPERATIONAL_POLISH_ENABLED/);
  assert.doesNotThrow(() =>
    assertReleaseGates({
      NODE_ENV: "production",
      CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED: "true",
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_SQL_BACKUP_CONFIRMED: "true",
      CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
    })
  );
  const verifierStatements = splitSqlScript(verifierSource);
  assert.equal(verifierStatements.length, 7);
  assert.doesNotThrow(() =>
    validateVerifierResults(
      EXPECTED_PROBLEMS.map((key) => [{ [key]: 0 }])
    )
  );
  assert.throws(
    () =>
      validateVerifierResults(
        EXPECTED_PROBLEMS.map((key, index) => [{ [key]: index === 3 ? 1 : 0 }])
      ),
    /invalid_operational_polish_drafts=1/
  );
});
