
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const route = read(
  "backend/routes/equipmentFinanceAgreementActivationRoutes.js"
);
const independentRouter = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const scheduleService = read(
  "backend/services/equipmentFinanceScheduleService.js"
);
const migration = read(
  "database/migrations/20260803_equipment_finance_phase3_agreement_creation.sql"
);
const verification = read(
  "database/migrations/20260803_equipment_finance_phase3_agreement_creation_verify.sql"
);
const startup = read(
  "backend/scripts/runEquipmentFinanceAgreementCreationStartup.js"
);
const operationalStartup = read(
  "backend/scripts/runEquipmentFinanceOperationalPolishStartup.js"
);
const packageJson = read("backend/package.json");
const systemRoutes = read("backend/routes/systemRoutes.js");
const productionSmoke = read(
  ".github/workflows/version-3-production-smoke.yml"
);
const {
  splitSqlScript: splitAgreementSql,
} = require("../scripts/runEquipmentFinanceAgreementCreationStartup");

const combinedRuntime = `${route}\n${independentRouter}\n${schemaService}`;

test("company-wide agreement activation owns the route before legacy handlers", () => {
  assert.match(
    independentRouter,
    /require\("\.\/equipmentFinanceAgreementActivationRoutes"\)/
  );
  assert.match(
    independentRouter,
    /router\.use\("\/agreement-activations", equipmentFinanceAgreementActivationRoutes\)/
  );
  assert.ok(
    independentRouter.indexOf(
      'router.use("/agreement-activations", equipmentFinanceAgreementActivationRoutes)'
    ) <
      independentRouter.indexOf("router.use(equipmentFinancePhaseOneRoutes)"),
    "the authoritative agreement route must execute before the legacy lifecycle router"
  );
  assert.doesNotMatch(route, /locationId\(req\)|hireLocationScope/);
  assert.doesNotMatch(route, /application\.hire_location_id\s*=\s*\?/);
  assert.match(route, /hire_location_id: null/);
  assert.match(route, /workspaceCode: "equipment_installment_finance"/);
  assert.match(route, /hireLocationId: null/);
});

test("explicit approval is authoritative while KYC and affordability stay advisory", () => {
  assert.match(route, /application\.application_status !== "approved"/);
  assert.doesNotMatch(route, /application\.kyc_status !== "verified"/);
  assert.doesNotMatch(
    route,
    /\["eligible", "manual_review"\]\.includes\(application\.affordability_status\)/
  );
  assert.match(route, /LEFT JOIN equipment_credit_application_kyc/);
  assert.match(route, /optional_advisory_fields/);
  assert.match(route, /ACTIVATION_ROLES/);
  for (const role of [
    "finance_manager",
    "finance_accountant",
    "equipment_business_manager",
    "equipment_business_accountant",
    "system_admin",
  ]) {
    assert.match(route, new RegExp(role));
  }
  assert.match(route, /isOriginalSystemAdministrator/);
  assert.match(route, /terms_accepted/);
});

