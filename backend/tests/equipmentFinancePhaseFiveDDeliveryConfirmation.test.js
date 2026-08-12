const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("database/migrations/20260802_equipment_finance_phase5d_delivery_confirmation.sql");
const verifier = read("database/migrations/20260802_equipment_finance_phase5d_delivery_confirmation_verify.sql");
const service = read("backend/services/equipmentFinanceDeliveryConfirmationService.js");
const routes = read("backend/routes/equipmentFinanceDeliveryConfirmationRoutes.js");
const independent = read("backend/routes/equipmentFinanceIndependentRoutes.js");
const runner = read("backend/scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js");
const packageJson = JSON.parse(read("backend/package.json"));
const { confirmationInput, idempotencyKey, storedAuthorizationSnapshot } = require("../services/equipmentFinanceDeliveryConfirmationService");
const { splitSqlScript } = require("../scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup");

test("Phase 5D migration is additive and creates independent confirmations", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_finance_delivery_confirmations/);
  assert.match(migration, /authorization_id BIGINT NOT NULL UNIQUE/);
  assert.match(migration, /delivery_id BIGINT NOT NULL UNIQUE/);
  assert.match(migration, /confirmation_checksum CHAR\(64\) NOT NULL/);
  assert.match(migration, /independent_delivery_confirmation_required/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test("exact Phase 5D migration and verifier split safely", () => {
  assert.equal(splitSqlScript(migration).length, 12);
  const checks = splitSqlScript(verifier);
  assert.equal(checks.length, 5);
  for (const statement of checks) assert.match(statement, /^SELECT/i);
});

test("delivery confirmation validates exact physical evidence", () => {
  assert.deepEqual(
    confirmationInput({
      condition_status: "good",
      receiving_person: "Akosua Test",
      meter_reading: "1250.50",
      fuel_level_percent: "75",
    }),
    {
      condition_status: "good",
      receiving_person: "Akosua Test",
      receiving_phone: null,
      destination: null,
      meter_reading: 1250.5,
      fuel_level_percent: 75,
      attachments_tools: null,
      customer_signature_document_id: null,
      delivery_note_document_id: null,
      notes: null,
    }
  );
  assert.throws(() => confirmationInput({ condition_status: "good" }), /receiving person/i);
  assert.throws(() => idempotencyKey("weak"), /idempotency key/i);
  assert.equal(idempotencyKey("finance-delivery-1234567890"), "finance-delivery-1234567890");
  assert.throws(
    () => storedAuthorizationSnapshot({ document_snapshot_json: "{", financial_snapshot_json: "{}" }, {}),
    /snapshot is unreadable/i
  );
});

test("server selects the only live authorization by agreement, never by request body", () => {
  assert.match(service, /WHERE agreement_id = \?/);
  assert.match(service, /authorization_status = 'authorized'/);
  assert.match(service, /expires_at > NOW\(\)/);
  assert.match(service, /LIMIT 2 FOR UPDATE/);
  assert.doesNotMatch(service, /WHERE authorization_number = \?/);
  assert.match(service, /authorization reference does not match the server-selected live authorization/);
});

test("independent confirmation and stale snapshot controls remain mandatory", () => {
  assert.match(service, /manager who authorized delivery cannot also confirm physical handover/);
  assert.match(service, /FINANCE_DELIVERY_INDEPENDENT_CONFIRMATION_REQUIRED/);
  assert.match(service, /assertCurrentAuthorizationSnapshot/);
  assert.match(service, /FINANCE_DELIVERY_AUTHORIZATION_STALE/);
  assert.match(service, /FINANCE_DELIVERY_DOCUMENTS_INCOMPLETE/);
});

test("delivery, confirmation and authorization consumption are one transaction", () => {
  assert.match(service, /beginTransaction\(\)/);
  assert.match(service, /INSERT INTO equipment_deliveries/);
  assert.match(service, /INSERT INTO equipment_finance_delivery_confirmations/);
  assert.match(service, /authorization_status = 'consumed'/);
  assert.match(service, /controlled_delivery_completed_at = NOW\(\)/);
  assert.match(service, /commit\(\)/);
  assert.match(service, /rollback\(\)/);
  assert.match(service, /SELECT delivery\.\*[\s\S]*idempotency_key = \?[\s\S]*FOR UPDATE/);
});

test("delivery endpoint is rate limited and mounted before legacy lifecycle routing", () => {
  assert.match(routes, /require\("express-rate-limit"\)/);
  assert.match(routes, /max:\s*20/);
  assert.match(
    routes,
    /router\.post\(\s*"\/accounts\/:agreementId\/delivery",\s*deliveryConfirmationLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  const protectedIndex = independent.indexOf('router.use("/finance-lifecycle", equipmentFinanceDeliveryConfirmationRoutes)');
  const legacyIndex = independent.indexOf('router.use("/finance-lifecycle", async (_req, res, next)');
  assert.ok(protectedIndex >= 0 && legacyIndex > protectedIndex);
  assert.match(independent, /controlled_delivery_enabled:\s*true/);
  assert.match(independent, /delivery_confirmation_enabled:\s*true/);
});

test("Phase 5D controlled maintenance gate follows 5C and fails closed", () => {
  assert.match(runner, /chalin03:equipment-finance:phase5d-delivery-confirmation/);
  assert.match(runner, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runner, /GET_LOCK/);
  assert.match(runner, /RELEASE_LOCK/);
  assert.match(runner, /validateVerifierResults/);
  assert.match(runner, /process\.exit\(1\)/);
  assert.match(verifier, /confirmed_by = authorization\.decided_by/);
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseC = maintenance.indexOf("runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js");
  const phaseD = maintenance.indexOf("runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js");
  assert.ok(phaseC >= 0 && phaseD > phaseC);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
});
