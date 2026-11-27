import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/pages/EquipmentFinanceCaseWorkspacePage.jsx");
const route = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const workflow = read("src/pages/EquipmentFinanceMinimalWorkflowPage.jsx");
const css = read("src/styles/equipmentFinanceCaseWorkspace.css");

assert.match(page, /phase5e-case-workspace/);
assert.match(page, /\/private-documents/);
assert.match(page, /\/delivery-authorizations/);
assert.match(page, /\/finance-lifecycle/);
assert.match(page, /review-cases\/\$\{agreementId\}/);
assert.match(page, /documents\/\$\{documentRow\.id\}\/content/);
assert.match(page, /responseType: "blob"/);
assert.match(page, /URL\.createObjectURL/);
assert.match(page, /URL\.revokeObjectURL/);
assert.doesNotMatch(page, /[?&](token|access_token)=/i);
assert.match(page, /private_documents_upload/);
assert.match(page, /independent_document_review/);
assert.match(page, /document_approval/);
assert.match(page, /delivery_authorization_request/);
assert.match(page, /delivery_authorization_decision/);
assert.match(page, /Confirm authorized delivery/);
assert.match(page, /official balance/i);
assert.match(page, /Finance case activity/);
assert.match(route, /EquipmentFinanceCaseWorkspacePage/);
assert.match(route, /stage === "case-workspace"/);
assert.match(workflow, /Documents and delivery/);
assert.match(workflow, /finance-workflow-case-workspace/);
assert.match(css, /@media\(max-width:680px\)/);

console.log("Equipment Finance Phase 5E frontend source contracts passed.");
