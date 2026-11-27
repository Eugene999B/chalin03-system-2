import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(path.resolve(process.cwd(), "routes/equipmentFinanceDepositReservationRoutes.js"), "utf8");

test("Opening Deposit payment path is reset-safe", () => {
  assert.match(route, /invalidTriggers\.length === 0/);
  assert.match(route, /async function assertSchemaReady/);
  assert.match(route, /const status = await schemaStatus\(connection\)/);
  assert.match(route, /EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED/);
  assert.doesNotMatch(route, /runEquipmentFinanceOpeningDepositFoundationRepair/);
});
