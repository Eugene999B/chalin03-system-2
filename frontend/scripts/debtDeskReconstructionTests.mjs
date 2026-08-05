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
const hotfixCss = readFrontend("src", "styles", "debtDeskLiveHotfix.css");
const routes = readProject("backend", "routes", "debtRoutes.js");
const serviceWorker = readFrontend("public", "sw.js");
const packageManifest = JSON.parse(readFrontend("package.json"));

for (const text of [
  "Customer Debt Desk",
  "Customers owing",
  "Overdue customers",
  "Total collected",
  "Active receipts",
  "Search customer name, phone or location",
  "Pay full balance",
  "Record partial payment",
  "Payment allocation preview",
  "Oldest due first",
  "Print statement",
  "Credit receipts",
  "Payment history",
  "Resolve duplicate customers",
  "Customer Identity Centre",
  "Professional duplicate merge",
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

assert.match(page, /axiosClient\.get\("\/debts"\)/);
assert.doesNotMatch(page, /axiosClient\.get\("\/debts\/customers",\s*\{/);
assert.match(page, /\/debts\/customers\/\$\{encodeURIComponent/);
assert.match(page, /\/debt-customers\/\$\{linkedMatch\[1\]\}/);
assert.match(page, /\/debts\/\$\{legacyMatch\[1\]\}/);
assert.match(page, /buildDebtDeskAccounts/);
assert.match(page, /buildDebtDeskSummary/);
assert.match(page, /pay_full_balance: payFullBalance/);
assert.match(page, /request_key: paymentRequestKey/);
assert.match(page, /buildAllocationPreview/);
assert.match(page, /displayPaymentNote/);
assert.match(page, /printPaymentReceipt/);
assert.match(page, /CustomerDebtConsolidationPanel/);
assert.match(page, /openCustomerIdentityTools/);
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
assert.match(hotfixCss, /debt-desk__identity-centre-callout/);
assert.match(hotfixCss, /debt-desk__resolve-duplicates/);
assert.match(hotfixCss, /customer-debt-merge-panel/);
assert.match(hotfixCss, /@media \(max-width: 700px\)/);
assert.match(hotfixCss, /@media \(max-width: 420px\)/);
assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);

console.log("Spare Parts customer-first Debt Desk live hotfix contract passed.");
