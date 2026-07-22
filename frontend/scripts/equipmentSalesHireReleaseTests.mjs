import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const wrapper = read("src/pages/FleetAssetsPage.jsx");
const sharedFleet = read("src/pages/SharedFleetAssetsPage.jsx");
const catalogue = read("src/pages/EquipmentCataloguePage.jsx");
const salesWorkspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const reportsPage = read("src/pages/EquipmentSalesReportsPage.jsx");
const catalogueStyles = read("src/styles/equipmentCatalogue.css");
const salesStyles = read("src/styles/equipmentSales.css");
const reportsStyles = read("src/styles/equipmentSalesReports.css");
const secureUpload = read("src/utils/equipmentMediaCaptureBridge.js");
const secureUploadStyles = read("src/styles/equipmentSecureUpload.css");
const retirementBridge = read(
  "src/utils/sparePartsInstallmentRetirementBridge.js"
);
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const axiosClient = read("src/api/axiosClient.js");

assert.match(wrapper, /isEquipmentHireWorkspace/);
assert.match(wrapper, /EquipmentCataloguePage/);
assert.match(wrapper, /EquipmentSalesWorkspacePage/);
assert.match(wrapper, /EquipmentSalesReportsPage/);
assert.match(wrapper, /view === "sales"/);
assert.match(wrapper, /view === "reports"/);
assert.match(wrapper, /SharedFleetAssetsPage/);
assert.doesNotMatch(wrapper, /EquipmentSalesPage/);
assert.match(sharedFleet, /axiosClient\.get\("\/fleet\/summary"\)/);
assert.match(sharedFleet, /FleetAssetsPage/);

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
assert.match(catalogue, /media\/:mediaId\/primary/);
assert.match(catalogue, /media\/:mediaId\/archive/);
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

assert.match(salesWorkspace, /Equipment Sales &amp; Installments/);
assert.match(salesWorkspace, /\/equipment-catalogue\/sales/);
assert.match(salesWorkspace, /\/summary/);
assert.match(salesWorkspace, /\/reference/);
assert.match(salesWorkspace, /\/enquiries/);
assert.match(salesWorkspace, /\/quotations/);
assert.match(salesWorkspace, /\/agreements/);
assert.match(salesWorkspace, /\/payments/);
assert.match(salesWorkspace, /\/delivery/);
assert.match(salesWorkspace, /\/ownership-transfer/);
assert.match(salesWorkspace, /\/sms/);
assert.match(salesWorkspace, /payment_frequency/);
assert.match(salesWorkspace, /installment_count/);
assert.match(salesWorkspace, /guarantor_name/);
assert.match(salesWorkspace, /terms_accepted/);
assert.match(salesWorkspace, /delivery_status/);
assert.match(salesWorkspace, /ownership_status/);
assert.match(salesWorkspace, /effectivePermissions\.includes\("fleet\.assets\.manage"\)/);
assert.doesNotMatch(salesWorkspace, /setSelected\w*\([^)]*\)\s*;\s*return\s*\{/);

assert.match(salesStyles, /\.equipment-sales\s*\{/);
assert.match(salesStyles, /\.equipment-sales__tabs/);
assert.match(salesStyles, /\.equipment-sales__sheet/);
assert.match(salesStyles, /\.equipment-sales__progress/);
assert.match(salesStyles, /@media \(max-width: 640px\)/);
assert.match(salesStyles, /max-height: 94dvh/);
assert.match(salesStyles, /env\(safe-area-inset-bottom\)/);

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
assert.match(retirementBridge, /installment agreement/);
assert.match(retirementBridge, /Historical/);

assert.match(hireLayout, /workspaceName="Equipment Sales & Hire"/);
assert.match(hireLayout, /title: "Equipment Catalogue"/);
assert.match(hireLayout, /title: "Sales & Installments"/);
assert.match(hireLayout, /title: "Sales Documents & Reports"/);
assert.match(hireLayout, /fleet\?view=sales/);
assert.match(hireLayout, /fleet\?view=reports/);
assert.match(hireLayout, /permissions: \["fleet\.assets\.view"\]/);
assert.match(hireLayout, /Spare Parts stores are never used here/);

assert.match(axiosClient, /equipmentMediaCaptureBridge/);
assert.match(axiosClient, /sparePartsInstallmentRetirementBridge/);
assert.match(axiosClient, /assertSparePartsInstallmentRequestAllowed/);
assert.match(axiosClient, /equipment_hire: "chalin03_active_context_equipment_hire"/);
assert.match(axiosClient, /X-Chalin03-Context-Id/);
assert.match(axiosClient, /response\.data\.delivery/);
assert.match(axiosClient, /response\.data\.ownership/);

console.log(
  "Equipment Sales & Hire final catalogue, sales, documents, reports, secure photos, reminders and Spare Parts retirement contracts passed."
);
