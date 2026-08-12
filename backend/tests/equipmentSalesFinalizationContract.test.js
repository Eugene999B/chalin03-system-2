const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const retirementMigration = read(
  "database/migrations/20260722_retire_spare_parts_installments.sql"
);
const retirementVerification = read(
  "database/migrations/20260722_retire_spare_parts_installments_verify.sql"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const reminderService = read(
  "backend/services/equipmentSalesReminderService.js"
);
const finalizationRoutes = read(
  "backend/routes/equipmentSalesFinalizationRoutes.js"
);
const equipmentSalesRoutes = read("backend/routes/equipmentSalesRoutes.js");
const catalogueMiddleware = read(
  "backend/middleware/equipmentCatalogueIntegrityMiddleware.js"
);
const backupRoutes = read("backend/routes/backupRoutes.js");
const resetScript = read("backend/scripts/resetDatabaseFromBackup.js");
const cloudflareHeaders = read("frontend/public/_headers");

const RETIREMENT_TRIGGERS = [
  "trg_spare_parts_installment_retired_sales_insert",
  "trg_spare_parts_installment_retired_agreement_insert",
];

test("Spare Parts installment retirement is additive and preserves recovery", () => {
  assert.match(retirementMigration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(retirementMigration, /history are preserved/i);
  assert.match(retirementMigration, /FOREIGN_KEY_CHECKS=0/i);
  assert.match(retirementMigration, /@@SESSION\.FOREIGN_KEY_CHECKS = 1/);
  assert.match(retirementMigration, /INSERT INTO schema_migrations/i);
  assert.match(
    retirementMigration,
    /20260722_retire_spare_parts_installments/
  );
  assert.doesNotMatch(
    retirementMigration,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i
  );
  assert.doesNotMatch(retirementMigration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(retirementMigration, /\bDELETE\s+FROM\b/i);

  for (const triggerName of RETIREMENT_TRIGGERS) {
    assert.match(retirementMigration, new RegExp(triggerName));
    assert.match(retirementVerification, new RegExp(`'${triggerName}'`));
  }

  assert.match(backupRoutes, /SET FOREIGN_KEY_CHECKS = 0/);
  assert.match(resetScript, /SET FOREIGN_KEY_CHECKS = 0/);
});

test("catalogue and commercial foundations are verified read-only", () => {
  assert.match(schemaService, /FOUNDATION_MIGRATION/);
  assert.match(schemaService, /RETIREMENT_MIGRATION/);
  assert.match(schemaService, /required: true/);
  assert.match(schemaService, /required: false/);
  assert.match(schemaService, /information_schema\.TABLES/);
  assert.match(schemaService, /information_schema\.COLUMNS/);
  assert.match(schemaService, /information_schema\.TRIGGERS/);
  assert.match(schemaService, /verifyCatalogueCore/);
  assert.match(schemaService, /verifyFullFoundation/);
  assert.match(schemaService, /verifyFoundationSafety/);
  assert.match(schemaService, /verifyRetirement/);
  assert.match(schemaService, /assertEquipmentSalesSchemaReady/);
  assert.match(schemaService, /runtime_mutation_disabled/);
  assert.match(schemaService, /startEquipmentSalesReminderScheduler/);
  assert.match(
    schemaService,
    /equipmentSalesRoutes\.use\(equipmentSalesFinalizationRoutes\)/
  );
  assert.match(
    schemaService,
    /trg_hire_contract_asset_sale_guard_before_insert/
  );
  assert.match(
    schemaService,
    /trg_spare_parts_installment_retired_sales_insert/
  );
  assert.doesNotMatch(schemaService, /GET_LOCK|RELEASE_LOCK/);
  assert.doesNotMatch(schemaService, /executeMigration|splitSqlStatements/);
  assert.doesNotMatch(schemaService, /\bCREATE\s+(?:TABLE|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(schemaService, /\bALTER\s+TABLE\b/i);
});

test("Cloudflare Insights is explicitly permitted without widening the whole CSP", () => {
  assert.match(
    cloudflareHeaders,
    /script-src 'self' 'unsafe-inline' https:\/\/static\.cloudflareinsights\.com/
  );
  assert.match(
    cloudflareHeaders,
    /script-src-elem 'self' 'unsafe-inline' https:\/\/static\.cloudflareinsights\.com/
  );
  assert.match(
    cloudflareHeaders,
    /connect-src 'self'[^;]*https:\/\/api\.chalin03\.com[^;]*https:\/\/cloudflareinsights\.com/
  );
  assert.match(cloudflareHeaders, /object-src 'none'/);
  assert.match(cloudflareHeaders, /frame-ancestors 'none'/);
});

test("automatic Equipment Sales reminders are deduplicated and location aware", () => {
  assert.match(reminderService, /equipment_sales_reminder_log/);
  assert.match(reminderService, /INSERT IGNORE/);
  assert.match(reminderService, /reminderKey/);
  assert.match(reminderService, /due_soon/);
  assert.match(reminderService, /due_today/);
  assert.match(reminderService, /overdue/);
  assert.match(reminderService, /EQUIPMENT_SALES_REMINDER_DAYS_BEFORE/);
  assert.match(reminderService, /EQUIPMENT_SALES_OVERDUE_REMINDER_DAYS/);
  assert.match(reminderService, /Math\.max\(\s*60/);
  assert.match(reminderService, /workspace_code = 'equipment_hire'/);
  assert.match(reminderService, /hire_location_id = \?/);
  assert.match(reminderService, /entity_type = 'equipment_sale_agreement'/);
  assert.match(reminderService, /deduplication_key = \?/);
  assert.match(reminderService, /refreshEquipmentInstallmentStatuses/);
  assert.match(reminderService, /startEquipmentSalesReminderScheduler/);
});

test("professional Equipment Sales PDFs cover the complete customer file", () => {
  for (const pathPattern of [
    /quotations\/:id\/quotation\.pdf/,
    /agreements\/:id\/documents\/:type\.pdf/,
    /payments\/:id\/receipt\.pdf/,
  ]) {
    assert.match(finalizationRoutes, pathPattern);
  }

  for (const documentType of [
    "agreement",
    "statement",
    "delivery",
    "ownership",
    "overdue",
  ]) {
    assert.match(finalizationRoutes, new RegExp(`"${documentType}"`));
  }

  assert.match(finalizationRoutes, /PDFDocument/);
  assert.match(finalizationRoutes, /chalin03-logo\.png/);
  assert.match(finalizationRoutes, /Equipment Sales Quotation/);
  assert.match(finalizationRoutes, /Equipment Installment Agreement/);
  assert.match(finalizationRoutes, /Equipment Sale Customer Statement/);
  assert.match(finalizationRoutes, /Equipment Delivery Note/);
  assert.match(finalizationRoutes, /Equipment Ownership Transfer Certificate/);
  assert.match(finalizationRoutes, /Overdue Equipment Installment Notice/);
  assert.match(finalizationRoutes, /Equipment Sale Payment Receipt/);
  assert.match(finalizationRoutes, /main_image_url_snapshot/);
  assert.match(finalizationRoutes, /signatureArea/);
  assert.match(finalizationRoutes, /Cache-Control/);
  assert.match(finalizationRoutes, /auditDownload/);
});

test("management reports cover finance, aging, portfolio and staff", () => {
  assert.match(finalizationRoutes, /\/reports\/management/);
  assert.match(finalizationRoutes, /\/reports\/export\.csv/);
  assert.match(finalizationRoutes, /total_sales_value/);
  assert.match(finalizationRoutes, /collected_amount/);
  assert.match(finalizationRoutes, /outstanding_amount/);
  assert.match(finalizationRoutes, /overdue_amount/);
  assert.match(finalizationRoutes, /estimated_gross_profit/);
  assert.match(finalizationRoutes, /aging_bucket/);
  assert.match(finalizationRoutes, /monthly_collections/);
  assert.match(finalizationRoutes, /asset_portfolio/);
  assert.match(finalizationRoutes, /expected_collections/);
  assert.match(finalizationRoutes, /staff_performance/);
  assert.match(finalizationRoutes, /\/retirement-status/);
  assert.match(finalizationRoutes, /historical_records/);
  assert.match(finalizationRoutes, /\/reminders\/run/);
});

test("existing Equipment Sales router remains transaction and sale-Hire protected", () => {
  assert.match(equipmentSalesRoutes, /withTransaction/);
  assert.match(equipmentSalesRoutes, /FOR UPDATE/);
  assert.match(equipmentSalesRoutes, /equipment_asset_sale_locks/);
  assert.match(equipmentSalesRoutes, /active_hire_count/);
  assert.match(equipmentSalesRoutes, /outstanding_balance/);
  assert.match(equipmentSalesRoutes, /deliveryAllowed/);
  assert.match(equipmentSalesRoutes, /ownership-transfer/);
  assert.match(catalogueMiddleware, /ensureFoundationOnce/);
  assert.match(catalogueMiddleware, /dispatchEquipmentSalesRouter/);
  assert.match(catalogueMiddleware, /EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED/);
});
