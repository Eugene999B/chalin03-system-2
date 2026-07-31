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
const page = read("src/pages/EquipmentFinanceCustomersPage.jsx");
const css = read("src/styles/equipmentFinanceCustomers.css");
const serviceWorker = read("public/sw.js");

assert(
  dispatcher.includes('import EquipmentFinanceCustomersPage from "./EquipmentFinanceCustomersPage"') &&
    dispatcher.includes('stage === "customers"') &&
    dispatcher.includes("<EquipmentFinanceCustomersPage />"),
  "The Finance stage dispatcher must open the customer portfolio page."
);
assert(
  layout.includes("Finance Customers & Portfolio") &&
    layout.includes("/equipment-installment-finance/applications?stage=customers") &&
    !layout.match(
      /BLOCKED_FINANCE_PATHS[\s\S]*"\/equipment-installment-finance\/customers"/
    ),
  "Finance navigation must expose its own customer portfolio without reopening Hire customers."
);
assert(
  page.includes('const API = "/equipment-catalogue/sales/finance-customers"') &&
    page.includes("Applications & KYC") &&
    page.includes("Delivery & Ownership") &&
    page.includes("Finance-only customer record"),
  "The customer centre must cover the controlled Finance lifecycle."
);
assert(
  !/axiosClient\.(?:post|put|patch|delete)\s*\(/.test(page),
  "Piece 4A must remain a read-only customer portfolio release."
);
assert(
  !page.includes("/equipment-hire") &&
    !page.includes("/hire-commercial") &&
    page.includes("cannot create Hire work, change balances or send automatic SMS"),
  "The Finance customer centre must not expose Hire workflows or automatic messaging."
);
assert(
  css.includes("@media (max-width: 760px)") &&
    css.includes("@media (max-width: 480px)") &&
    css.includes("height: 100dvh") &&
    css.includes("z-index: 100000"),
  "The Finance customer centre must remain usable on desktop and mobile."
);
assert(
  serviceWorker.includes("chalin03-finance-customer-portfolio-v27"),
  "The service-worker cache must advance for the Finance customer portfolio release."
);

console.log("Finance customer portfolio frontend contracts passed.");
