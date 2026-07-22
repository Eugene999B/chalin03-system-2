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
const catalogueStyles = read("src/styles/equipmentCatalogue.css");
const secureUpload = read("src/utils/equipmentMediaCaptureBridge.js");
const secureUploadStyles = read("src/styles/equipmentSecureUpload.css");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const axiosClient = read("src/api/axiosClient.js");

assert.match(wrapper, /isEquipmentHireWorkspace/);
assert.match(wrapper, /EquipmentCataloguePage/);
assert.match(wrapper, /SharedFleetAssetsPage/);
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
assert.match(secureUpload, /image\/webp/);
assert.match(secureUpload, /setReactInputValue/);
assert.match(secureUpload, /equipment-secure-upload__preview/);
assert.match(secureUpload, /Take a photo or choose one/);
assert.match(secureUploadStyles, /equipment-secure-upload__legacy-url/);
assert.match(secureUploadStyles, /display: none !important/);
assert.match(secureUploadStyles, /equipment-secure-upload__preview\.is-ready/);

assert.match(hireLayout, /workspaceName="Equipment Sales & Hire"/);
assert.match(hireLayout, /title: "Equipment Catalogue"/);
assert.match(hireLayout, /path: "\/equipment-hire-operations\/fleet"/);
assert.match(hireLayout, /permissions: \["fleet\.assets\.view"\]/);
assert.match(hireLayout, /Spare Parts stores are never used here/);

assert.match(axiosClient, /equipmentMediaCaptureBridge/);
assert.match(axiosClient, /equipment_hire: "chalin03_active_context_equipment_hire"/);
assert.match(axiosClient, /X-Chalin03-Context-Id/);

console.log("Equipment Sales & Hire mobile catalogue and secure camera contracts passed.");
