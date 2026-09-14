const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const migration = read(
  "database/migrations/20260802_equipment_finance_phase5c_delivery_authorization.sql"
);
const verifier = read(
  "database/migrations/20260802_equipment_finance_phase5c_delivery_authorization_verify.sql"
);
const runnerSource = read(
  "backend/scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js"
);
const serviceSource = read(
  "backend/services/equipmentFinanceDeliveryAuthorizationService.js"
);
const routes = read(
  "backend/routes/equipmentFinanceDeliveryAuthorizationRoutes.js"
);
const independentRoutes = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const packageJson = JSON.parse(read("backend/package.json"));

const {
  approvedDocumentSnapshot,
  assertDeliveryEligibility,
  buildSnapshot,
  deliveryThreshold,
  effectiveStatus,
  snapshotChecksum,
  stableJson,
} = require("../services/equipmentFinanceDeliveryAuthorizationService");
const {
  splitSqlScript,
} = require("../scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup");

function eligibleCase(overrides = {}) {
  return {
    agreement_id: 71,
    application_id: 61,
    asset_id: 41,
    customer_id: 51,
    agreement_status: "active",
    equipment_commitment_status: "reserved",
    total_amount: 1000,
    amount_paid: 300,
    outstanding_balance: 700,
    deposit_required: 200,
    deposit_received: 200,
    delivery_policy: "after_deposit",
    delivery_threshold_percent: 0,
    active_hire_count: 0,
    delivery_count: 0,
    asset_sale_status: "reserved",
    asset_is_active: true,
    ...overrides,
  };
}

function approvedDocuments() {
  return [
    {
      id: 3,
      document_number: "EFD-003",
      document_category: "agreement_attachment",
      content_checksum: "c".repeat(64),
      document_status: "active",
      review_status: "verified",
      approval_status: "approved",
      reviewed_by: 12,
      approved_by: 13,
    },
    {
      id: 1,
      document_number: "EFD-001",
      document_category: "kyc_identity",
      content_checksum: "a".repeat(64),
      document_status: "active",
      review_status: "verified",
      approval_status: "approved",
      reviewed_by: 12,
      approved_by: 13,
    },
    {
      id: 2,
      document_number: "EFD-002",
      document_category: "guarantor_identity",
      content_checksum: "b".repeat(64),
      document_status: "active",
      review_status: "verified",
      approval_status: "approved",
      reviewed_by: 12,
      approved_by: 13,
    },
  ];
}

