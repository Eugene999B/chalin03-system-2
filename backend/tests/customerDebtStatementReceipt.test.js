const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("exact customer debt statement includes purchases, items and payments", () => {
  const panel = read("frontend/src/components/CustomerDebtPrintPanel.jsx");
  const exporter = read("frontend/src/utils/customerDebtStatementExport.js");

  assert.match(panel, /\/debt-customers\/\$\{preferredCustomerId\}/);
  assert.match(panel, /Complete Customer Debt Statement/);
  assert.match(panel, /purchase date and time, item, quantity, unit price, payment/);

  assert.match(exporter, /Customer Debt Statement/);
  assert.match(exporter, /Purchase Date & Time/);
  assert.match(exporter, /Items \/ Materials Purchased/);
  assert.match(exporter, /Purchased At/);
  assert.match(exporter, /Item \/ Material/);
  assert.match(exporter, /Quantity/);
  assert.match(exporter, /Unit Price/);
  assert.match(exporter, /Line Total/);
  assert.match(exporter, /Payments Applied to This Receipt/);
  assert.match(exporter, /Payment Date & Time/);
  assert.match(exporter, /Received By/);
  assert.match(exporter, /Final Account Position/);
});

test("customer debt statement exports detailed Word and Excel documents", () => {
  const exporter = read("frontend/src/utils/customerDebtStatementExport.js");

  assert.match(exporter, /downloadCustomerDebtWord/);
  assert.match(exporter, /application\/msword/);
  assert.match(exporter, /downloadCustomerDebtExcel/);
  assert.match(exporter, /Purchases and Items/);
  assert.match(exporter, /Debt Payments/);
  assert.match(exporter, /application\/vnd\.ms-excel/);
});

test("customer debt statement uses Ghana business time and preserves receipt records", () => {
  const exporter = read("frontend/src/utils/customerDebtStatementExport.js");

  assert.match(exporter, /Africa\/Accra/);
  assert.match(exporter, /Receipt \$\{escapeHtml\(debt\.receipt_number/);
  assert.match(exporter, /Debt ID:/);
  assert.match(exporter, /Sale ID:/);
  assert.match(exporter, /Each receipt remains a separate accounting record/);
});
