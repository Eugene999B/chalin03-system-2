const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schemaService = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesSchemaService.js"),
  "utf8"
);
const serverSource = fs.readFileSync(
  path.resolve(__dirname, "../server.js"),
  "utf8"
);

const DDL_PATTERN = /\b(?:CREATE\s+(?:TABLE|TRIGGER|PROCEDURE)|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE)|TRUNCATE)\b/i;

test("Equipment Sales uses read-only readiness checks instead of runtime repair", () => {
  assert.match(schemaService, /assertEquipmentSalesSchemaReady/);
  assert.match(schemaService, /information_schema\.COLUMNS/);
  assert.match(schemaService, /information_schema\.TRIGGERS/);
  assert.match(schemaService, /runtime_mutation_disabled: true/);
  assert.doesNotMatch(schemaService, DDL_PATTERN);
  assert.doesNotMatch(schemaService, /setTimeout\s*\(/);
  assert.doesNotMatch(schemaService, /scheduleEquipmentSalesRuntimeBootstrap/);
});

test("production startup validates schema without creating or repairing it", () => {
  assert.match(serverSource, /validateProductionSchemaReadiness/);
  assert.match(serverSource, /runtime schema mutation is disabled/);
  assert.doesNotMatch(serverSource, /ensureWorkerHrLetterSchema/);
  assert.doesNotMatch(serverSource, /ensureEmploymentDocumentSchema/);
  assert.doesNotMatch(serverSource, /ensurePasskeySchema/);
});
