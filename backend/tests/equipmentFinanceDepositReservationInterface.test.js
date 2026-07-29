const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read(
  "frontend/src/pages/EquipmentFinanceDepositReservationPage.jsx"
);
const workspace = read("frontend/src/pages/EquipmentSalesWorkspacePage.jsx");
const layout = read("frontend/src/layouts/InstallmentFinanceLayout.jsx");
const css = read("frontend/src/styles/equipmentFinanceDepositReservation.css");
const serviceWorker = read("frontend/public/sw.js");

test("Finance credit, activation and deposit stages remain separate", () => {
  assert.match(workspace, /stage === "activation"/);
  assert.match(workspace, /stage === "deposit"/);
  assert.match(workspace, /EquipmentFinanceDepositReservationPage/);
  assert.match(workspace, /EquipmentCreditApplicationsPage/);
  assert.match(layout, /Credit Applications & Approval/);
  assert.match(layout, /Agreement Activation/);
  assert.match(layout, /Deposit & Machine Reservation/);
  assert.match(layout, /applications\?stage=deposit/);
  assert.match(layout, /No access to Hire jobs or contracts/);
});

test("deposit interface is restricted to Finance Manager, Finance Accountant or protected System Administrator", () => {
  assert.match(page, /finance_manager/);
  assert.match(page, /finance_accountant/);
  assert.match(page, /is_original_system_administrator/);
  assert.match(page, /canCollect/);
  assert.match(page, /Manager or accountant required/);
  assert.doesNotMatch(page, /hire_officer|dispatcher|fleet_officer/);
});

test("deposit interface calls only the protected Finance deposit API", () => {
  assert.match(
    page,
    /const API = "\/equipment-catalogue\/sales\/deposit-reservations"/
  );
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/candidates`\)/);
  assert.match(
    page,
    /axiosClient\.post\(\n\s+`\$\{API\}\/\$\{selectedCandidate\.agreement_id\}\/deposit`/
  );
  assert.doesNotMatch(page, /\/equipment-hire-operations|\/hire-commercial/);
});

test("interface separates partial deposits from full reservation", () => {
  assert.match(page, /deposit_remaining/);
  assert.match(page, /completesDeposit/);
  assert.match(page, /confirm_reservation/);
  assert.match(page, /Record partial deposit/);
  assert.match(page, /Confirm deposit and reserve/);
  assert.match(page, /machine remains available and unreserved/i);
  assert.match(page, /This action will reserve the machine/);
  assert.match(page, /Reserve this exact machine for the Finance agreement/);
});

test("deposit requests use secure idempotency and expose receipt evidence", () => {
  assert.match(page, /globalThis\.crypto\?\.randomUUID\?\.\(\)/);
  assert.match(page, /idempotency_key/);
  assert.match(page, /finance-opening-deposit/);
  assert.match(page, /receipt_number/);
  assert.doesNotMatch(page, /Math\.random/);
});

test("deposit screen keeps Hire, delivery, ownership, allocation and SMS outside the action", () => {
  for (const text of [
    "No Hire job",
    "No delivery",
    "No ownership transfer",
    "No SMS",
    "no Hire work",
    "no Hire job",
    "no Hire crossover",
    "installment allocation",
  ]) {
    assert.match(
      page,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    );
  }

  assert.doesNotMatch(
    page,
    /equipment_sale_payment_allocations|equipment_deliveries|equipment_ownership_transfers|sendSms/i
  );
});

test("deposit interface is responsive and advances the application cache", () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /finance-deposit__drawer/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(serviceWorker, /chalin03-finance-deposit-reservation-v23/);
  assert.match(serviceWorker, /chalin03-finance-agreement-activation-v22/);
  assert.match(serviceWorker, /networkNavigation/);
  assert.doesNotMatch(
    serviceWorker,
    /url\.pathname\.startsWith\("\/api"\)[\s\S]{0,120}cache\.put/
  );
});
