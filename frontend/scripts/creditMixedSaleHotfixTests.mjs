import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const newSale = read("src/pages/ManualNewSalePage.jsx");
const retirementBridge = read(
  "src/utils/sparePartsInstallmentRetirementBridge.js"
);
const saleRoutes = read("../backend/routes/saleRoutes.js");
const validators = read("../backend/validation/financialRequestValidators.js");

assert.match(newSale, /"credit",\s*"mixed"/);
assert.match(newSale, /Amount Paid Now — Payment Channel Split/);
assert.match(newSale, /paymentAllocations\[channel\]/);
assert.match(newSale, /Customer name or phone is required for credit, mixed/);

assert.match(retirementBridge, /revealCreditOrMixedPanel/);
assert.match(retirementBridge, /panel\.dataset\.chalinCreditMixedPanel = method/);
assert.match(retirementBridge, /method === "credit"/);
assert.match(retirementBridge, /method === "mixed"/);
assert.match(retirementBridge, /panel\.scrollIntoView/);
assert.match(retirementBridge, /firstAmountInput\?\.focus/);
assert.match(retirementBridge, /Never hide or mutate a Credit or Mixed payment-form container/);
assert.doesNotMatch(retirementBridge, /function retireInstallmentForms/);
assert.doesNotMatch(retirementBridge, /containerText\.includes\("payment frequency"\)/);

assert.match(saleRoutes, /\["cash", "momo", "bank"\]\.includes\(paymentType\)/);
assert.match(saleRoutes, /balance:\s*Number\(Math\.max\(saleTotal - amountPaid, 0\)/);
assert.match(saleRoutes, /Payment channel allocation must equal the amount paid now/);
assert.match(validators, /"credit"/);
assert.match(validators, /"mixed"/);
assert.match(validators, /Customer name or phone is required for credit, mixed/);

console.log("Credit and Mixed Manual Sale hotfix contracts passed.");
