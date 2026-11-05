const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const page = read("frontend", "src", "pages", "EquipmentFinanceArrearsPage.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");

test("arrears APIs remain permission protected and Finance scoped", () => {
  assert.match(routes, /requirePermission/);
  assert.match(routes, /arrears|overdue/i);
  assert.match(routes, /reminder|follow-up|promise/i);
  assert.doesNotMatch(routes, /requireHireLocationScope|selectedHireLocationId/);
});

test("Payments and Arrears is discoverable in the simplified Finance journey", () => {
  assert.match(workspace, /EquipmentFinanceArrearsPage/);
  assert.match(workspace, /stage === "arrears"/);
  assert.match(layout, /title: "Payments & Arrears"/);
  assert.doesNotMatch(layout, /Open Equipment Hire Operations/);
});

test("arrears interface keeps follow-up and account evidence available", () => {
  assert.match(page, /const API = "\/equipment-catalogue\/sales\/installment-command"/);
  assert.match(page, /arrears|overdue/i);
  assert.match(page, /reminder|follow-up|promise/i);
  assert.match(page, /axiosClient/);
  assert.match(page, /collection account/i);
});
