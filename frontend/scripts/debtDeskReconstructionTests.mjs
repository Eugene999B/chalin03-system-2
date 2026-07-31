import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const projectRoot = path.resolve(frontendRoot, "..");
const readFrontend = (...parts) =>
  fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const page = readFrontend("src", "pages", "DebtsPage.jsx");
const css = readFrontend("src", "styles", "debtDesk.css");
const routes = readProject("backend", "routes", "debtRoutes.js");
const serviceWorker = readFrontend("public", "sw.js");
const packageManifest = JSON.parse(readFrontend("package.json"));

for (const text of [
  "Customer Debt Desk",
  "Customers owing",
  "Overdue customers",
  "Collected today",
  "Search customer name, phone or location",
  "Pay full balance",
  "Record partial payment",
  "Payment allocation preview",
  "Oldest due first",
  "Print statement",
  "Credit receipts",
  "Payment history",
  "Advanced debt tools",
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

assert.match(page, /axiosClient\.get\("\/debts\/customers"/);
assert.match(page, /\/debts\/customers\/\$\{encodeURIComponent/);
assert.match(page, /pay_full_balance: payFullBalance/);
assert.match(page, /request_key: paymentRequestKey/);
assert.match(page, /buildAllocationPreview/);
assert.match(page, /displayPaymentNote/);
assert.match(page, /printPaymentReceipt/);
assert.match(page, /CustomerDebtConsolidationPanel/);
assert.doesNotMatch(page, /Choose debt/);
assert.doesNotMatch(page, /showIndividualDebts/);

assert.equal(packageManifest.scripts.build, "vite build");
assert.doesNotMatch(
  packageManifest.scripts.build,
  /patchDebtPaymentReceipt/,
  "the production build must not rewrite the reconstructed Debt Desk"
);

assert.match(routes, /router\.get\("\/customers"/);
assert.match(routes, /router\.post\("\/customers\/:customerKey\/payments"/);
assert.match(routes, /DUPLICATE_DEBT_PAYMENT_REQUEST/);
assert.match(routes, /PAYMENT_ALLOCATION_MISMATCH/);
assert.match(routes, /allocation_method: "oldest_due_first"/);
assert.doesNotMatch(routes, /DELETE FROM debts|DELETE FROM debt_payments/);

for (const breakpoint of [1180, 980, 700, 420]) {
  assert.match(css, new RegExp(`@media \\(max-width:\\s*${breakpoint}px\\)`));
}
assert.match(css, /debt-desk__workspace/);
assert.match(css, /debt-desk__detail/);
assert.match(css, /debt-desk__payment/);
assert.match(css, /debt-desk__allocation/);
assert.match(css, /debt-desk__account-list/);
assert.match(css, /focus-visible/);
assert.match(serviceWorker, /chalin03-spare-parts-debt-desk-v30/);
assert.match(serviceWorker, /chalin03-finance-recovery-governance-v29/);

console.log("Spare Parts customer-first Debt Desk reconstruction contract passed.");
