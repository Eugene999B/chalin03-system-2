import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const customerCentre = read("src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const customerPortfolio = read("src", "pages", "EquipmentFinanceCustomerPortfolioPage.jsx");
const paymentsCentre = read("src", "pages", "EquipmentFinancePaymentsCentrePage.jsx");
const collections = read("src", "pages", "EquipmentFinanceCollectionsMinimalPage.jsx");
const documentCentre = read("src", "pages", "EquipmentFinanceDocumentCentrePage.jsx");
const deposit = read("src", "pages", "EquipmentFinanceDepositReservationPage.jsx");
const activation = read("src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const accounts = read("src", "pages", "EquipmentFinanceActiveInstallmentsPage.jsx");
const styles = read("src", "styles", "equipmentFinanceSimplifiedWorkspace.css");

assert.match(customerCentre, /selectedCustomer/);
assert.match(customerCentre, /View Details/);
assert.match(customerCentre, /Search Finance customer register/);
assert.match(customerCentre, /finance-simplified__customer-row/);
assert.doesNotMatch(customerCentre, /finance-simple__facts[\s\S]*visibleCustomers\.map/);

assert.match(customerPortfolio, /No customer selected/);
assert.match(customerPortfolio, /Use the search box, then select one customer/);
assert.match(customerPortfolio, /clearSelection/);
assert.doesNotMatch(customerPortfolio, /rows\[0\]\?\.customer_id/);
assert.doesNotMatch(customerPortfolio, /requestedCustomer \|\| selectedId/);

assert.match(paymentsCentre, /<EquipmentFinanceCollectionsMinimalPage embedded \/>/);
assert.doesNotMatch(paymentsCentre, /priority-grid/);
assert.match(collections, /\{ embedded = false \}/);
assert.match(collections, /Search payment-ready Finance accounts/);
assert.match(collections, /Select Account/);
assert.match(collections, /finance-simple__dialog-backdrop/);

assert.match(documentCentre, /accountSearch/);
assert.match(documentCentre, /Search Finance document accounts/);
assert.match(documentCentre, /No agreement selected/);
assert.match(documentCentre, /src="\/chalin03-logo\.png"/);
assert.match(documentCentre, /setSelectedPaymentId\(""\)/);
assert.doesNotMatch(documentCentre, /nextAccounts\[0\]/);
assert.doesNotMatch(documentCentre, /payments\?\.at\(-1\)/);
assert.doesNotMatch(documentCentre, />C03<\/div>/);

assert.match(deposit, /queueFilter/);
assert.match(deposit, /Search opening deposit agreements/);
assert.match(deposit, /finance-simplified__compact-register/);
assert.match(deposit, /Selected agreement/);
assert.match(deposit, /Record Deposit/);
assert.doesNotMatch(deposit, /â|ðŸ/);

assert.match(activation, /Search agreement activation candidates/);
assert.match(activation, /Create Agreement/);
assert.match(activation, /finance-simplified__compact-register/);
assert.match(activation, /Selected application/);

assert.match(accounts, /Search active installment accounts/);
assert.match(accounts, /finance-simplified__compact-register/);
assert.match(accounts, /Selected account/);
assert.doesNotMatch(accounts, /finance-accounts__grid/);

for (const contract of [
  ".finance-simplified__selection-panel",
  ".finance-simplified__compact-record",
  ".finance-simplified__picker-controls",
  ".finance-simplified__customer-row",
  "@media (max-width: 980px)",
  "grid-template-columns: 1fr",
]) {
  assert.ok(styles.includes(contract), `Missing simplified Finance style contract: ${contract}`);
}

console.log("Equipment Finance simplified search-first workspace contracts passed.");
