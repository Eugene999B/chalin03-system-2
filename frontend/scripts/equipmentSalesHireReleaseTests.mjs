import assert from "assert";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname, "..");
const front = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const excavators = front("src/pages/EquipmentFinanceExcavatorsPage.jsx");
const phaseOneStyles = front("src/styles/equipmentFinancePhaseOne.css");
const reports = front("src/pages/EquipmentSalesReportsPage.jsx");
const secureUpload = front("src/components/EquipmentSecureUpload.jsx");
const secureUploadStyles = front("src/styles/equipmentSecureUpload.css");
const retirementBridge = front("src/components/InstallmentRetirementBridge.jsx");
const divisionAccess = front("src/security/equipmentDivisionAccess.js");
const axiosClient = front("src/api/axiosClient.js");
const workspaceContext = front("src/components/BusinessWorkspaceLayout.jsx");

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
assert.match(secureUpload, /MAX_SOURCE_BYTES = 25 \* 1024 \* 1024/);
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
