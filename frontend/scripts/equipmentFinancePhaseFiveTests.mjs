import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("src/pages/EquipmentFinanceDocumentsDeliveryPage.jsx");
const routePage = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const workflow = read("src/pages/EquipmentFinanceMinimalWorkflowPage.jsx");
const css = read("src/styles/equipmentFinanceDocumentsDelivery.css");

assert.match(page, /phase5-documents-delivery-page/);
assert.match(page, /Required documents/);
assert.match(page, /KYC identity/);
assert.match(page, /Guarantor identity/);
assert.match(page, /Agreement attachment/);
assert.match(page, /Private files are encrypted/);
assert.match(page, /private access only/i);
assert.match(page, /Independent review/);
assert.match(page, /Approve documents/);
assert.match(page, /Delivery authorization/);
assert.match(page, /Confirm equipment delivery/);
assert.match(page, /Finance case activity/);
assert.match(page, /Staff permissions/);
assert.match(page, /phase5-upload-document/);
assert.match(page, /phase5-authorize-delivery/);
assert.match(page, /phase5-confirm-delivery/);
assert.match(page, /\/equipment-catalogue\/sales\/documents-delivery/);
assert.match(page, /`\$\{API\}\/cases/);
assert.match(page, /\/equipment-catalogue\/sales\/finance-lifecycle/);
assert.match(page, /`\$\{LIFECYCLE_API\}\/accounts/);
assert.match(routePage, /EquipmentFinanceDocumentsDeliveryPage/);
assert.match(routePage, /stage === "documents-delivery"/);
assert.match(workflow, /Phase 5/);
assert.match(workflow, /documents-delivery/);
assert.match(css, /@media \(max-width: 680px\)/);
assert.match(css, /phase5-permissions/);

console.log("Equipment Finance Phase 5 frontend source contracts passed.");
