const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  REVIEWER_ROLES,
  REVIEW_TRANSITIONS,
  nextAction,
} = require("../routes/equipmentCreditOptionalDecisionRoutes");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (...parts) =>
  fs.readFileSync(path.join(backendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const decisions = readBackend(
  "routes",
  "equipmentCreditOptionalDecisionRoutes.js"
);
const independent = readBackend(
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const applications = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);

test("company-wide approval handlers own mutations before legacy Sales handlers", () => {
  const decisionMount =
    'router.use("/credit-applications", equipmentCreditOptionalDecisionRoutes)';
  const recoveryMount =
    'router.use("/credit-applications", equipmentFinanceDraftRecoveryRoutes)';
  assert.match(independent, /equipmentCreditOptionalDecisionRoutes/);
  assert.ok(independent.indexOf(decisionMount) < independent.indexOf(recoveryMount));
  assert.doesNotMatch(decisions, /function locationScope|hireLocationScope/);
  assert.match(
    decisions,
    /FROM equipment_credit_applications\s+WHERE id = \?\s+LIMIT 1/
  );
  assert.match(decisions, /hireLocationId: null/);
});

test("Finance workspace managers and administrators can review", () => {
  for (const role of [
    "finance_manager",
    "equipment_business_manager",
    "manager",
    "system_admin",
    "system_administrator",
    "super_admin",
  ]) {
    assert.equal(REVIEWER_ROLES.has(role), true, role);
  }
  assert.match(decisions, /req\.user\?\.workspace_role/);
  assert.match(decisions, /req\.user\?\.access_role/);
  assert.match(decisions, /req\.user\?\.role/);
});

test("approval transitions are explicit and idempotent", () => {
  assert.deepEqual([...REVIEW_TRANSITIONS.start_review.from], ["submitted"]);
  assert.equal(REVIEW_TRANSITIONS.start_review.to, "under_review");
  assert.deepEqual(
    [...REVIEW_TRANSITIONS.request_changes.from],
    ["submitted", "under_review"]
  );
  assert.equal(REVIEW_TRANSITIONS.request_changes.to, "changes_requested");
  assert.equal(REVIEW_TRANSITIONS.approve.to, "approved");
  assert.equal(REVIEW_TRANSITIONS.decline.to, "declined");
  assert.match(decisions, /application\.application_status === transition\.to/);
  assert.match(decisions, /idempotent_replay/);
  assert.match(decisions, /EQUIPMENT_CREDIT_INVALID_REVIEW_TRANSITION/);
  assert.match(decisions, /EQUIPMENT_CREDIT_DECISION_VERSION_CONFLICT/);
});

test("every approval outcome tells staff the next action", () => {
  assert.equal(nextAction("submitted").code, "manager_review");
  assert.equal(nextAction("under_review").code, "manager_decision");
  assert.equal(nextAction("changes_requested").code, "apply_requested_changes");
  assert.equal(nextAction("approved").code, "activate_agreement");
  assert.deepEqual(nextAction("declined").allowed_actions, []);
  assert.match(decisions, /next_action: nextAction/);
  assert.match(applications, /nextActionLabel/);
});

test("decisions and audit entries remain transactional and optional data stays advisory", () => {
  assert.match(decisions, /beginTransaction/);
  assert.match(decisions, /FOR UPDATE/);
  assert.match(
    decisions,
    /INSERT INTO equipment_credit_application_decisions/
  );
  assert.match(decisions, /writeAuditEvent/);
  assert.match(decisions, /optional_information_never_blocks_decision: true/);
  assert.match(
    decisions,
    /Blank optional customer, KYC, guarantor or affordability fields did not block submission/
  );
  assert.match(
    decisions,
    /Optional customer, KYC, guarantor and affordability fields were not required/
  );
  assert.doesNotMatch(decisions, /affordability_status\s+IN\s*\(\s*'eligible'/);
});
