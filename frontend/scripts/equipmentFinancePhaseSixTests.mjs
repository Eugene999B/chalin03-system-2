import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const page = fs.readFileSync(path.join(root, "src/pages/EquipmentSalesReportsPage.jsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "src/layouts/InstallmentFinanceLayout.jsx"), "utf8");

for (const required of [
  "Portfolio, SMS, Reports &amp; Accounting",
  "Sync Payment SMS",
  "Run Reminders",
  "Accounting CSV",
  "Accounting Excel",
  "Arrears Report",
  "Cash-flow Report",
  "Customer Statement PDF",
  "Thermal Receipt",
  "SMS History",
]) {
  assert.match(page, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const endpoint of [
  "${API}/portfolio",
  "${API}/arrears",
  "${API}/cash-flow",
  "${API}/messages",
  "${API}/accounting-export.csv",
  "${API}/accounting-export.xlsx",
  "${API}/payments/${payment.id}/thermal-receipt.pdf",
]) {
  assert.ok(page.includes(endpoint), `missing Phase 6 endpoint ${endpoint}`);
}

assert.match(page, /data-testid="phase6-finance-reports"/);
assert.match(page, /data-testid="phase6-portfolio-summary"/);
assert.match(page, /data-testid="phase6-arrears-report"/);
assert.match(page, /data-testid="phase6-cash-flow-report"/);
assert.match(page, /data-testid="phase6-customer-statement"/);
assert.match(page, /data-testid="phase6-message-history"/);
assert.match(layout, /Portfolio, SMS & Reports/);
assert.doesNotMatch(page, /\/api\/debts|spare.parts/i);

console.log("Equipment Finance Phase 6 frontend contract passed.");
