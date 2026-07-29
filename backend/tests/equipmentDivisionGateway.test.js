const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("equipment login presents one business with two role-isolated divisions", () => {
  const workspaces = read("frontend", "src", "data", "businessWorkspaces.js");

  assert.match(workspaces, /code: "equipment_hire"/);
  assert.match(workspaces, /name: "Equipment Hire & Installment Finance"/);
  assert.match(workspaces, /shortName: "Equipment Business"/);
  assert.match(workspaces, /openRoute: "\/equipment-hire"/);
  assert.match(workspaces, /Hire employees open only Equipment Hire Operations/);
  assert.match(workspaces, /Finance employees open only Equipment Installment Finance/);
  assert.match(workspaces, /Ordinary staff roles cannot work in both/);
  assert.equal((workspaces.match(/code: "equipment_hire"/g) || []).length, 1);
});

test("authenticated equipment portal opens the protected division gateway", () => {
  const portal = read("frontend", "src", "pages", "EquipmentHirePortalPage.jsx");
  const gateway = read("frontend", "src", "pages", "EquipmentDivisionGatewayPage.jsx");

  assert.match(portal, /isLoggedIn && workspaceCode === "equipment_hire"/);
  assert.match(portal, /<EquipmentDivisionGatewayPage \/>/);
  assert.match(gateway, /Equipment Hire Operations/);
  assert.match(gateway, /Equipment Installment Finance/);
  assert.match(gateway, /\/equipment-hire-operations\?division=hire/);
  assert.match(gateway, /\/equipment-installment-finance/);
  assert.match(gateway, /canAccessEquipmentDivision/);
  assert.match(gateway, /No staff workflow crossover/);
  assert.match(gateway, /Reference-only machine identity/);
  assert.doesNotMatch(gateway, /HIRE_VIEW_PERMISSIONS/);
  assert.doesNotMatch(gateway, /effectivePermissions\.includes\("fleet\.assets\.view"\)/);
  assert.match(gateway, /workspaceCode !== "equipment_hire"/);
});

test("ordinary equipment login destination redirects to gateway unless Hire is explicit and assigned", () => {
  const hireLayout = read("frontend", "src", "layouts", "EquipmentHireLayout.jsx");

  assert.match(hireLayout, /useLocation/);
  assert.match(hireLayout, /canAccessEquipmentDivision/);
  assert.match(hireLayout, /EQUIPMENT_DIVISIONS\.HIRE/);
  assert.match(hireLayout, /new URLSearchParams\(location\.search\)/);
  assert.match(hireLayout, /get\("division"\) === "hire"/);
  assert.match(hireLayout, /Navigate to="\/equipment-hire"/);
  assert.match(hireLayout, /path: "\/equipment-hire-operations\?division=hire"/);
  assert.match(hireLayout, /Back to Equipment Divisions/);
});

test("Hire and Installment Finance keep separate navigation and staff identities", () => {
  const hireLayout = read("frontend", "src", "layouts", "EquipmentHireLayout.jsx");
  const financeLayout = read(
    "frontend",
    "src",
    "layouts",
    "InstallmentFinanceLayout.jsx"
  );
  const divisionAccess = read(
    "frontend",
    "src",
    "security",
    "equipmentDivisionAccess.js"
  );

  assert.match(hireLayout, /workspaceName="Equipment Hire Operations"/);
  assert.match(hireLayout, /Independent Hire staff division/);
  assert.match(hireLayout, /No access to Finance applications or accounts/);
  assert.doesNotMatch(hireLayout, /Open Equipment Installment Finance/);
  assert.doesNotMatch(hireLayout, /title: "Finance Command Centre"/);

  assert.match(financeLayout, /workspaceName="Equipment Installment Finance"/);
  assert.match(financeLayout, /Independent Finance staff division/);
  assert.match(financeLayout, /No access to Hire jobs or contracts/);
  assert.match(financeLayout, /Back to Equipment Divisions/);
  assert.match(financeLayout, /ensureFinanceUiCompatibilityPermissions\(user\)/);
  assert.doesNotMatch(financeLayout, /Open Equipment Hire Operations/);
  assert.doesNotMatch(financeLayout, /\/equipment-hire-operations\?division=hire/);
  assert.doesNotMatch(financeLayout, /title: "Hire Contracts"/);
  assert.doesNotMatch(financeLayout, /title: "Finance Customers"/);
  assert.doesNotMatch(financeLayout, /title: "Finance Workforce"/);

  assert.match(divisionAccess, /function ensureFinanceUiCompatibilityPermissions/);
  assert.match(divisionAccess, /permissions\.add\("fleet\.assets\.view"\)/);
  assert.match(divisionAccess, /FINANCE_WORK_ROLE_SET/);
  assert.match(divisionAccess, /backend independently rejects/);
  assert.doesNotMatch(divisionAccess, /HIRE_ROLE_SET\.has[^\n]*fleet\.assets\.manage/);
});

test("gateway remains mobile-safe and exposes protected staff assignment", () => {
  const gateway = read("frontend", "src", "pages", "EquipmentDivisionGatewayPage.jsx");
  const css = read("frontend", "src", "styles", "equipmentDivisionGateway.css");
  const mobileCss = read("frontend", "src", "styles", "equipmentDivisionGateway.mobile.css");
  const staffManager = read(
    "frontend",
    "src",
    "components",
    "EquipmentDivisionStaffManager.jsx"
  );
  const serviceWorker = read("frontend", "public", "sw.js");

  assert.match(gateway, /aria-label="Equipment divisions"/);
  assert.match(gateway, /aria-disabled="true"/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(mobileCss, /100dvh/);
  assert.match(staffManager, /Manage Division Staff/);
  assert.match(staffManager, /exactly one role family/);
  assert.match(serviceWorker, /chalin03-equipment-division-isolation-v21/);

  const changedFeatureSources = `${gateway}\n${css}\n${mobileCss}\n${staffManager}`;
  assert.doesNotMatch(
    changedFeatureSources,
    /CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE equipment_|DELETE FROM/i
  );
});