test("agreement creation preserves the canonical approved schedule snapshot", () => {
  assert.match(
    route,
    /require\("\.\.\/services\/equipmentFinanceScheduleService"\)/
  );
  assert.match(route, /buildFinanceSchedule\(/);
  assert.match(route, /proposed_interval_days/);
  assert.match(route, /proposed_non_working_day_rule/);
  assert.match(route, /payment_interval_days: scheduleDefinition\.custom_interval_days/);
  assert.match(route, /non_working_day_rule: scheduleDefinition\.non_working_day_rule/);
  assert.match(route, /first_due_date: scheduleDefinition\.first_due_date/);
  assert.match(route, /final_due_date: scheduleDefinition\.final_due_date/);
  assert.match(route, /scheduled_total: financedAmount/);
  assert.match(route, /EQUIPMENT_FINANCE_APPROVED_TERMS_MISMATCH/);
  assert.doesNotMatch(route, /req\.body\.first_due_date/);
  assert.doesNotMatch(route, /function addSchedulePeriod|function buildSchedule/);
  assert.match(scheduleService, /rounding: "final_schedule_line_only"/);
  assert.match(scheduleService, /monthly_anchor_day_preserved: true/);
});

test("creation is atomic, idempotent and serializes duplicate machine activation", () => {
  assert.match(route, /beginTransaction\(\)/);
  assert.match(route, /commit\(\)/);
  assert.match(route, /rollback\(\)/);
  assert.match(
    route,
    /SELECT id, agreement_id FROM equipment_credit_applications[\s\S]*FOR UPDATE/
  );
  assert.match(
    route,
    /SELECT id, is_active, operational_purpose, sale_status[\s\S]*FOR UPDATE/
  );
  assert.match(route, /credit_application_id = \?/);
  assert.match(route, /quotation_id = \?/);
  assert.match(route, /agreement_status NOT IN \('completed','cancelled','defaulted'\)/);
  assert.match(route, /loadAgreementAndSchedule/);
  assert.match(route, /already_activated: true/);
  assert.match(route, /ER_DUP_ENTRY/);
  assert.match(verification, /uq_equipment_sale_agreement_credit_application/);
});

test("agreement creation performs no payment, reservation, Hire work or SMS side effect", () => {
  for (const forbidden of [
    /INSERT INTO hire_contracts/i,
    /INSERT INTO hire_contract_assets/i,
    /INSERT INTO hire_dispatch/i,
    /INSERT INTO hire_invoices/i,
    /INSERT INTO hire_returns/i,
    /INSERT INTO equipment_sale_payments/i,
    /INSERT INTO equipment_asset_sale_locks/i,
    /UPDATE fleet_assets/i,
    /sendSmsAlertToPhone/i,
    /sendAgreementSms/i,
  ]) {
    assert.doesNotMatch(route, forbidden);
  }

  assert.match(route, /equipment_commitment_status: "not_reserved"/);
  assert.match(route, /equipment_reserved: false/);
  assert.match(route, /hire_contract_created: false/);
  assert.match(route, /payment_recorded: false/);
  assert.match(route, /sms_sent: false/);
  assert.match(route, /code: "collect_deposit"/);
});

test("forward migration replaces stale optional and Hire gates with approval-only company-wide gates", () => {
  assert.match(
    migration,
    /trg_equipment_installment_credit_gate_before_insert/
  );
  assert.match(
    migration,
    /trg_equipment_installment_credit_gate_before_update/
  );
  assert.match(migration, /application_status = 'approved'/);
  assert.match(migration, /NEW\.hire_location_id IS NOT NULL/);
  assert.doesNotMatch(migration, /kyc_status = 'verified'/);
  assert.doesNotMatch(
    migration,
    /affordability_status IN \('eligible','manual_review'\)/
  );
  assert.doesNotMatch(migration, /application\.hire_location_id = NEW\.hire_location_id/);
  assert.match(migration, /OLD\.activation_source = 'legacy'/);
  assert.match(migration, /equipment_commitment_status = 'not_reserved'/);
  assert.match(migration, /schema_migrations/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

  for (const expected of [
    "phase3_agreement_migration_record_missing",
    "missing_phase3_agreement_triggers",
    "legacy_optional_activation_gate_fragments",
    "missing_company_wide_approval_gate_fragments",
    "missing_unique_credit_application_agreement_index",
  ]) {
    assert.match(verification, new RegExp(expected));
  }
  assert.doesNotMatch(
    verification,
    /\b(?:INSERT\s+INTO|UPDATE\s+[`A-Za-z]|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE|INDEX)|CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|INDEX))\b/i
  );
});

test("Phase 3 SQL splitter accepts reviewed headers before DELIMITER blocks", () => {
  const migrationSql = read(
    "database/migrations/20260803_equipment_finance_phase3_agreement_creation.sql"
  );
  const verifierSql = read(
    "database/migrations/20260803_equipment_finance_phase3_agreement_creation_verify.sql"
  );
  const migrationStatements = splitAgreementSql(migrationSql);
  const verifierStatements = splitAgreementSql(verifierSql);

  assert.ok(migrationStatements.length >= 5);
  assert.equal(verifierStatements.length, 5);
  assert.match(
    migrationStatements.join("\n"),
    /CREATE TRIGGER trg_equipment_installment_credit_gate_before_insert/
  );
  assert.match(
    migrationStatements.join("\n"),
    /20260803_equipment_finance_phase3_agreement_creation/
  );
});

test("production smoke proves the live Railway commit instead of accepting an old healthy deployment", () => {
  assert.match(systemRoutes, /RAILWAY_GIT_COMMIT_SHA/);
  assert.match(systemRoutes, /deployment: deploymentStatus\(\)/);
  assert.match(productionSmoke, /deployment\.provider == "railway"/);
  assert.match(
    productionSmoke,
    /deployment\.commit_sha == env\.GITHUB_SHA/
  );
});

test("Railway startup applies and verifies the exact Phase 3 migration before API boot", () => {
  assert.match(
    operationalStartup,
    /require\("\.\/runEquipmentFinanceAgreementCreationStartup"\)/
  );
  assert.match(
    operationalStartup,
    /await runEquipmentFinanceAgreementCreationStartup\(\)/
  );
  assert.match(
    packageJson,
    /migrate:equipment-finance:phase3-agreement:production/
  );
  assert.match(startup, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(startup, /verifyDatabaseIdentity/);
  assert.match(startup, /SELECT GET_LOCK/);
  assert.match(startup, /migrationRecordExists/);
  assert.match(startup, /runVerifier/);
  assert.match(startup, /validateVerifierResults/);
  assert.match(route, /REQUIRED_MIGRATIONS/);
  assert.match(route, /EQUIPMENT_FINANCE_ACTIVATION_FOUNDATION_REQUIRED/);
  assert.match(route, /router\.get\(\s*"\/readiness"/);
  assert.doesNotMatch(combinedRuntime, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
});
