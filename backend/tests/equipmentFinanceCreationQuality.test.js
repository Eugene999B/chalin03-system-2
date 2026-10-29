"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeMachine } = require("../services/equipmentFinanceMachineRegisterService");

const valid = {
  asset_code: "EXC-TEST-NEW-001",
  asset_name: "Fixture Excavator",
  asset_type: "Excavator",
  make: "Fixture Make",
  model: "Fixture Model",
  model_year: "2024",
  serial_number: "FIXTURE-SERIAL",
  condition_status: "good",
  ownership_type: "company_owned",
  operational_purpose: "sale_only",
  meter_type: "hour_meter",
  current_meter: "0",
  fuel_type: "Diesel",
  target_selling_price: "200000",
  minimum_selling_price: "100000",
};

test("Finance excavator registration requires explicit verified specification fields", () => {
  const { errors } = normalizeMachine({
    ...valid,
    model_year: "",
    current_meter: "",
    fuel_type: "",
    condition_status: "",
    ownership_type: "",
    operational_purpose: "",
    meter_type: "",
  });
  for (const expected of [
    "Model year is required",
    "current meter reading",
    "fuel type",
    "machine condition",
    "machine ownership",
    "sale purpose",
    "meter type",
  ]) {
    assert.match(errors.join(" | "), new RegExp(expected, "i"));
  }
});

test("Actual verified zero-hour reading is valid for newly registered machines", () => {
  const { output, errors } = normalizeMachine(valid);
  assert.deepEqual(errors, []);
  assert.equal(output.current_meter, 0);
  assert.equal(output.model_year, 2024);
  assert.equal(output.fuel_type, "Diesel");
});

test("Partial correction of a legacy machine does not require refilling its full creation form", () => {
  const { output, errors } = normalizeMachine({ model: "Updated Fixture" }, { partial: true });
  assert.deepEqual(errors, []);
  assert.equal(output.model, "Updated Fixture");
});

test("UI requires verified equipment details and uses no fabricated fuel or condition defaults", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentFinanceExcavatorsPage.jsx"), "utf8");
  assert.match(ui, /condition_status: ""/);
  assert.match(ui, /ownership_type: ""/);
  assert.match(ui, /fuel_type: ""/);
  assert.match(ui, /current_meter: ""/);
  assert.match(ui, /Model year \(required\)/);
  assert.match(ui, /Fuel type \(required\)/);
  assert.match(ui, /Meter type \(required\)/);
  assert.match(ui, /Current meter \(required\)/);
});

test("Switching the selected excavator clears the previous machine's commercial terms", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentFinanceStartInstallmentPage.jsx"), "utf8");
  assert.match(ui, /const changedMachine = String\(current.asset_id\) !== nextId/);
  assert.match(ui, /deposit: changedMachine \? "" : current.offer.deposit/);
  assert.match(ui, /setSchedulePreview\(null\)/);
});
