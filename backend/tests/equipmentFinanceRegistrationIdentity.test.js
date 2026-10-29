"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeMachine } = require("../services/equipmentFinanceMachineRegisterService");

const valid = {
  asset_code: "EXC-QA-1029", asset_name: "QA Excavator", asset_type: "Excavator",
  equipment_category: "Earthmoving Equipment", make: "Caterpillar", model: "320",
  model_year: 2024, engine_number: "ENGINE-QA-1029", colour: "Yellow",
  serial_number: "SERIAL-QA-1029", chassis_number: "",
  condition_status: "good", ownership_type: "company_owned",
  operational_purpose: "sale_only", meter_type: "hour_meter", current_meter: "0",
  target_selling_price: "100000", minimum_selling_price: "90000",
};

test("complete Finance excavator registration identity passes", () => {
  const { errors, output } = normalizeMachine(valid);
  assert.deepEqual(errors, []);
  assert.equal(output.model_year, 2024);
  assert.equal(output.engine_number, valid.engine_number);
});

test("reject missing excavator identification fields before any insert", () => {
  for (const [field, label] of [
    ["model_year", "Model year"],
    ["engine_number", "Engine number"],
    ["colour", "Colour"],
  ]) {
    const { errors } = normalizeMachine({ ...valid, [field]: "" });
    assert.ok(errors.some(message => message.includes(label)), `${field}: ${errors.join(" | ")}`);
  }
  const missingIdentity = normalizeMachine({ ...valid, serial_number: "", chassis_number: "" });
  assert.ok(missingIdentity.errors.some(message => /serial number or chassis number/i.test(message)));
});

test("require positive approved minimum to prevent a zero-floor sale", () => {
  const a = normalizeMachine({ ...valid, minimum_selling_price: "0" });
  assert.match(a.errors.join(" "), /positive minimum approved selling price/);
  const b = normalizeMachine({ ...valid, minimum_selling_price: "120000" });
  assert.match(b.errors.join(" "), /cannot exceed the target/);
});

test("editing older records still permits partial changes without wiping history", () => {
  assert.deepEqual(normalizeMachine({ colour: "Gold" }, { partial: true }).errors, []);
});

test("new registrations require actual equipment yard; no company-wide placeholder", () => {
  const backend = fs.readFileSync(path.join(__dirname, "../services/equipmentFinanceMachineRegisterService.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentFinanceExcavatorsPage.jsx"), "utf8");
  assert.match(backend, /if \(!locationId\) throw new ProfessionalFinanceError\(400, "Select the actual physical equipment yard/);
  assert.match(ui, /Physical yard \/ storage \(required\)/);
  assert.match(ui, /minimum approved price greater than GHS 0/);
});

test("new installment wizard resets machine-dependent price and isolates photo by buyer", () => {
  const wizard = fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/EquipmentFinanceStartInstallmentPage.jsx"),"utf8");
  assert.match(wizard,/selling_price: changed \? String\(machine.target_selling_price/);
  assert.match(wizard,/setSchedulePreview\(null\)/);
  assert.match(wizard,/photoKeyFor\("existing", customerId\)/);
  assert.match(wizard,/setProfilePhoto\(null\); writePhotoState\(photoKeyFor\("new"\), null\)/);
});

test("machine registration rejects impossible calendar dates before a database write", () => {
  for (const [field, date] of [
    ["acquisition_date", "2026-02-31"],
    ["insurance_expiry", "2026-02-29"],
    ["registration_expiry", "2026-04-31"],
    ["registration_expiry", "2026-13-12"],
  ]) {
    const { errors } = normalizeMachine({ ...valid, [field]: date });
    assert.ok(errors.some((message) => message.includes("valid calendar date")),
      `${field}=${date}: ${errors.join(" | ")}`);
  }
});

test("machine registration accepts genuine leap dates and still permits missing optional dates", () => {
  assert.deepEqual(normalizeMachine({ ...valid, acquisition_date: "2028-02-29" }).errors, []);
  assert.deepEqual(normalizeMachine({ ...valid, insurance_expiry: "", registration_expiry: null }).errors, []);
  const partial = normalizeMachine({ acquisition_date: "2026-02-31" }, { partial: true });
  assert.ok(partial.errors.some((message) => message.includes("valid calendar date")));
});
