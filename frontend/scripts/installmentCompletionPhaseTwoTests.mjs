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
const simplifiedCss = read("src/styles/equipmentFinanceSimplifiedWorkspace.css");
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

assert.match(accounts, /Search active installment accounts/);
assert.match(accounts, /Open Account/);
assert.match(accounts, /Record Payment/);
assert.match(accounts, /Customer Profile/);
assert.match(accounts, /reconciliation/);
assert.match(accounts, /finance-simplified__compact-register/);
assert.doesNotMatch(accounts, /axiosClient\.post/);

assert.match(profiles, /Search first, open only what you need/);
assert.match(profiles, /finance-customers/);
assert.match(profiles, /customer\.applications/);
assert.match(profiles, /customer\.agreements/);
assert.match(profiles, /profile\?\.payments/);
assert.match(profiles, /profile\?\.schedule/);
assert.match(profiles, /credit-applications\/\$\{customer\.latest_application\.application_id\}\/image/);
assert.match(profiles, /No customer selected/);
assert.doesNotMatch(profiles, /rows\[0\]/);
assert.doesNotMatch(profiles, /axiosClient\.post/);

assert.match(payments, /Payments &amp; Collections Centre/);
assert.match(payments, /EquipmentFinanceCollectionsMinimalPage embedded/);
assert.match(payments, /Corrections &amp; Reversals/);
assert.doesNotMatch(payments, /priority-grid/);
assert.match(collections, /Record Payment/);
assert.match(collections, /accounts\/\$\{selected\.agreement_id\}\/collections/);
assert.match(collections, /idempotency_key/);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);
assert.match(collections, /Search payment-ready Finance accounts/);

assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /finance-accounts__split/);
assert.match(css, /finance-accounts__customer-scroll/);
assert.match(css, /finance-payments__entry/);
assert.match(simplifiedCss, /finance-simplified__compact-record/);
assert.match(simplifiedCss, /finance-simplified__selection-panel/);

assert.match(workflow, /equipmentFinanceCompletionPhaseTwo\.spec\.js/);
assert.match(workflow, /finance-completion-phase-two-browser\.log/);

console.log("Installment Completion Phase 2 source contracts passed.");
