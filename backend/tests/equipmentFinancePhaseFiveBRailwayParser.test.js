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
  bufferHasExecutableSql,
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
