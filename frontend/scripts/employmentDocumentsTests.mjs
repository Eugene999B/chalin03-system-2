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
const signatureStyles = read("src/styles/documentSignatureSettings.css");
const workforcePage = read("src/pages/EquipmentBusinessWorkforcePage.jsx");
const app = read("src/App.jsx");
const spareLayout = read("src/components/Layout.jsx");
const miningLayout = read("src/layouts/MiningLayout.jsx");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");

assert.match(employmentPage, /standalone-hr\/documents/);
assert.match(employmentPage, /Approve & Sign/);
assert.match(employmentPage, /link-worker/);
assert.match(employmentPage, /canApproveOrArchive/);
assert.match(employmentPage, /\["issued", "acknowledged"\]\.includes\(document\.status\)/);
assert.match(employmentPage, /No worker profile is created by this form/);
assert.match(signaturePage, /onPointerDown/);
assert.match(signaturePage, /toDataURL\("image\/png"\)/);
assert.match(signaturePage, /one finger/);
assert.match(signaturePage, /trimmedSignatureDataUrl/);
assert.match(signaturePage, /ResizeObserver/);
assert.match(signaturePage, /getCoalescedEvents/);
assert.match(signaturePage, /Undo/);
assert.match(signaturePage, /Redo/);
assert.match(signaturePage, /Open Large Pad/);
assert.match(signaturePage, /Exact New Output/);
assert.match(signaturePage, /signature-safe-area/);
assert.match(signatureStyles, /@media \(max-width: 560px\)/);
assert.match(signatureStyles, /\.signature-editor\.expanded/);
assert.match(signatureStyles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(signatureStyles, /touch-action: none/);
assert.match(app, /EmploymentDocumentsPage/);
assert.match(app, /DocumentSignatureSettingsPage/);
assert.match(spareLayout, /Employment & HR Documents/);
assert.match(miningLayout, /Employment & HR Documents/);
assert.match(hireLayout, /title: "Staff & Workforce"/);
assert.match(financeLayout, /title: "Staff & Workforce"/);
assert.match(workforcePage, /EmploymentDocumentsPage/);
assert.match(workforcePage, /tab === "documents"/);

console.log("Standalone employment documents and grouped workforce navigation checks passed.");