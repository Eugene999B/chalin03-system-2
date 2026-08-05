import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const workspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const home = read("src/pages/EquipmentFinanceCompletionHomePage.jsx");
const accounts = read("src/pages/EquipmentFinanceActiveInstallmentsPage.jsx");
const profiles = read("src/pages/EquipmentFinanceCustomerPortfolioPage.jsx");
const payments = read("src/pages/EquipmentFinancePaymentsCentrePage.jsx");
const collections = read("src/pages/EquipmentFinanceCollectionsMinimalPage.jsx");
const css = read("src/styles/equipmentFinanceAccountsCompletion.css");
const workflow = read("../.github/workflows/chalin03-verification.yml");

for (const stage of ["accounts", "customer-portfolios", "collections", "collections-core"]) {
  assert.match(workspace, new RegExp(`stage === "${stage}"`));
}
assert.match(workspace, /EquipmentFinanceActiveInstallmentsPage/);
assert.match(workspace, /EquipmentFinanceCustomerPortfolioPage/);
assert.match(workspace, /EquipmentFinancePaymentsCentrePage/);
assert.match(workspace, /EquipmentFinanceCollectionsMinimalPage/);

for (const title of [
  "Accounts & Payments",
  "Active Installments",
  "Payments & Collections",
  "Customer Installment Profiles",
  "Corrections & Reversals",
]) {
  assert.match(layout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(layout, /stage=accounts/);
assert.match(layout, /stage=customer-portfolios/);
assert.match(layout, /stage=collections/);

assert.match(home, /Record Payment/);
assert.match(home, /Customer Profiles/);
assert.match(home, /Active Installments/);
assert.match(home, /Payments & Collections/);

assert.match(accounts, /Account monitoring only/);
assert.match(accounts, /Record Payment/);
assert.match(accounts, /Customer Profile/);
assert.match(accounts, /Corrections & Reversals/);
assert.match(accounts, /reconciliation/);
assert.doesNotMatch(accounts, /\/collections`,\s*form/);
assert.doesNotMatch(accounts, /axiosClient\.post/);

assert.match(profiles, /One customer, complete installment history/);
assert.match(profiles, /finance-customers/);
assert.match(profiles, /customer\.applications/);
assert.match(profiles, /customer\.agreements/);
assert.match(profiles, /profile\?\.payments/);
assert.match(profiles, /profile\?\.schedule/);
assert.match(profiles, /credit-applications\/\$\{customer\.latest_application\.application_id\}\/image/);
assert.doesNotMatch(profiles, /axiosClient\.post/);

assert.match(payments, /Payments &amp; Collections Centre/);
assert.match(payments, /EquipmentFinanceCollectionsMinimalPage/);
assert.match(payments, /Corrections &amp; Reversals/);
assert.match(payments, /Record Payment/);
assert.match(collections, /oldest due and future schedule lines/i);
assert.match(collections, /idempotency_key/);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);

assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /finance-accounts__split/);
assert.match(css, /finance-accounts__customer-scroll/);
assert.match(css, /finance-payments__entry/);

assert.match(workflow, /equipmentFinanceCompletionPhaseTwo\.spec\.js/);
assert.match(workflow, /finance-completion-phase-two-browser\.log/);

console.log("Installment Completion Phase 2 source contracts passed.");
