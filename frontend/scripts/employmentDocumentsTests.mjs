import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const employmentPage = read("src/pages/EmploymentDocumentsPage.jsx");
const signaturePage = read("src/pages/DocumentSignatureSettingsPage.jsx");
const app = read("src/App.jsx");
const spareLayout = read("src/components/Layout.jsx");
const miningLayout = read("src/layouts/MiningLayout.jsx");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");

assert.match(employmentPage, /standalone-hr\/documents/);
assert.match(employmentPage, /Approve & Sign/);
assert.match(employmentPage, /link-worker/);
assert.match(employmentPage, /No worker profile is created by this form/);
assert.match(signaturePage, /onPointerDown/);
assert.match(signaturePage, /toDataURL\("image\/png"\)/);
assert.match(signaturePage, /one finger/);
assert.match(app, /EmploymentDocumentsPage/);
assert.match(app, /DocumentSignatureSettingsPage/);
assert.match(spareLayout, /Employment & HR Documents/);
assert.match(miningLayout, /Employment & HR Documents/);
assert.match(hireLayout, /Employment & HR Documents/);

console.log("Standalone employment documents and signature frontend checks passed.");
