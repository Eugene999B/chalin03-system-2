import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dispatcher = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const page = read("src/pages/EquipmentFinanceCustomerCentrePage.jsx");
const css = read("src/styles/equipmentFinancePhaseOne.css");

assert(
  dispatcher.includes("const EquipmentFinanceCustomerCentrePage = lazy(() =>") &&
    dispatcher.includes('import("./EquipmentFinanceCustomerCentrePage")') &&
    dispatcher.includes('stage === "customers"') &&
    dispatcher.includes("<EquipmentFinanceCustomerCentrePage />"),
  "The Finance stage dispatcher must lazy-load the standalone Customer Centre."
);
assert(
  layout.includes('title: "Customers"') &&
    layout.includes("/equipment-installment-finance/applications?stage=customers") &&
    layout.includes("company-wide Finance customers"),
  "Finance navigation must expose company-wide customers without reopening Hire customers."
);
assert(
  page.includes('const API = "/equipment-catalogue/sales/phase-one/customers"') &&
    page.includes("Finance Customer Centre") &&
    page.includes("Add Customer") &&
    page.includes("Start Installment") &&
    page.includes("finance_application_count") &&
    page.includes("finance_agreement_count") &&
    page.includes("outstanding_balance"),
  "The Customer Centre must create reusable records and show their Finance portfolio history."
);
assert(
  page.includes("axiosClient.get(API)") &&
    page.includes("axiosClient.post(API,") &&
    page.includes("axiosClient.put(`${API}/${editing.id}`") &&
    page.includes("confirm_duplicate: confirmDuplicate"),
  "Authorised Finance staff must be able to create and update duplicate-protected customers."
);
assert(
  !page.includes("useWorkspaceContext") &&
    !page.includes("selectedContextId") &&
    !page.includes("Choose a Hire location"),
  "Finance customer work must remain company-wide and independent of Hire location context."
);
assert(
  css.includes(".finance-simple__customer-grid") &&
    css.includes("@media (max-width: 720px)") &&
    css.includes("grid-template-columns: 1fr") &&
    css.includes("overflow-wrap: anywhere"),
  "The standalone Customer Centre must remain phone-first and readable."
);

console.log("Standalone Finance Customer Centre contracts passed.");
