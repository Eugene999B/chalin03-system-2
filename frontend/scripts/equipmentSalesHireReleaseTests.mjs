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
const applications = read("src/pages/EquipmentFinanceApplicationsPage.jsx");
const wizard = read("src/pages/EquipmentFinanceStartWizardPage.jsx");
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

// Equipment Hire remains location-bound and separate.
assert.match(hireLayout, /workspaceName="Equipment Hire Operations"/);
assert.match(hireLayout, /title: "Hire Equipment Register"/);
assert.match(hireLayout, /Independent Hire staff division/);
assert.match(hireLayout, /No access to Finance applications or accounts/);
assert.doesNotMatch(hireLayout, /Open Equipment Installment Finance/);
assert.match(catalogue, /Choose an Equipment Hire location/);
assert.match(catalogue, /operational_purpose/);
assert.match(catalogue, /target_selling_price/);
assert.match(catalogue, /standard_hire_rate/);

// Finance has its own route tree and no Hire transaction context.
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

// The sidebar presents the simple daily journey.
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
  assert.match(financeLayout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(financeLayout, /Finance Equipment Reference/);
assert.doesNotMatch(financeLayout, /Credit Applications & Approval/);

// One grouped workspace keeps every governed stage reachable.
for (const pageName of [
  "EquipmentFinanceStartWizardPage",
  "EquipmentFinanceCustomerCentrePage",
  "EquipmentFinanceExcavatorsPage",
  "EquipmentFinanceApplicationsPage",
  "EquipmentFinanceAgreementActivationPage",
  "EquipmentFinanceDepositReservationPage",
  "EquipmentFinanceArrearsPage",
  "EquipmentFinanceRecoveryGovernancePage",
  "EquipmentFinanceFinalLifecyclePage",
]) {
  assert.match(workspace, new RegExp(pageName));
}
assert.match(workspace, /stage === "start"/);
assert.match(workspace, /stage === "customers"/);
assert.match(workspace, /stage === "machines"/);
assert.match(workspace, /stage === "activation"/);
assert.match(workspace, /stage === "deposit"/);
assert.match(workspace, /FINAL_LIFECYCLE_STAGES/);

// Starting a case creates the Installment Offer automatically.
assert.match(wizard, /Start New Installment/);
assert.match(wizard, /Installment Offer/);
assert.match(wizard, /created automatically/i);
assert.match(wizard, /\/equipment-finance\/professional\/phase-one\/start-installment/);
assert.match(wizard, /customer_name/);
assert.match(wizard, /asset_id/);
assert.match(wizard, /sale_price/);
assert.match(wizard, /deposit_amount/);
assert.match(wizard, /payment_frequency/);
assert.match(wizard, /installment_count/);
assert.match(wizard, /customer_consent_confirmed/);
assert.doesNotMatch(wizard, /Choose a Finance location|Choose a Hire location/);

// Applications retain KYC, affordability and independent decisions.
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

// Customer and excavator centres are reusable and complete.
assert.match(customers, /Customer Centre/);
assert.match(customers, /\/phase-one\/customers/);
assert.match(customers, /Start New Installment/);
assert.match(excavators, /Excavator Register/);
assert.match(excavators, /Edit excavator|Edit details/i);
assert.match(excavators, /serial_number/);
assert.match(excavators, /chassis_number/);
assert.match(excavators, /engine_number/);
assert.match(excavators, /objectFit:\s*"contain"|object-fit:\s*contain/);

// Phone layouts show complete money and photos without horizontal overflow.
assert.match(phaseOneStyles, /\.finance-simple/);
assert.match(phaseOneStyles, /overflow-wrap:\s*anywhere/);
assert.match(phaseOneStyles, /white-space:\s*normal/);
assert.match(phaseOneStyles, /object-fit:\s*contain/);
assert.match(phaseOneStyles, /@media \(max-width: 620px\)/);
assert.match(phaseOneStyles, /grid-template-columns:\s*1fr/);
assert.match(phaseOneStyles, /env\(safe-area-inset-bottom\)/);

// Existing document, upload and retirement controls remain present.
assert.match(reports, /Documents &amp; Management Reports/);
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
