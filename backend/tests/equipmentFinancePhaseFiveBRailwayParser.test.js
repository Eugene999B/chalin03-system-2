const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "database/migrations/20260802_equipment_finance_phase5b_document_review.sql"
  ),
  "utf8"
);
const verifier = fs.readFileSync(
  path.join(
    ROOT,
    "database/migrations/20260802_equipment_finance_phase5b_document_review_verify.sql"
  ),
  "utf8"
);
const {
  applyForwardCompatiblePolicyVerification,
  bufferHasExecutableSql,
  policyRowHasReviewControls,
  splitSqlScript,
} = require("../scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup");

test("comment-only safety headers may appear before a DELIMITER directive", () => {
  assert.equal(
    bufferHasExecutableSql(
      "-- CHALIN 03 PRODUCTION MIGRATION\n-- BACKUP REQUIRED\n# second comment form\n"
    ),
    false
  );
  assert.equal(bufferHasExecutableSql("SELECT 1\n"), true);
});

test("the exact Phase 5B migration splits into executable MySQL statements", () => {
  const statements = splitSqlScript(migration);
  assert.equal(statements.length, 18);
  assert.match(statements[0], /^DROP PROCEDURE IF EXISTS/);
  assert.match(statements[1], /^CREATE PROCEDURE/);
  assert.ok(
    statements.some((statement) =>
      statement.includes(
        "CREATE TABLE IF NOT EXISTS equipment_finance_document_review_history"
      )
    )
  );
  assert.ok(
    statements.some((statement) =>
      statement.includes("equipment_finance_phase5b_document_review")
    )
  );
});

test("the Phase 5B verifier still splits into exactly five read-only checks", () => {
  const statements = splitSqlScript(verifier);
  assert.equal(statements.length, 5);
  for (const statement of statements) {
    assert.match(statement, /^SELECT/i);
  }
});

test("real SQL before a delimiter directive still fails closed", () => {
  assert.throws(
    () => splitSqlScript("SELECT 1\nDELIMITER $$\nSELECT 2$$\n"),
    /before the previous statement was complete/
  );
});

test("Phase 5B accepts a later policy version only when review controls remain intact", async () => {
  const currentPolicy = {
    policy_version: "FIN-UNIFIED-DOC-3",
    required_document_categories_json: JSON.stringify([
      "kyc_identity",
      "guarantor_identity",
      "agreement_attachment",
      "other",
    ]),
    independent_document_review_required: 1,
    separate_document_approval_required: 1,
  };
  assert.equal(policyRowHasReviewControls(currentPolicy), true);

  const historicalResults = [[], [], [], [{ invalid_review_policy: 1 }], []];
  const normalized = await applyForwardCompatiblePolicyVerification(
    { query: async () => [[currentPolicy]] },
    historicalResults
  );
  assert.equal(normalized[3][0].invalid_review_policy, 0);
  assert.equal(historicalResults[3][0].invalid_review_policy, 1);
});

test("Phase 5B current-policy verification fails closed on malformed or weakened policy data", async () => {
  const valid = {
    policy_version: "FIN-UNIFIED-DOC-3",
    required_document_categories_json: JSON.stringify([
      "kyc_identity",
      "guarantor_identity",
      "agreement_attachment",
    ]),
    independent_document_review_required: 1,
    separate_document_approval_required: 1,
  };
  assert.equal(
    policyRowHasReviewControls({
      ...valid,
      required_document_categories_json: "not-json",
    }),
    false
  );
  assert.equal(
    policyRowHasReviewControls({
      ...valid,
      required_document_categories_json: JSON.stringify(["kyc_identity"]),
    }),
    false
  );
  assert.equal(
    policyRowHasReviewControls({
      ...valid,
      separate_document_approval_required: 0,
    }),
    false
  );

  const historicalResults = [[], [], [], [{ invalid_review_policy: 0 }], []];
  const normalized = await applyForwardCompatiblePolicyVerification(
    { query: async () => [[]] },
    historicalResults
  );
  assert.equal(normalized[3][0].invalid_review_policy, 1);
});
