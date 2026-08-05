import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const projectRoot = path.resolve(frontendRoot, "..");
const readFrontend = (...parts) =>
  fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const page = readFrontend("src", "pages", "EquipmentInstallmentCommandPage.jsx");
const minimalWorkflow = readFrontend(
  "src",
  "pages",
  "EquipmentFinanceMinimalWorkflowPage.jsx"
);
const advancedPage = readFrontend(
  "src",
  "pages",
  "EquipmentInstallmentCommandAdvancedPage.jsx"
);
const collections = readFrontend(
  "src",
  "pages",
  "EquipmentFinanceCollectionsMinimalPage.jsx"
);
const css = readFrontend("src", "styles", "equipmentFinancePhaseOne.css");
const app = readFrontend("src", "App.jsx");
const fleetPage = readFrontend("src", "pages", "FleetAssetsPage.jsx");
const hireLayout = readFrontend("src", "layouts", "EquipmentHireLayout.jsx");
const financeLayout = readFrontend("src", "layouts", "InstallmentFinanceLayout.jsx");
const divisionAccess = readFrontend(
  "src",
  "security",
  "equipmentDivisionAccess.js"
);
const workspaceLayout = readFrontend(
  "src",
  "components",
  "BusinessWorkspaceLayout.jsx"
);
const workspaceContext = readFrontend("src", "context", "WorkspaceContext.jsx");
const axiosClient = readFrontend("src", "api", "axiosClient.js");
const serviceWorker = readFrontend("public", "sw.js");
const route = readProject("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const service = readProject(
  "backend",
  "services",
  "equipmentInstallmentCommandService.js"
);
const readModel = readProject(
  "backend",
  "services",
  "equipmentInstallmentReadModelService.js"
);

assert.match(page, /EquipmentFinanceMinimalWorkflowPage/);
assert.match(page, /EquipmentInstallmentCommandAdvancedPage/);
assert.match(page, /view.*advanced/);

for (const text of [
  "Equipment Installment Workflow",
  "Complete these nine actions",
  "Equipment list",
  "Add equipment",
  "Customer selection",
  "Create installment agreement",
  "Configure terms",
  "Preview schedule",
  "Activate agreement",
  "Record payment",
  "Balance and payment history",
  "backend",
]) {
  assert.match(minimalWorkflow, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
assert.match(minimalWorkflow, /Promise\.allSettled/);
assert.match(minimalWorkflow, /outstanding_balance/);
assert.match(minimalWorkflow, /official-outstanding-balance/);
assert.match(minimalWorkflow, /GHS/);
assert.doesNotMatch(minimalWorkflow, /useWorkspaceContext|selectedContextId/);
assert.match(advancedPage, /Installment Command Centre|What do you need to do today/i);
assert.match(collections, /Collections &amp; Payment History/);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);

assert.match(app, /InstallmentFinanceLayout/);
assert.match(app, /path="\/equipment-installment-finance"/);
assert.match(app, /EquipmentInstallmentCommandPage/);
assert.match(app, /EquipmentSalesWorkspacePage/);
assert.match(app, /EquipmentSalesReportsPage/);
assert.match(app, /allowedWorkspaces=\{EQUIPMENT_HIRE_WORKSPACE\}/);
assert.doesNotMatch(app, /const INSTALLMENT_WORKSPACE/);

assert.match(financeLayout, /Equipment Installment Finance/);
assert.match(financeLayout, /independenceLabel=""/);
assert.match(financeLayout, /description=""/);
assert.doesNotMatch(financeLayout, /Independent Finance staff division/);
assert.doesNotMatch(financeLayout, /A complete excavator installment lifecycle/);
assert.match(financeLayout, /No access to Hire jobs or contracts/);
assert.match(financeLayout, /Finance Home/);
assert.match(financeLayout, /Start New Installment/);
assert.match(financeLayout, /Applications & Approvals/);
assert.match(financeLayout, /Documents & Reports/);
assert.match(financeLayout, /Staff & Workforce/);
assert.match(financeLayout, /Back to Equipment Divisions/);
assert.match(financeLayout, /workspaceCode="equipment_installment_finance"/);
assert.match(financeLayout, /no Hire-location selection/i);
assert.doesNotMatch(financeLayout, /workspaceCode="equipment_hire"/);
assert.doesNotMatch(financeLayout, /Open Equipment Hire Operations/);
assert.doesNotMatch(financeLayout, /Finance Equipment Reference/);

assert.match(hireLayout, /Equipment Hire Operations/);
assert.match(hireLayout, /Independent Hire staff division/);
assert.match(hireLayout, /No access to Finance applications or accounts/);
assert.doesNotMatch(hireLayout, /Open Equipment Installment Finance/);
assert.doesNotMatch(hireLayout, /title: "Installment Command Centre"/);
assert.doesNotMatch(hireLayout, /title: "Sales & Installments"/);
assert.doesNotMatch(hireLayout, /title: "Sales Documents & Reports"/);

assert.match(divisionAccess, /FINANCE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /HIRE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /canAccessEquipmentDivision/);
assert.match(divisionAccess, /is_original_system_administrator/);
assert.doesNotMatch(divisionAccess, /Number\(user\.id\) === 1/);

assert.match(fleetPage, /Navigate/);
assert.match(fleetPage, /\["installments", "sales", "reports"\]\.includes\(view\)/);
assert.match(fleetPage, /EQUIPMENT_DIVISIONS\.FINANCE/);
assert.match(fleetPage, /to="\/equipment-hire"/);
assert.match(fleetPage, /to="\/equipment-installment-finance"/);
assert.match(fleetPage, /to="\/equipment-installment-finance\/reports"/);
assert.doesNotMatch(fleetPage, /<EquipmentInstallmentCommandPage/);

assert.match(workspaceLayout, /independenceLabel = "Independent workspace"/);
assert.match(workspaceLayout, /const showIndependentNote = Boolean\(independenceLabel \|\| description\)/);
assert.match(workspaceLayout, /contextHeading = "Active operating context"/);
assert.match(workspaceLayout, /separationBadge = "Separated from Spare Parts"/);
assert.match(workspaceContext, /Company-wide Finance portfolio/);
assert.match(workspaceContext, /isManagedWorkspace: false/);
assert.match(axiosClient, /X-Chalin03-Division/);
assert.match(axiosClient, /installment_finance/);
assert.match(css, /@media \(max-width: 720px\)/);
assert.match(css, /finance-simple__machine-grid/);
assert.match(css, /finance-simple__dialog-backdrop/);
assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(serviceWorker, /cacheCoreAssets/);
assert.match(serviceWorker, /networkNavigation/);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);

// The resilient command backend remains available for advanced lifecycle/reminder work even
// though the default home now presents the nine-step Phase 3 path.
assert.match(route, /\/portfolio/);
assert.match(route, /\/collections/);
assert.match(route, /equipmentInstallmentReadModelService/);
assert.match(route, /follow-ups/);
assert.match(route, /reminders\/preview/);
assert.match(readModel, /resilient_read_model/);
assert.match(readModel, /information_schema\.COLUMNS/);
assert.match(readModel, /optional_evidence_deferred/);
assert.doesNotMatch(readModel, /UPDATE equipment_sale_agreements/);
assert.match(service, /portfolio_at_risk_rate/);
assert.match(service, /EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED/);
assert.match(service, /automatic_sms_enabled: false/);
assert.match(service, /GET_LOCK/);
assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE TABLE/i);

console.log("Equipment Installment Finance nine-step workflow contract passed.");
