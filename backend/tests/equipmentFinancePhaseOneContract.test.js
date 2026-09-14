const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (...parts) =>
  fs.readFileSync(path.join(backendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const route = readBackend("routes", "equipmentFinancePhaseOneRoutes.js");
const independentRouter = readBackend(
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const machineRouter = readBackend(
  "routes",
  "equipmentFinanceMachineRegisterRoutes.js"
);
const wizard = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceStartWizardPage.jsx"
);
const minimalWorkflow = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceMinimalWorkflowPage.jsx"
);
const layout = readProject(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);

test("Phase 1 mounts one company-wide guided Finance workflow", () => {
  assert.match(independentRouter, /equipmentFinancePhaseOneRoutes/);
  assert.match(independentRouter, /router\.use\(equipmentFinancePhaseOneRoutes\)/);
  assert.match(route, /\/phase-one\/bootstrap/);
  assert.match(route, /\/phase-one\/customers/);
  assert.match(route, /\/phase-one\/start-installment/);
  assert.match(route, /hire_location_selection_required:\s*false/);
  assert.match(route, /scope:\s*"company_wide"/);
  assert.doesNotMatch(route, /selectedHireLocationId|requireHireLocationScope/);
});

test("Start New Installment creates the commercial offer automatically", () => {
  assert.match(route, /INSERT INTO equipment_sales_quotations SET \?/);
  assert.match(route, /INSERT INTO equipment_sales_quotation_items SET \?/);
  assert.match(route, /status:\s*"approved"/);
  assert.match(route, /subtotal:\s*offer\.selling_price/);
  assert.match(route, /hire_location_id:\s*null/);
  assert.match(route, /created_automatically:\s*true/);
  assert.match(route, /equipment_credit_applications/);
  assert.match(route, /equipment_credit_application_kyc/);
  assert.match(route, /equipment_credit_application_decisions/);
  assert.match(route, /Installment Offer and draft credit application created/);
  assert.match(minimalWorkflow, /automatic Installment Offer/);
  assert.match(wizard, /create a draft/i);
  assert.doesNotMatch(wizard, /Choose a Finance location|Choose a Hire location/);
});

test("Finance customers are reusable and duplicate protected", () => {
  assert.match(route, /POSSIBLE_DUPLICATE_FINANCE_CUSTOMER/);
  assert.match(
    route,
    /REPLACE\(REPLACE\(REPLACE\(REPLACE\(phone, '\+', ''\), ' ', ''\), '-', ''\), '233', '0'\) = \?/
  );
  assert.match(route, /OR LOWER\(customer_name\) = LOWER\(\?\)/);
  assert.match(route, /EQUIPMENT_FINANCE_CUSTOMER_CREATED/);
  assert.match(route, /EQUIPMENT_FINANCE_CUSTOMER_UPDATED/);
});

test("Excavator editing locks when an installment starts", () => {
  assert.match(machineRouter, /assertMachineStillEditable/);
  assert.match(machineRouter, /equipment_credit_applications/);
  assert.match(machineRouter, /equipment_asset_sale_locks/);
  assert.match(machineRouter, /equipment_sale_agreements/);
  assert.match(machineRouter, /FINANCE_MACHINE_EDIT_LOCKED/);
  assert.match(machineRouter, /sale_status !== "available"/);
});

test("Finance sidebar is simplified around the daily journey", () => {
  for (const title of [
    "Finance Home",
    "Start New Installment",
    "Customers",
    "Excavators",
    "Applications & Approvals",
    "Active Installments",
    "Payments & Arrears",
    "Documents & Reports",
    "Finance Settings",
    "Help & Guide",
  ]) {
    assert.match(layout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(layout, /Finance Equipment Reference/);
  assert.doesNotMatch(layout, /Agreement Activation/);
  assert.doesNotMatch(layout, /Deposit & Reservation/);
  assert.match(layout, /no Hire-location selection/i);
});