test("Phase 5C migration is additive and contains authorization but no delivery confirmation", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS equipment_finance_delivery_authorizations/
  );
  assert.match(migration, /delivery_authorization_policy_version/);
  assert.match(migration, /independent_delivery_authorization_required/);
  assert.match(migration, /delivery_authorization_valid_hours/);
  assert.match(migration, /document_snapshot_json LONGTEXT NOT NULL/);
  assert.match(migration, /financial_snapshot_json LONGTEXT NOT NULL/);
  assert.match(migration, /snapshot_checksum CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(
    migration,
    /CREATE TABLE IF NOT EXISTS equipment_finance_delivery_confirmations/
  );
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test("exact Phase 5C SQL splits safely after production comments", () => {
  const statements = splitSqlScript(migration);
  assert.equal(statements.length, 9);
  assert.match(statements[0], /^DROP PROCEDURE IF EXISTS/);
  assert.match(statements[1], /^CREATE PROCEDURE/);
  assert.ok(
    statements.some((statement) =>
      statement.includes(
        "CREATE TABLE IF NOT EXISTS equipment_finance_delivery_authorizations"
      )
    )
  );
  const checks = splitSqlScript(verifier);
  assert.equal(checks.length, 5);
  for (const statement of checks) assert.match(statement, /^SELECT/i);
});

test("document and financial snapshots are deterministic and tamper evident", () => {
  const policy = {
    policy_version: "FIN-DELIVERY-AUTH-1",
    independent_delivery_authorization_required: true,
    delivery_authorization_valid_hours: 48,
  };
  const first = buildSnapshot({
    authorizationPolicy: policy,
    financeCase: eligibleCase(),
    documents: approvedDocuments(),
  });
  const second = buildSnapshot({
    authorizationPolicy: policy,
    financeCase: eligibleCase(),
    documents: [...approvedDocuments()].reverse(),
  });
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.checksum.length, 64);
  assert.deepEqual(
    approvedDocumentSnapshot(approvedDocuments()).map((item) => item.id),
    [1, 2, 3]
  );
  const changed = {
    ...first.snapshot,
    financial: { ...first.snapshot.financial, outstanding_balance: 699 },
  };
  assert.notEqual(snapshotChecksum(changed), first.checksum);
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test("delivery thresholds use backend agreement policy", () => {
  assert.equal(deliveryThreshold(eligibleCase()).satisfied, true);
  assert.equal(
    deliveryThreshold(
      eligibleCase({ deposit_received: 199.99, deposit_required: 200 })
    ).satisfied,
    false
  );
  assert.equal(
    deliveryThreshold(
      eligibleCase({
        delivery_policy: "after_full_payment",
        outstanding_balance: 0,
      })
    ).satisfied,
    true
  );
  assert.equal(
    deliveryThreshold(
      eligibleCase({
        delivery_policy: "threshold_percentage",
        amount_paid: 400,
        delivery_threshold_percent: 40,
      })
    ).satisfied,
    true
  );
  assert.equal(
    deliveryThreshold(eligibleCase({ delivery_policy: "unknown" })).satisfied,
    false
  );
});

test("authorization blocks unreserved, hired, inactive, delivered and unpaid equipment", () => {
  assert.doesNotThrow(() => assertDeliveryEligibility(eligibleCase()));
  assert.throws(
    () =>
      assertDeliveryEligibility(
        eligibleCase({ equipment_commitment_status: "available" })
      ),
    /must be reserved/i
  );
  assert.throws(
    () => assertDeliveryEligibility(eligibleCase({ active_hire_count: 1 })),
    /Hire contract/i
  );
  assert.throws(
    () => assertDeliveryEligibility(eligibleCase({ asset_is_active: false })),
    /inactive/i
  );
  assert.throws(
    () => assertDeliveryEligibility(eligibleCase({ delivery_count: 1 })),
    /already been recorded/i
  );
  assert.throws(
    () =>
      assertDeliveryEligibility(
        eligibleCase({ deposit_received: 100, deposit_required: 200 })
      ),
    /deposit/i
  );
});

test("expired authorization is never presented as usable", () => {
  const expired = effectiveStatus({
    authorization_status: "authorized",
    expires_at: "2020-01-01T00:00:00Z",
  });
  const live = effectiveStatus({
    authorization_status: "authorized",
    expires_at: "2099-01-01T00:00:00Z",
  });
  assert.equal(expired, "expired");
  assert.equal(live, "authorized");
});

test("maker-checker, stale snapshot, expiry and revocation are enforced", () => {
  assert.match(serviceSource, /requested delivery cannot authorize it/);
  assert.match(
    serviceSource,
    /FINANCE_DELIVERY_INDEPENDENT_AUTHORIZER_REQUIRED/
  );
  assert.match(serviceSource, /FINANCE_DELIVERY_AUTHORIZATION_LINKAGE_STALE/);
  assert.match(serviceSource, /FINANCE_DELIVERY_AUTHORIZATION_STALE/);
  assert.match(serviceSource, /DATE_ADD\(NOW\(\), INTERVAL \? HOUR\)/);
  assert.match(serviceSource, /authorization_status = 'revoked'/);
  assert.match(serviceSource, /delivery_authorization_requested/);
  assert.match(serviceSource, /delivery_authorized/);
  assert.match(serviceSource, /delivery_authorization_revoked/);
  assert.match(serviceSource, /LIMIT 1 FOR UPDATE/);
});

test("every authorization database route has explicit rate and role guards", () => {
  assert.match(routes, /authorizationReadLimiter/);
  assert.match(routes, /authorizationRequestLimiter/);
  assert.match(routes, /authorizationDecisionLimiter/);
  assert.match(routes, /authorizationRevocationLimiter/);
  assert.match(routes, /max:\s*240/);
  assert.match(routes, /max:\s*30/);
  assert.match(routes, /max:\s*40/);
  assert.match(routes, /max:\s*20/);
  assert.match(
    routes,
    /router\.post\(\s*"\/cases\/:agreementId\/requests",\s*authorizationRequestLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/authorizations\/:authorizationId\/decision",\s*authorizationDecisionLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/authorizations\/:authorizationId\/revoke",\s*authorizationRevocationLimiter,\s*requirePermission\("fleet\.assets\.manage"\)/
  );
});

test("Phase 5C authorization layer does not itself create or confirm delivery", () => {
  assert.match(independentRoutes, /delivery_authorization_enabled:\s*true/);
  assert.match(
    independentRoutes,
    /router\.use\("\/delivery-authorizations", equipmentFinanceDeliveryAuthorizationRoutes\)/
  );
  assert.doesNotMatch(routes, /finance-lifecycle/);
  assert.doesNotMatch(routes, /receiving_person|meter_reading|fuel_level/);
  assert.doesNotMatch(serviceSource, /INSERT INTO equipment_deliveries/);
  assert.doesNotMatch(
    serviceSource,
    /equipment_finance_delivery_confirmations/
  );
});

test("Phase 5C controlled maintenance gate runs after 5B and fails closed", () => {
  assert.match(
    runnerSource,
    /chalin03:equipment-finance:phase5c-delivery-authorization/
  );
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /GET_LOCK/);
  assert.match(runnerSource, /RELEASE_LOCK/);
  assert.match(runnerSource, /validateVerifierResults/);
  assert.match(runnerSource, /process\.exit\(1\)/);
  assert.match(verifier, /invalid_authorization_records/);
  assert.match(verifier, /decided_by = requested_by/);

  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseFiveB = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveBDocumentReviewStartup.js"
  );
  const phaseFiveC = maintenance.indexOf(
    "runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js"
  );
  assert.ok(phaseFiveB >= 0 && phaseFiveC > phaseFiveB);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase5c:production"],
    "node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js"
  );
});
