const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(
    backendDir,
    "routes",
    "equipmentFinanceOpeningDepositCandidateCompatibilityRoutes.js"
  ),
  "utf8"
);
const parentSource = fs.readFileSync(
  path.join(backendDir, "routes", "equipmentFinanceIndependentRoutes.js"),
  "utf8"
);

test("schema-compatible Opening Deposit candidates own the live GET before legacy routing", () => {
  assert.match(
    routeSource,
    /router\.get\(\s*["']\/deposit-reservations\/candidates["']/
  );
  assert.match(
    parentSource,
    /equipmentFinanceOpeningDepositCandidateCompatibilityRoutes/
  );
  const compatibilityIndex = parentSource.indexOf(
    "router.use(equipmentFinanceOpeningDepositCandidateCompatibilityRoutes)"
  );
  const legacyIndex = parentSource.indexOf(
    'router.use("/deposit-reservations", equipmentFinanceDepositReservationRoutes)'
  );
  assert.ok(compatibilityIndex >= 0);
  assert.ok(legacyIndex > compatibilityIndex);
});

test("candidate reads use actual live columns and safe fallbacks for optional fields", () => {
  assert.match(routeSource, /tableColumns\(connection, "fleet_assets"\)/);
  assert.match(routeSource, /assetColumns\.has\("main_image_url"\)/);
  assert.match(routeSource, /"NULL AS main_image_url"/);
  assert.match(routeSource, /applicationColumns, "application", "kyc_status"/);
  assert.match(
    routeSource,
    /applicationColumns, "application", "affordability_status"/
  );
  assert.match(routeSource, /locationJoinReady/);
  assert.match(routeSource, /columns\.has\("status"\)/);
  assert.match(routeSource, /hire_conflict_control_unavailable/);
  assert.match(routeSource, /sale_lock_control_unavailable/);
});

test("the compatibility GET keeps deposit security controls fail-closed", () => {
  for (const trigger of [
    "trg_equipment_finance_payment_gate_before_insert",
    "trg_equipment_finance_reservation_gate_before_insert",
    "trg_equipment_finance_commitment_gate_before_update",
  ]) {
    assert.match(routeSource, new RegExp(trigger));
  }
  for (const column of [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "deposit_completed_at",
    "reservation_activated_at",
    "payment_stage",
    "reservation_effect",
    "idempotency_key",
  ]) {
    assert.match(routeSource, new RegExp(`\\"${column}\\"`));
  }
  assert.match(routeSource, /ready_for_deposit: !reserved && blockers\.length === 0/);
  assert.doesNotMatch(routeSource, /INSERT\s+INTO/i);
  assert.doesNotMatch(routeSource, /UPDATE\s+equipment_/i);
  assert.doesNotMatch(routeSource, /DELETE\s+FROM/i);
});

test("information schema reads use stable lower-case aliases", () => {
  assert.match(routeSource, /COLUMN_NAME AS column_name/);
  assert.match(routeSource, /TABLE_NAME AS table_name/);
  assert.match(routeSource, /TRIGGER_NAME AS trigger_name/);
  assert.doesNotMatch(routeSource, /row\.TABLE_NAME/);
  assert.doesNotMatch(routeSource, /row\.COLUMN_NAME/);
  assert.doesNotMatch(routeSource, /row\.TRIGGER_NAME/);
});
