import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const mining = read("src/layouts/MiningLayout.jsx");
const hire = read("src/layouts/EquipmentHireLayout.jsx");
const finance = read("src/layouts/InstallmentFinanceLayout.jsx");

for (const source of [mining, hire, finance]) {
  assert.match(source, /title: "Monthly Payroll"/);
  assert.match(source, /title: "People & Employment"/);
  assert.doesNotMatch(source, /title: "Payroll Processing"/);
  assert.doesNotMatch(source, /title: "Staff & Workforce"/);
}

assert.match(mining, /title: "Mining Overview"/);
assert.match(mining, /title: "Site Control"/);
assert.match(mining, /title: "People, Fleet & Reports"/);
assert.match(mining, /title: "Document Signatures"/);
assert.match(mining, /title: "Sites & Access"/);
assert.match(mining, /path: "\/mining\/control-centre"/);
assert.match(mining, /path: "\/mining\/workers"/);
assert.match(mining, /path: "\/mining\/payroll"/);

assert.match(hire, /title: "Hire Work"/);
assert.match(hire, /title: "Hire Overview"/);
assert.match(hire, /title: "Rates, Deposits & Amendments"/);
assert.match(hire, /title: "Switch Equipment Division"/);
assert.match(hire, /title: "People, Equipment & Reports"/);
assert.match(hire, /title: "Locations & Access"/);
assert.match(hire, /path: "\/equipment-hire-operations\/commercial-control"/);
assert.match(hire, /path: "\/equipment-hire-operations\/workforce"/);
assert.match(hire, /path: "\/equipment-hire-operations\/payroll"/);

assert.match(finance, /title: "Start & Approve"/);
assert.match(finance, /title: "Work Inbox"/);
assert.match(finance, /title: "Customer Case"/);
assert.match(finance, /title: "Accounts & Collections"/);
assert.match(finance, /title: "Arrears & Follow-up"/);
assert.match(finance, /title: "Documents & Reports"/);
assert.match(finance, /title: "People & Payroll"/);
assert.match(finance, /title: "Settings & Help"/);
assert.match(finance, /title: "Completion & Reset Checks"/);
assert.match(finance, /path: "\/equipment-installment-finance\/applications\?stage=inbox"/);
assert.match(finance, /path: "\/equipment-installment-finance\/applications\?stage=case-operations"/);
assert.match(finance, /path: "\/equipment-installment-finance\/applications\?stage=collections"/);
assert.match(finance, /path: "\/equipment-installment-finance\/workforce"/);
assert.match(finance, /path: "\/equipment-installment-finance\/payroll"/);

console.log("System Clarity navigation source contract passed.");
