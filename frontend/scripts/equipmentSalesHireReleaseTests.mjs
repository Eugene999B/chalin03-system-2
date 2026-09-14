import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const fleetWrapper = read("src/pages/FleetAssetsPage.jsx");
const catalogue = read("src/pages/EquipmentCataloguePage.jsx");
const workspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const phaseThreeStart = read("src/pages/EquipmentFinancePhaseThreeStartRedirectPage.jsx");
const operationalStart = read("src/pages/EquipmentFinanceOperationalStartImmediatePage.jsx");
const applications = read("src/pages/EquipmentFinanceApplicationsPage.jsx");
const wizard = read("src/pages/EquipmentFinanceStartWizardPage.jsx");
const minimalWorkflow = read("src/pages/EquipmentFinanceMinimalWorkflowPage.jsx");
const collections = read("src/pages/EquipmentFinanceCollectionsMinimalPage.jsx");
const customers = read("src/pages/EquipmentFinanceCustomerCentrePage.jsx");
const excavators = read("src/pages/EquipmentFinanceExcavatorsPage.jsx");
const reports = read("src/pages/EquipmentSalesReportsPage.jsx");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");
const phaseOneStyles = read("src/styles/equipmentFinancePhaseOne.css");
const secureUpload = read("src/utils/equipmentMediaCaptureBridge.js");
const secureUploadStyles = read("src/styles/equipmentSecureUpload.css");
const retirementBridge = read("src/utils/sparePartsInstallmentRetirementBridge.js");
const divisionAccess = read("src/security/equipmentDivisionAccess.js");
const axiosClient = read("src/api/axiosClient.js");
const workspaceContext = read("src/context/WorkspaceContext.jsx");

assert.match(hireLayout, /workspaceName="Equipment Hire Operations"/);
assert.match(hireLayout, /title: "Hire Equipment Register"/);
assert.match(hireLayout, /Independent Hire staff division/);
assert.match(hireLayout, /No access to Finance applications or accounts/);
assert.doesNotMatch(hireLayout, /Open Equipment Installment Finance/);
assert.match(catalogue, /Choose an Equipment Hire location/);
assert.match(catalogue, /operational_purpose/);
assert.match(catalogue, /target_selling_price/);
assert.match(catalogue, /standard_hire_rate/);

assert.match(app, /path="\/equipment-installment-finance"/);
assert.match(app, /InstallmentFinanceLayout/);
assert.match(app, /EquipmentSalesWorkspacePage/);
assert.match(fleetWrapper, /EQUIPMENT_DIVISIONS\.FINANCE/);
assert.match(fleetWrapper, /to="\/equipment-installment-finance"/);
assert.match(financeLayout, /workspaceCode="equipment_installment_finance"/);
assert.match(financeLayout, /company-wide Finance portfolio/i);
assert.match(financeLayout, /no Hire-location selection/i);
assert.match(financeLayout, /No access to Hire jobs or contracts/);
assert.doesNotMatch(financeLayout, /workspaceCode="equipment_hire"/);
assert.doesNotMatch(financeLayout, /Open Equipment Hire Operations/);

