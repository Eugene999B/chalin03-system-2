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
const legacyPage = readFrontend("src", "pages", "LegacyDebtsPage.jsx");
const tools = readFrontend("src", "components", "TopDebtDeskTools.jsx");
const css = readFrontend("src", "styles", "debtDesk.css");
const toolsCss = readFrontend("src", "styles", "topDebtDeskTools.css");
const routes = readProject("backend", "routes", "debtRoutes.js");
const mergeRoutes = readProject(
  "backend",
  "routes",
  "topDebtAccountMergeRoutes.js"
);
const serviceWorker = readFrontend("public", "sw.js");
const packageManifest = JSON.parse(readFrontend("package.json"));

assert.match(page, /TopDebtDeskTools/);
assert.match(page, /LegacyDebtsPage/);
assert.match(page, /top-only-debt-desk/);

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
]) {
  assert.match(
    legacyPage,
    new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  );
}

for (const text of [
  "Single authoritative debt workspace",
  "Merge accounts",
  "Debt reminder settings",
  "Merge accounts shown in the top Debt Desk",
  "Receipt-level accounts are allowed here",
  "Protected during merge",
]) {
  assert.match(
    tools,
    new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  );
}

assert.match(legacyPage, /axiosClient\.get\("\/debts"\)/);
assert.doesNotMatch(
  legacyPage,
  /axiosClient\.get\("\/debts\/customers",\s*\{/
);
assert.match(legacyPage, /\/debts\/customers\/\$\{encodeURIComponent/);
assert.match(legacyPage, /\/debt-customers\/\$\{linkedMatch\[1\]\}/);
assert.match(legacyPage, /\/debts\/\$\{legacyMatch\[1\]\}/);
assert.match(legacyPage, /buildDebtDeskAccounts/);
assert.match(legacyPage, /buildDebtDeskSummary/);
assert.match(legacyPage, /pay_full_balance: payFullBalance/);
assert.match(legacyPage, /request_key: paymentRequestKey/);
assert.match(legacyPage, /buildAllocationPreview/);
assert.match(legacyPage, /displayPaymentNote/);
assert.match(legacyPage, /printPaymentReceipt/);
assert.doesNotMatch(legacyPage, /Choose debt/);
assert.doesNotMatch(legacyPage, /showIndividualDebts/);

assert.match(tools, /axiosClient\.get\("\/debts"\)/);
assert.match(tools, /\/debt-customers\/merge-accounts/);
assert.match(tools, /DebtReminderSettingsPanel/);
assert.match(tools, /customer-\$\{customerId\}/);
assert.match(tools, /legacy-\$\{debt\.id\}/);
assert.match(tools, /target_customer_key: masterKey/);
assert.match(tools, /source_customer_keys: sourceKeys/);

assert.match(mergeRoutes, /router\.post\(\s*"\/merge-accounts"/);
assert.match(mergeRoutes, /requireRole\("admin", "manager"\)/);
assert.match(mergeRoutes, /assertFinancialSnapshot/);
assert.match(mergeRoutes, /assertLegacyRowsPreserved/);
assert.doesNotMatch(
  mergeRoutes,
  /SET\s+(?:amount_owed|amount_paid|balance|status|total|quantity)\s*=/i
);

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
assert.match(toolsCss, /\.top-only-debt-desk \.debt-desk__advanced/);
assert.match(toolsCss, /\.top-only-debt-desk \.debt-desk__identity-centre-callout/);
assert.match(toolsCss, /\.top-debt-tools__backdrop/);
assert.match(toolsCss, /@media \(max-width: 900px\)/);
assert.match(toolsCss, /@media \(max-width: 600px\)/);

assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);

console.log("Spare Parts top-only customer-first Debt Desk contract passed.");
