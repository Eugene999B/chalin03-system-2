import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const resetService = fs.readFileSync(
  path.resolve(process.cwd(), "backend/services/installmentFinanceResetProductionService.js"),
  "utf8"
);
const railway = fs.readFileSync(path.resolve(process.cwd(), "railway.json"), "utf8");


test("Installment reset repairs Opening Deposit foundation before reporting success", () => {
  assert.match(resetService, /runEquipmentFinanceOpeningDepositFoundationRepair\(\)/);
  assert.match(resetService, /RESET_OPENING_DEPOSIT_FOUNDATION_REPAIR_FAILED/);
});

test("Railway production deploy runs the targeted Opening Deposit repair", () => {
  assert.match(railway, /preDeployCommand/);
  assert.match(railway, /migrate:equipment-finance:opening-deposit-foundation:production/);
});
