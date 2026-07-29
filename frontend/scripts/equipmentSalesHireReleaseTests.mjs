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
const creditPage = read("src/pages/EquipmentCreditApplicationsPage.jsx");
const reportsPage = read("src/pages/EquipmentSalesReportsPage.jsx");
const catalogueStyles = read("src/styles/equipmentCatalogue.css");
const creditStyles = read("src/styles/equipmentCreditApplications.css");
const reportsStyles = read("src/styles/equipmentSalesReports.css");
const secureUpload = read("src/utils/equipmentMediaCaptureBridge.js");
const secureUploadStyles = read("src/styles/equipmentSecureUpload.css");
const retirementBridge = read(
  "src/utils/sparePartsInstallmentRetirementBridge.js"
);
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");
const axiosClient = read("src/api/axiosClient.js");

assert.match(wrapper, /isEquipmentHireWorkspace/);
assert.match(wrapper, /EquipmentCataloguePage/);
assert.match(wrapper, /Navigate/);
assert.match(wrapper, /view === "sales"/);
assert.match(wrapper, /view === "reports"/);
assert.match(wrapper, /to="\/equipment-installment-finance\/applications"/);
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

assert.match(salesWorkspace, /EquipmentCreditApplicationsPage/);
assert.match(creditPage, /Credit application, KYC and affordability/);
assert.match(
  creditPage,
  /const API = "\/equipment-catalogue\/sales\/credit-applications"/
);
assert.match(creditPage, /const SALES_API = "\/equipment-catalogue\/sales"/);
assert.match(creditPage, /\/readiness/);
assert.match(creditPage, /\/quotations/);
assert.match(creditPage, /kyc\/verify/);
assert.match(creditPage, /"review"/);
assert.match(creditPage, /"assess"/);
assert.match(creditPage, /"submit"/);
assert.match(creditPage, /monthly_salary_income/);
assert.match(creditPage, /existing_monthly_debt/);
assert.match(creditPage, /credit_assessment_consent_confirmed/);
assert.match(creditPage, /identity_document_url/);
assert.match(creditPage, /Approve credit application/);
assert.match(creditPage, /Agreement activation remains a separate controlled release/);
assert.match(creditPage, /effectivePermissions\.includes\("fleet\.assets\.manage"\)/);
assert.doesNotMatch(creditPage, /axiosClient\.post\(`\$\{SALES_API\}\/agreements/);
assert.doesNotMatch(creditPage, /ownership-transfer|equipment reserved|terms_accepted/);

assert.match(creditStyles, /\.credit-app\s*\{/);
assert.match(creditStyles, /\.credit-app__metrics/);
assert.match(creditStyles, /\.credit-app__drawer/);
assert.match(creditStyles, /\.credit-app__form-grid/);
assert.match(creditStyles, /@media \(max-width: 620px\)/);
assert.match(creditStyles, /grid-template-columns: 1fr;/);

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
assert.match(hireLayout, /title: "Equipment Catalogue"/);
assert.match(hireLayout, /Open Equipment Installment Finance/);
assert.doesNotMatch(hireLayout, /title: "Sales & Installments"/);
assert.doesNotMatch(hireLayout, /title: "Sales Documents & Reports"/);
assert.match(hireLayout, /permissions: \["fleet\.assets\.view"\]/);
assert.match(hireLayout, /Separated from Installment Finance/);

assert.match(financeLayout, /workspaceName="Equipment Installment Finance"/);
assert.match(financeLayout, /Finance Command Centre/);
assert.match(financeLayout, /Credit Applications & Approval/);
assert.match(financeLayout, /Installment Documents & Reports/);
assert.match(financeLayout, /Open Equipment Hire Operations/);
assert.match(financeLayout, /workspaceCode="equipment_hire"/);
assert.match(financeLayout, /Separated from Equipment Hire operations/);

assert.match(axiosClient, /equipmentMediaCaptureBridge/);
assert.match(axiosClient, /sparePartsInstallmentRetirementBridge/);
assert.match(axiosClient, /assertSparePartsInstallmentRequestAllowed/);
assert.match(axiosClient, /equipment_hire: "chalin03_active_context_equipment_hire"/);
assert.match(axiosClient, /X-Chalin03-Context-Id/);
assert.match(axiosClient, /response\.data\.delivery/);
assert.match(axiosClient, /response\.data\.ownership/);

console.log(
  "Equipment Hire and Equipment Installment Finance separation contracts passed."
);
