import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const wrapper = read("src/pages/FleetAssetsPage.jsx");
const sharedFleet = read("src/pages/SharedFleetAssetsPage.jsx");
const catalogue = read("src/pages/EquipmentCataloguePage.jsx");
const salesWorkspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const applicationsPage = read("src/pages/EquipmentFinanceApplicationsPage.jsx");
const startWizard = read("src/pages/EquipmentFinanceStartWizardPage.jsx");
const customerCentre = read("src/pages/EquipmentFinanceCustomerCentrePage.jsx");
const excavatorsPage = read("src/pages/EquipmentFinanceExcavatorsPage.jsx");
const reportsPage = read("src/pages/EquipmentSalesReportsPage.jsx");
const catalogueStyles = read("src/styles/equipmentCatalogue.css");
const phaseOneStyles = read("src/styles/equipmentFinancePhaseOne.css");
const reportsStyles = read("src/styles/equipmentSalesReports.css");
const secureUpload = read("src/utils/equipmentMediaCaptureBridge.js");
const secureUploadStyles = read("src/styles/equipmentSecureUpload.css");
const retirementBridge = read(
  "src/utils/sparePartsInstallmentRetirementBridge.js"
);
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");
const divisionAccess = read("src/security/equipmentDivisionAccess.js");
const staffManager = read("src/components/EquipmentDivisionStaffManager.jsx");
const axiosClient = read("src/api/axiosClient.js");
const workspaceContext = read("src/context/WorkspaceContext.jsx");

assert.match(wrapper, /isEquipmentHireWorkspace/);
assert.match(wrapper, /EquipmentCataloguePage/);
assert.match(wrapper, /Navigate/);
assert.match(wrapper, /\["installments", "sales", "reports"\]\.includes\(view\)/);
assert.match(wrapper, /canAccessEquipmentDivision/);
assert.match(wrapper, /EQUIPMENT_DIVISIONS\.FINANCE/);
assert.match(wrapper, /to="\/equipment-hire"/);
assert.match(wrapper, /to="\/equipment-installment-finance"/);
assert.match(wrapper, /to="\/equipment-installment-finance\/reports"/);
assert.match(wrapper, /SharedFleetAssetsPage/);
assert.doesNotMatch(wrapper, /<EquipmentSalesWorkspacePage/);
assert.doesNotMatch(wrapper, /<EquipmentSalesReportsPage/);
assert.doesNotMatch(wrapper, /EquipmentSalesPage/);
assert.match(sharedFleet, /axiosClient\.get\("\/fleet\/summary"\)/);
assert.match(sharedFleet, /FleetAssetsPage/);

assert.match(app, /path="\/equipment-installment-finance"/);
assert.match(app, /EquipmentSalesWorkspacePage/);
assert.match(app, /EquipmentSalesReportsPage/);
assert.match(app, /InstallmentFinanceLayout/);
assert.match(app, /allowedWorkspaces=\{EQUIPMENT_HIRE_WORKSPACE\}/);

assert.match(catalogue, /Equipment Sales &amp; Hire/);
assert.match(catalogue, /Equipment Catalogue/);
assert.match(catalogue, /\/equipment-catalogue\/summary/);
assert.match(catalogue, /\/equipment-catalogue\/assets/);
assert.match(catalogue, /operational_purpose/);
assert.match(catalogue, /target_selling_price/);
assert.match(catalogue, /standard_hire_rate/);
assert.match(catalogue, /serial_number/);
assert.match(catalogue, /chassis_number/);
assert.match(catalogue, /engine_number/);
assert.match(catalogue, /capture="environment"/);
assert.match(
  catalogue,
  /`\/equipment-catalogue\/assets\/\$\{assetId\}\/media\/\$\{mediaId\}\/primary`/
);
assert.match(
  catalogue,
  /`\/equipment-catalogue\/assets\/\$\{assetId\}\/media\/\$\{mediaId\}\/archive`/
);
assert.match(catalogue, /Choose an Equipment Hire location/);
assert.match(catalogue, /effectivePermissions\.includes\("fleet\.assets\.manage"\)/);

