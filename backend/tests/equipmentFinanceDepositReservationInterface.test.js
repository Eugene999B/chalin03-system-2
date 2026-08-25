const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const page = read("frontend", "src", "pages", "EquipmentFinanceDepositReservationPageV2.jsx");

test("credit, activation and deposit remain separate controlled stages", () => {
  assert.match(workspace, /EquipmentFinanceApplicationsPage/);
  assert.match(workspace, /EquipmentFinanceAgreementActivationPage/);
  assert.match(workspace, /EquipmentFinanceDepositReservationPage/);
  assert.match(workspace, /stage === "activation"/);
  assert.match(workspace, /stage === "deposit"/);
});

test("deposit is limited to authorised Finance managers and accountants", () => {
  assert.match(page, /AUTHORIZED/);
  assert.match(page, /finance_manager/);
  assert.match(page, /finance_accountant/);
  assert.match(page, /equipment_business_manager/);
  assert.match(page, /equipment_business_accountant/);
  assert.match(page, /system_administrator/);
});

test("deposit interface calls only the protected deposit reservation API", () => {
  assert.ok(page.includes('const API = "/equipment-catalogue/sales/deposit-reservations"'));
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/candidates`\)/);
  assert.match(page, /axiosClient\.post\(`\$\{API\}\/\$\{selected\.agreement_id\}\/deposit`/);
  assert.match(page, /idempotency_key/);
  assert.match(page, /crypto\?\.randomUUID/);
});

test("partial deposits remain separate from full excavator reservation", () => {
  assert.match(page, /queueState/);
  assert.match(page, /deposit_remaining/);
  assert.match(page, /confirm_reservation/);
  assert.match(page, /Confirm the exact excavator reservation/);
  assert.doesNotMatch(page, /ownership-transfer|deliveries\/complete|payment-allocations/);
});
