import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const railway = fs.readFileSync(path.resolve(process.cwd(), "../railway.json"), "utf8");
const resetService = fs.readFileSync(path.resolve(process.cwd(), "services/installmentFinanceResetProductionService.js"), "utf8");
const finalizer = fs.readFileSync(path.resolve(process.cwd(), "scripts/finalizeEquipmentFinanceOpeningDepositReservationTrigger.js"), "utf8");
const commitmentFinalizer = fs.readFileSync(path.resolve(process.cwd(), "scripts/finalizeEquipmentFinanceCommitmentTrigger.js"), "utf8");

test("Railway finalizes all Finance triggers before readiness verification", () => {
  const repairIndex = railway.indexOf("node scripts/runEquipmentFinanceProductionPredeployRepair.js");
  const reservationIndex = railway.indexOf("node scripts/finalizeEquipmentFinanceOpeningDepositReservationTrigger.js");
  const commitmentIndex = railway.indexOf("node scripts/finalizeEquipmentFinanceCommitmentTrigger.js");
  const verifyIndex = railway.indexOf("node scripts/verifyEquipmentFinanceDepositReadiness.js");
  assert.ok(repairIndex >= 0);
  assert.ok(reservationIndex > repairIndex);
  assert.ok(commitmentIndex > reservationIndex);
  assert.ok(verifyIndex > commitmentIndex);
});

test("Installment reset finalizes the reservation trigger after reset", () => {
  assert.match(resetService, /await finalize\(\)/);
  assert.match(resetService, /RESET_OPENING_DEPOSIT_FOUNDATION_REPAIR_FAILED/);
});

test("Reservation finalizer verifies the canonical reset-safe reservation trigger", () => {
  assert.match(finalizer, /v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/);
  assert.match(finalizer, /GET_LOCK/);
  assert.match(finalizer, /trg_equipment_finance_reservation_gate_before_insert/);
});

test("Commitment finalizer verifies the canonical commitment trigger", () => {
  assert.match(commitmentFinalizer, /OLD\.equipment_commitment_status\s*<>\s*['\"]reserved['\"]/);
  assert.match(commitmentFinalizer, /NEW\.equipment_commitment_status\s*=\s*['\"]reserved['\"]/);
  assert.match(commitmentFinalizer, /NEW\.agreement_status\s+IN\s*\(/);
  assert.match(commitmentFinalizer, /GET_LOCK/);
});