assert.match(catalogueStyles, /\.equipment-catalogue\s*\{/);
assert.match(catalogueStyles, /\.equipment-card/);
assert.match(catalogueStyles, /\.equipment-catalogue__sheet/);
assert.match(catalogueStyles, /@media \(max-width: 560px\)/);
assert.match(catalogueStyles, /grid-template-columns: 1fr;/);
assert.match(catalogueStyles, /env\(safe-area-inset-bottom\)/);

assert.match(secureUpload, /async function optimizeEquipmentPhoto/);
assert.match(secureUpload, /MAX_SOURCE_BYTES = 15 \* 1024 \* 1024/);
assert.match(secureUpload, /MAX_STORED_BYTES = 44 \* 1024/);
assert.match(secureUpload, /canvas\.toBlob/);
assert.match(secureUpload, /PROTECTED_MIME_TYPE = "image\/jpeg"/);
assert.match(secureUpload, /\.concat\("\.jpg"\)/);
assert.match(secureUpload, /setReactInputValue/);
assert.match(secureUpload, /equipment-secure-upload__preview/);
assert.match(secureUpload, /Take a photo or choose one/);
assert.match(secureUpload, /PDF documents/);
assert.match(secureUploadStyles, /equipment-secure-upload__legacy-url/);
assert.match(secureUploadStyles, /display: none !important/);
assert.match(secureUploadStyles, /equipment-secure-upload__preview\.is-ready/);

assert.match(salesWorkspace, /EquipmentFinanceStartWizardPage/);
assert.match(salesWorkspace, /EquipmentFinanceCustomerCentrePage/);
assert.match(salesWorkspace, /EquipmentFinanceExcavatorsPage/);
assert.match(salesWorkspace, /EquipmentFinanceApplicationsPage/);
assert.match(salesWorkspace, /stage === "start"/);
assert.match(salesWorkspace, /stage === "customers"/);
assert.match(salesWorkspace, /stage === "machines"/);
assert.match(salesWorkspace, /FINAL_LIFECYCLE_STAGES/);

assert.match(applicationsPage, /Applications and approvals/i);
assert.match(
  applicationsPage,
  /const API = "\/equipment-catalogue\/sales\/credit-applications"/
);
assert.match(applicationsPage, /\/readiness/);
assert.match(applicationsPage, /kyc\/verify/);
assert.match(applicationsPage, /"review"/);
assert.match(applicationsPage, /"assess"/);
assert.match(applicationsPage, /"submit"/);
assert.match(applicationsPage, /Approve credit application/);
assert.match(applicationsPage, /No Hire-location selection is needed/);
assert.doesNotMatch(applicationsPage, /Choose a specific equipment location/);
assert.doesNotMatch(applicationsPage, /axiosClient\.post\(`\$\{SALES_API\}\/agreements/);

assert.match(startWizard, /Start New Installment/);
assert.match(startWizard, /Installment Offer/);
assert.match(startWizard, /created automatically/i);
assert.match(startWizard, /\/equipment-finance\/professional\/phase-one\/start-installment/);
assert.doesNotMatch(startWizard, /Choose a Finance location|Choose a Hire location/);
assert.match(customerCentre, /Customer Centre/);
assert.match(customerCentre, /\/phase-one\/customers/);
assert.match(excavatorsPage, /Excavator Register/);
assert.match(excavatorsPage, /objectFit:\s*"contain"|object-fit:\s*contain/);
assert.match(excavatorsPage, /Edit excavator|Edit details/i);

assert.match(phaseOneStyles, /\.finance-simple/);
assert.match(phaseOneStyles, /overflow-wrap:\s*anywhere/);
assert.match(phaseOneStyles, /object-fit:\s*contain/);
assert.match(phaseOneStyles, /@media \(max-width: 620px\)/);
assert.match(phaseOneStyles, /grid-template-columns:\s*1fr/);
assert.match(phaseOneStyles, /env\(safe-area-inset-bottom\)/);

assert.match(reportsPage, /Documents &amp; Management Reports/);
assert.match(reportsPage, /\/reports\/management/);
assert.match(reportsPage, /\/reports\/export\.csv/);
assert.match(reportsPage, /\/retirement-status/);
assert.match(reportsPage, /\/reminders\/run/);
assert.match(reportsPage, /\/quotation\.pdf/);
assert.match(reportsPage, /documents\/agreement\.pdf/);
assert.match(reportsPage, /documents\/statement\.pdf/);
assert.match(reportsPage, /documents\/delivery\.pdf/);
assert.match(reportsPage, /documents\/ownership\.pdf/);
assert.match(reportsPage, /documents\/overdue\.pdf/);
assert.match(reportsPage, /\/receipt\.pdf/);
assert.match(reportsPage, /Installment Aging/);
assert.match(reportsPage, /Expected Collections/);
assert.match(reportsPage, /Sales by Staff/);
assert.match(reportsPage, /Spare Parts installments retired/);

assert.match(reportsStyles, /\.equipment-sales-reports\s*\{/);
assert.match(reportsStyles, /\.equipment-sales-reports__metrics/);
assert.match(reportsStyles, /\.equipment-sales-reports__documents/);
assert.match(reportsStyles, /@media \(max-width: 560px\)/);
assert.match(reportsStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(reportsStyles, /env\(safe-area-inset-bottom\)/);

assert.match(retirementBridge, /Spare Parts installment sales have moved/);
assert.match(retirementBridge, /payment_type/);
assert.match(retirementBridge, /SPARE_PARTS_INSTALLMENTS_RETIRED/);
assert.match(retirementBridge, /window\.location\.pathname !== "\/installments"/);
assert.match(retirementBridge, /window\.location\.replace\("\/new-sale"\)/);
assert.match(retirementBridge, /option\[value="installment"\]/);
assert.match(retirementBridge, /Equipment installments are handled in Equipment Installment Finance/);
assert.match(retirementBridge, /Spare Parts supports Cash, MoMo, Bank, Credit and Mixed sales/);

assert.match(hireLayout, /workspaceName="Equipment Hire Operations"/);
assert.match(hireLayout, /title: "Hire Equipment Register"/);
assert.match(hireLayout, /Independent Hire staff division/);
assert.match(hireLayout, /No access to Finance applications or accounts/);
assert.doesNotMatch(hireLayout, /Open Equipment Installment Finance/);
assert.doesNotMatch(hireLayout, /title: "Sales & Installments"/);
assert.doesNotMatch(hireLayout, /title: "Sales Documents & Reports"/);
assert.match(hireLayout, /permissions: \["fleet\.assets\.view"\]/);

assert.match(financeLayout, /workspaceName="Equipment Installment Finance"/);
assert.match(financeLayout, /title: "Finance Home"/);
assert.match(financeLayout, /title: "Start New Installment"/);
assert.match(financeLayout, /title: "Customers"/);
assert.match(financeLayout, /title: "Excavators"/);
assert.match(financeLayout, /title: "Applications & Approvals"/);
assert.match(financeLayout, /title: "Active Installments"/);
assert.match(financeLayout, /title: "Payments & Arrears"/);
assert.match(financeLayout, /title: "Documents & Reports"/);
assert.match(financeLayout, /title: "Help & Guide"/);
assert.match(financeLayout, /Back to Equipment Divisions/);
assert.match(financeLayout, /workspaceCode="equipment_installment_finance"/);
assert.match(financeLayout, /no Hire-location selection/i);
assert.match(financeLayout, /No access to Hire jobs or contracts/);
assert.doesNotMatch(financeLayout, /workspaceCode="equipment_hire"/);
assert.doesNotMatch(financeLayout, /Open Equipment Hire Operations/);
assert.doesNotMatch(financeLayout, /Finance Equipment Reference/);
assert.doesNotMatch(financeLayout, /Credit Applications & Approval/);

assert.match(divisionAccess, /HIRE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /FINANCE_WORKSPACE_ROLES/);
assert.match(divisionAccess, /canAccessEquipmentDivision/);
assert.match(staffManager, /Manage Division Staff/);
assert.match(staffManager, /exactly one role family/);
assert.match(staffManager, /workspace-context\/equipment-divisions\/staff/);

assert.match(axiosClient, /equipmentMediaCaptureBridge/);
assert.match(axiosClient, /sparePartsInstallmentRetirementBridge/);
assert.match(axiosClient, /assertSparePartsInstallmentRequestAllowed/);
assert.match(axiosClient, /equipment_hire: "chalin03_active_context_equipment_hire"/);
assert.match(axiosClient, /X-Chalin03-Context-Id/);
assert.match(axiosClient, /X-Chalin03-Division/);
assert.match(axiosClient, /installment_finance/);
assert.match(axiosClient, /response\.data\.delivery/);
assert.match(axiosClient, /response\.data\.ownership/);
assert.match(workspaceContext, /Company-wide Finance portfolio/);
assert.match(workspaceContext, /isManagedWorkspace: false/);

console.log(
  "Equipment Hire separation and simplified Installment Finance contracts passed."
);