for (const title of [
  "Finance Home",
  "Task & Approval Inbox",
  "Start New Installment",
  "Customers",
  "Excavators",
  "Applications & Approvals",
  "Case Operations",
  "Active Installments",
  "Payments & Arrears",
  "Documents & Reports",
  "Finance Settings",
  "Help & Guide",
]) {
  assert.match(financeLayout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(financeLayout, /Finance Equipment Reference/);
assert.doesNotMatch(financeLayout, /Credit Applications & Approval/);

for (const pageName of [
  "EquipmentFinancePhaseThreeStartRedirectPage",
  "EquipmentFinanceOperationalPolishPage",
  "EquipmentFinanceCustomerCentrePage",
  "EquipmentFinanceExcavatorsPage",
  "EquipmentFinanceApplicationsPage",
  "EquipmentFinanceAgreementActivationPage",
  "EquipmentFinanceDepositReservationPage",
  "EquipmentFinanceCollectionsMinimalPage",
  "EquipmentFinanceArrearsPage",
  "EquipmentFinanceRecoveryGovernancePage",
  "EquipmentFinanceFinalLifecyclePage",
]) {
  assert.match(workspace, new RegExp(pageName));
}
assert.match(phaseThreeStart, /EquipmentFinanceOperationalStartImmediatePage/);
assert.match(phaseThreeStart, /axiosClient\.interceptors\.response\.use/);
assert.match(phaseThreeStart, /START_INSTALLMENT_PATH/);
assert.match(phaseThreeStart, /navigate\(safeNextPath\(response\)/);
assert.match(phaseThreeStart, /replace: true/);
assert.match(operationalStart, /EquipmentFinanceStartWizardPage/);
assert.match(operationalStart, /drafts\/start-installment/);
assert.match(operationalStart, /recoverInBackground/);
assert.match(operationalStart, /Server recovery never blocks this screen/);
assert.doesNotMatch(operationalStart, /Preparing secure draft recovery/);
assert.match(workspace, /stage === "start"/);
assert.match(workspace, /stage === "operations"/);
assert.match(workspace, /stage === "customers"/);
assert.match(workspace, /stage === "machines"/);
assert.match(workspace, /stage === "activation"/);
assert.match(workspace, /stage === "deposit"/);
assert.match(workspace, /stage === "collections"/);
assert.match(workspace, /FINAL_LIFECYCLE_STAGES/);
assert.match(
  workspace,
  /if \(!stage \|\| stage === "applications" \|\| stage === "start"\)/
);

assert.match(wizard, /Start New Installment/);
assert.match(wizard, /create a draft/i);
assert.match(minimalWorkflow, /automatic Installment Offer/);
assert.match(minimalWorkflow, /Complete these nine actions/);
assert.match(wizard, /const API = "\/equipment-catalogue\/sales\/phase-one"/);
assert.match(wizard, /`\$\{API\}\/start-installment`/);
assert.match(wizard, /customer_name/);
assert.match(wizard, /asset_id/);
assert.match(wizard, /selling_price/);
assert.match(wizard, /deposit/);
assert.match(wizard, /payment_frequency/);
assert.match(wizard, /installment_count/);
assert.match(wizard, /customer_consent_confirmed/);
assert.doesNotMatch(wizard, /Choose a Finance location|Choose a Hire location/);

assert.match(collections, /Collections &amp; Payment History/);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);
assert.match(collections, /\/collections/);
// Collections reads authoritative balances/dates from the backend account API.
assert.match(collections, /axiosClient\.get\(\x60\$\{API\}\/accounts\//);
assert.match(collections, /response\.data\?\.schedule/);

assert.match(applications, /const API = "\/equipment-catalogue\/sales\/credit-applications"/);
assert.match(applications, /\/readiness/);
assert.match(applications, /\/assess/);
assert.match(applications, /\/submit/);
assert.match(applications, /kyc\/verify/);
assert.match(applications, /\/review/);
assert.match(applications, /Approve credit application/);
assert.match(applications, /Request changes/);
assert.match(applications, /No Hire-location selection is needed/);
assert.doesNotMatch(applications, /ownership-transfer|deliveries\/complete/);

assert.match(customers, /Customer Centre/);
assert.match(customers, /\/phase-one\/customers/);
assert.match(customers, /Start New Installment/);
assert.match(excavators, /<h1>Excavators<\/h1>/);
assert.match(excavators, /Machine register/);
assert.match(excavators, /Edit details/);
assert.match(excavators, /serial_number/);
assert.match(excavators, /chassis_number/);
assert.match(excavators, /engine_number/);
assert.match(excavators, /finance-simple__machine-image/);
assert.match(excavators, /finance-simple__photo-viewer/);

assert.match(phaseOneStyles, /\.finance-simple/);
assert.match(phaseOneStyles, /overflow-wrap:\s*anywhere/);
assert.match(phaseOneStyles, /white-space:\s*normal/);
assert.match(phaseOneStyles, /object-fit:\s*contain/);
assert.match(phaseOneStyles, /@media \(max-width: 720px\)/);
assert.match(phaseOneStyles, /grid-template-columns:\s*1fr/);
assert.match(phaseOneStyles, /\.finance-simple__sticky-actions/);
assert.match(phaseOneStyles, /bottom:\s*0/);

assert.match(reports, /Documents &amp; Reports/);
assert.match(reports, /\/reports\/management/);
assert.match(reports, /\/reports\/export\.csv/);
assert.match(reports, /documents\/agreement\.pdf/);
assert.match(reports, /documents\/statement\.pdf/);
assert.match(reports, /documents\/delivery\.pdf/);
assert.match(reports, /documents\/ownership\.pdf/);
assert.match(reports, /\/receipt\.pdf/);
assert.match(secureUpload, /async function optimizeEquipmentPhoto/);
assert.match(secureUpload, /MAX_SOURCE_BYTES = 15 \* 1024 \* 1024/);
assert.match(secureUpload, /canvas\.toBlob/);
assert.match(secureUploadStyles, /display: none !important/);
assert.match(retirementBridge, /Spare Parts installment sales have moved/);
assert.match(retirementBridge, /SPARE_PARTS_INSTALLMENTS_RETIRED/);

assert.match(divisionAccess, /HIRE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /FINANCE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /canAccessEquipmentDivision/);
assert.match(axiosClient, /X-Chalin03-Division/);
assert.match(axiosClient, /installment_finance/);
assert.match(workspaceContext, /Company-wide Finance portfolio/);
assert.match(workspaceContext, /isManagedWorkspace: false/);

console.log("Equipment Hire separation and simplified Installment Finance contracts passed.");