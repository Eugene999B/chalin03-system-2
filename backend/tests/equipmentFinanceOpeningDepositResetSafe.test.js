import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(path.resolve(process.cwd(), "backend/routes/equipmentFinanceDepositReservationRoutes.js"), "utf8");

test("Opening Deposit payment path is reset-safe", () => {
  assert.match(route, /invalidTriggers\.length === 0/);
  assert.match(route, /runEquipmentFinanceOpeningDepositFoundationRepair\(\)/);
  assert.match(route, /Repair\/reset-proof the Opening Deposit foundation/);
  assert.match(route, /await assertSchemaReady\(pool\)/);
});
