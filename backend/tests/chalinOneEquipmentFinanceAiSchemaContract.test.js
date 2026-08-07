"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend", "services", "aiEquipmentFinanceIntelligenceService.js"),
  "utf8"
);
const applicationMigration = fs.readFileSync(
  path.join(repoRoot, "database", "migrations", "20260729_equipment_credit_application_foundation.sql"),
  "utf8"
);
const equipmentMigration = fs.readFileSync(
  path.join(repoRoot, "database", "migrations", "20260722_equipment_sales_installments_foundation.sql"),
  "utf8"
);

test("Finance AI application classifications match the actual credit-application schema", () => {
  assert.match(applicationMigration, /risk_band ENUM\('low','medium','high','critical'\)/);
  assert.match(
    applicationMigration,
    /kyc_status ENUM\([\s\S]*'not_started','incomplete','complete','verified','rejected'/
  );

  assert.match(serviceSource, /risk_band IN \('high', 'critical'\)/);
  assert.doesNotMatch(serviceSource, /very_high/);
  assert.match(
    serviceSource,
    /kyc_status IN \('not_started', 'incomplete', 'complete'\)/
  );
  assert.doesNotMatch(serviceSource, /kyc_status IN \('pending'/);
});

test("Finance AI sale inventory classifications match the actual fleet sale-status schema", () => {
  assert.match(
    equipmentMigration,
    /ENUM\('not_for_sale','available','reserved','installment_active','sold','cancelled'\)/
  );
  assert.match(
    serviceSource,
    /sale_status IN \('reserved', 'installment_active'\)/
  );
  assert.match(serviceSource, /sale_status = 'sold'/);
  assert.doesNotMatch(serviceSource, /application_hold|agreement_hold|sale_status IN \('sold', 'completed'\)/);
});