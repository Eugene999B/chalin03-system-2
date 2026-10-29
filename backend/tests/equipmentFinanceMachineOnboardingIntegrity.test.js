"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeMachine } = require("../services/equipmentFinanceMachineRegisterService");
const source = p => fs.readFileSync(path.join(__dirname, "../../frontend/src/pages", p), "utf8");

const valid = {
  asset_code: "TEST-EXC-001", asset_name: "QA Training Excavator",
  asset_type: "Excavator", make: "CAT", model: "320",
  serial_number: "TEST-SERIAL-001", chassis_number: "",
  target_selling_price: "850000", minimum_selling_price: "800000",
  operational_purpose: "sale_only", condition_status: "good",
};

test("Finance excavator creation requires one verifiable machine identifier", () => {
  let x = normalizeMachine({...valid, serial_number: "", chassis_number: ""});
  assert.ok(x.errors.some(t => /serial number or chassis number/i.test(t)));
  x = normalizeMachine({...valid, serial_number: "", chassis_number: "TEST-CHASSIS"});
  assert.equal(x.errors.length, 0);
});

test("Finance excavator registration rejects missing or invalid price", () => {
  assert.ok(normalizeMachine({...valid, target_selling_price: "0"}).errors.some(t => /greater than zero/i.test(t)));
  assert.ok(normalizeMachine({...valid, minimum_selling_price: "900000"}).errors.some(t => /cannot exceed/i.test(t)));
});

test("Optional verified manufacturer references are not invented", () => {
  const result = normalizeMachine({...valid, model_year: "", engine_number: "", registration_number: "", supplier_name: ""});
  assert.deepEqual(result.errors, []);
  assert.equal(result.output.model_year, null);
  assert.equal(result.output.registration_number, null);
});

test("Equipment create dialog explains required identity and displays errors in the dialog", () => {
  const ui=source("EquipmentFinanceExcavatorsPage.jsx");
  assert.match(ui, /Registration checklist:/);
  assert.match(ui, /!form\.serial_number\.trim\(\) && !form\.chassis_number\.trim\(\)/);
  assert.match(ui, /aria-required=\{!editing\.id && !form\.chassis_number\.trim\(\)\}/);
  assert.match(ui, /<form onSubmit=\{save\}>\s*\{problem \? <div className="finance-simple__notice is-error" role="alert"/);
});

test("Customers show duplicate-save errors in the active modal", () => {
  const ui=source("EquipmentFinanceCustomerCentrePage.jsx");
  assert.match(ui, /<form onSubmit=\{save\}>\s*\{problem \? <div className="finance-simple__notice is-error" role="alert"/);
  assert.match(ui, /Customers in current results/);
});

test("Both installment wizards stop historical dates and abort stale schedule requests", () => {
  for(const name of ["EquipmentFinanceStartInstallmentPage.jsx","EquipmentFinanceStartWizardPage.jsx"]) {
    const ui=source(name);
    assert.match(ui, /offer\.first_due_date < todayPlus\(0\)/);
    assert.match(ui, /min=\{todayPlus\(0\)\}/);
    assert.match(ui, /controller\.abort\(\)/);
    assert.match(ui, /signal: controller\.signal/);
    assert.match(ui, /selling_price: String\(machine\.target_selling_price \|\| ""\)/);
  }
});
