const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("equipment login presents one workspace with two independent divisions", () => {
  const workspaces = read("frontend", "src", "data", "businessWorkspaces.js");

  assert.match(workspaces, /code: "equipment_hire"/);
  assert.match(workspaces, /name: "Equipment Hire & Installment Finance"/);
  assert.match(workspaces, /shortName: "Equipment Business"/);
  assert.match(workspaces, /openRoute: "\/equipment-hire"/);
  assert.match(workspaces, /Choose Hire or Installment Finance/);
  assert.match(workspaces, /Equipment Hire Operations/);
  assert.match(workspaces, /Equipment Installment Finance/);
  assert.equal((workspaces.match(/code: "equipment_hire"/g) || []).length, 1);
});

test("authenticated equipment portal opens the division gateway", () => {
  const portal = read("frontend", "src", "pages", "EquipmentHirePortalPage.jsx");
  const gateway = read("frontend", "src", "pages", "EquipmentDivisionGatewayPage.jsx");

  assert.match(portal, /isLoggedIn && workspaceCode === "equipment_hire"/);
  assert.match(portal, /<EquipmentDivisionGatewayPage \/>/);
  assert.match(gateway, /Equipment Hire Operations/);
  assert.match(gateway, /Equipment Installment Finance/);
  assert.match(gateway, /\/equipment-hire-operations\?division=hire/);
  assert.match(gateway, /\/equipment-installment-finance/);
  assert.match(gateway, /HIRE_VIEW_PERMISSIONS/);
  assert.match(gateway, /fleet\.assets\.view/);
  assert.match(gateway, /No duplicate customers or machines/);
  assert.match(gateway, /workspaceCode !== "equipment_hire"/);
});

test("ordinary equipment login destination redirects to gateway unless Hire is explicit", () => {
  const hireLayout = read("frontend", "src", "layouts", "EquipmentHireLayout.jsx");

  assert.match(hireLayout, /useLocation/);
  assert.match(hireLayout, /new URLSearchParams\(location\.search\)/);
  assert.match(hireLayout, /get\("division"\) === "hire"/);
  assert.match(hireLayout, /Navigate to="\/equipment-hire"/);
  assert.match(hireLayout, /path: "\/equipment-hire-operations\?division=hire"/);
  assert.match(hireLayout, /Back to Equipment Divisions/);
});

test("Hire and Installment Finance keep separate navigation identities", () => {
  const hireLayout = read("frontend", "src", "layouts", "EquipmentHireLayout.jsx");
  const financeLayout = read(
    "frontend",
    "src",
    "layouts",
    "InstallmentFinanceLayout.jsx"
  );

  assert.match(hireLayout, /workspaceName="Equipment Hire Operations"/);
  assert.match(hireLayout, /Independent Hire division/);
  assert.match(hireLayout, /Separated from Installment Finance/);
  assert.doesNotMatch(hireLayout, /title: "Finance Command Centre"/);
  assert.doesNotMatch(hireLayout, /title: "Applications & Agreements"/);

  assert.match(financeLayout, /workspaceName="Equipment Installment Finance"/);
  assert.match(financeLayout, /Independent finance division/);
  assert.match(financeLayout, /Separated from Equipment Hire operations/);
  assert.match(financeLayout, /Back to Equipment Divisions/);
  assert.match(financeLayout, /\/equipment-hire-operations\?division=hire/);
  assert.doesNotMatch(financeLayout, /title: "Hire Contracts"/);
  assert.doesNotMatch(financeLayout, /title: "Dispatch & Job Cards"/);
});

test("gateway is responsive, accessible and does not introduce backend storage", () => {
  const gateway = read("frontend", "src", "pages", "EquipmentDivisionGatewayPage.jsx");
  const css = read("frontend", "src", "styles", "equipmentDivisionGateway.css");
  const serviceWorker = read("frontend", "public", "sw.js");

  assert.match(gateway, /aria-label="Equipment divisions"/);
  assert.match(gateway, /aria-disabled="true"/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(serviceWorker, /chalin03-equipment-division-gateway-v19/);

  const changedFeatureSources = `${gateway}\n${css}`;
  assert.doesNotMatch(
    changedFeatureSources,
    /CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE equipment_|DELETE FROM/i
  );
});
