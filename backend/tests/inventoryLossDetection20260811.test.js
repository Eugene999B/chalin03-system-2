const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const serviceSource = read("services/inventoryLossDetectionService.js");
const lossMigration = fs.readFileSync(
  path.resolve(root, "../database/migrations/20260810_inventory_loss_detection_foundation.sql"),
  "utf8"
);
const snapshotMigration = fs.readFileSync(
  path.resolve(root, "../database/migrations/20260810_inventory_count_snapshot_hardening.sql"),
  "utf8"
);
const lossVerifier = fs.readFileSync(
  path.resolve(root, "../database/migrations/20260810_inventory_loss_detection_foundation_verify.sql"),
  "utf8"
);

const {
  COUNT_EXPECTED_UNIT_STATUSES,
  generateCountSessionCode,
  generateHandoverCode,
  generateInvestigationCode,
  nonNegativeInt,
  riskSeverity,
} = require("../services/inventoryLossDetectionService");

test("blind-count identifiers are store/date scoped and unpredictable", () => {
  const now = new Date("2026-08-11T04:00:00Z");
  assert.equal(generateCountSessionCode("MAIN", now, () => "K7M4Q9"), "CNT-MAIN-20260811-K7M4Q9");
  assert.equal(generateInvestigationCode("MAIN", now, () => "P6R8TX"), "INV-MAIN-20260811-P6R8TX");
  assert.equal(generateHandoverCode("MAIN", now, () => "Z7K3MP"), "HOV-MAIN-20260811-Z7K3MP");
});

test("zero is a valid physical quantity observation", () => {
  assert.equal(nonNegativeInt(0, "quantity"), 0);
  assert.equal(nonNegativeInt("0", "quantity"), 0);
  assert.throws(() => nonNegativeInt(-1, "quantity"), /zero or more/);
  assert.match(lossVerifier, /observation_type = 'quantity_count' AND quantity_observed < 0/);
  assert.doesNotMatch(lossVerifier, /WHERE quantity_observed <= 0/);
});

test("critical missing serialized units receive the highest evidence-review severity", () => {
  assert.equal(riskSeverity("critical", "missing_unit"), "critical");
  assert.equal(riskSeverity("critical", "shortage"), "high");
  assert.equal(riskSeverity("high", "missing_unit"), "high");
  assert.equal(riskSeverity("elevated", "missing_unit"), "review");
});

test("countable serialized identities exclude terminal, unverified-label and in-transit states", () => {
  assert.deepEqual(COUNT_EXPECTED_UNIT_STATUSES, [
    "active",
    "reserved_sale",
    "returned_quarantine",
    "damaged",
    "missing",
  ]);
  assert.equal(COUNT_EXPECTED_UNIT_STATUSES.includes("sold"), false);
  assert.equal(COUNT_EXPECTED_UNIT_STATUSES.includes("voided"), false);
  assert.equal(COUNT_EXPECTED_UNIT_STATUSES.includes("written_off"), false);
  assert.equal(COUNT_EXPECTED_UNIT_STATUSES.includes("label_pending"), false);
  assert.equal(COUNT_EXPECTED_UNIT_STATUSES.includes("in_transit"), false);
});

test("blind count freezes exact expected identities and last-known evidence before scanning", () => {
  assert.match(snapshotMigration, /CREATE TABLE IF NOT EXISTS inventory_count_expected_units/);
  assert.match(snapshotMigration, /unit_code_snapshot VARCHAR\(40\) NOT NULL/);
  assert.match(snapshotMigration, /custody_user_id_snapshot INT NULL/);
  assert.match(snapshotMigration, /last_event_id_snapshot BIGINT NULL/);
  assert.match(snapshotMigration, /last_event_at_snapshot DATETIME NULL/);
  assert.match(serviceSource, /INSERT INTO inventory_count_expected_units/);
  assert.match(serviceSource, /last_event_id_snapshot/);
  assert.match(serviceSource, /COUNT_SERIALIZED_IDENTITY_COVERAGE_REQUIRED/);
});

test("open blind-count API model suppresses expected quantity and identity totals", () => {
  assert.match(serviceSource, /const hideExpected = Boolean\(Number\(session\.blind_mode\)\) && session\.status === "open"/);
  assert.match(serviceSource, /delete row\.expected_system_quantity/);
  assert.match(serviceSource, /delete row\.expected_identity_count/);
});

test("serialized observations are evidence-preserving and duplicate scans do not count twice", () => {
  assert.match(serviceSource, /validationStatus = "duplicate"/);
  assert.match(serviceSource, /validationStatus = "wrong_store"/);
  assert.match(serviceSource, /validationStatus = "unexpected"/);
  assert.match(serviceSource, /INSERT INTO inventory_count_observations/);
  assert.match(serviceSource, /SELECT DISTINCT unit_id/);
});

test("submitting a count creates exact missing-unit variance evidence and investigations", () => {
  assert.match(lossMigration, /CREATE TABLE IF NOT EXISTS inventory_count_variance_units/);
  assert.match(lossMigration, /CREATE TABLE IF NOT EXISTS inventory_loss_investigations/);
  assert.match(serviceSource, /variance_type,[\s\S]*'missing'/);
  assert.match(serviceSource, /investigationType: "missing_serialized_unit"/);
  assert.match(serviceSource, /unexpected_unit/);
  assert.match(serviceSource, /quantity_shortage/);
});

test("investigation resolution never silently mutates stock or assigns worker blame", () => {
  const resolveStart = serviceSource.indexOf("async function resolveInvestigation");
  const custodyStart = serviceSource.indexOf("async function createCustodyHandover");
  const resolveBlock = serviceSource.slice(resolveStart, custodyStart);
  assert.doesNotMatch(resolveBlock, /UPDATE products[\s\S]*quantity/i);
  assert.doesNotMatch(resolveBlock, /UPDATE inventory_units[\s\S]*status/i);
  assert.match(resolveBlock, /stock_mutated: false/);
  assert.match(resolveBlock, /worker_fault_assigned: false/);
});

test("custody handovers require separate people and transfer custody only after a zero-variance verification", () => {
  assert.match(serviceSource, /HANDOVER_INDEPENDENT_CUSTODIANS_REQUIRED/);
  assert.match(serviceSource, /HANDOVER_INDEPENDENT_VERIFICATION_REQUIRED/);
  assert.match(serviceSource, /const status = variance === 0 \? "closed" : "variance"/);
  assert.match(serviceSource, /custody_transferred: variance === 0/);
  assert.match(serviceSource, /SET u\.custody_user_id = \?/);
});
