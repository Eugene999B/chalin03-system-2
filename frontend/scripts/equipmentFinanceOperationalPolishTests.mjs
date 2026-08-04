import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const workspace = read("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const startRedirect = read(
  "src",
  "pages",
  "EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);
const start = read("src", "pages", "EquipmentFinanceOperationalStartImmediatePage.jsx");
const operations = read("src", "pages", "EquipmentFinanceOperationalPolishPage.jsx");
const layout = read("src", "layouts", "InstallmentFinanceLayout.jsx");
const styles = read("src", "styles", "equipmentFinanceOperationalPolish.css");

assert.match(workspace, /EquipmentFinancePhaseThreeStartRedirectPage/);
assert.match(workspace, /EquipmentFinanceOperationalPolishPage/);
assert.match(workspace, /stage === "start"/);
assert.match(workspace, /stage === "operations"/);
assert.match(
  workspace,
  /if \(!stage \|\| stage === "applications" \|\| stage === "start"\)/
);
assert.match(startRedirect, /EquipmentFinanceOperationalStartImmediatePage/);
assert.match(startRedirect, /axiosClient\.interceptors\.response\.use/);
assert.match(startRedirect, /START_INSTALLMENT_PATH/);
assert.match(startRedirect, /successfulCreation\(response\)/);
assert.match(startRedirect, /window\.location\.replace\(safeNextPath\(response\)\)/);
assert.match(startRedirect, /chalin03_finance_creation_notice/);
assert.match(startRedirect, /clearCommittedDraft\(\)/);
assert.match(startRedirect, /let redirecting = false/);

for (const phrase of [
  "server draft",
  "FINANCE_DRAFT_VERSION_CONFLICT",
  "known_version",
  "Use latest server draft",
  "Keep this device draft",
  "Server recovery never blocks this screen",
  "EquipmentFinanceStartWizardPage",
]) {
  assert.match(start, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
assert.match(start, /chalin03\.finance\.start-installment\.v1/);
assert.match(start, /window\.localStorage/);
assert.match(start, /chalin03:finance-draft-change/);
assert.match(start, /RECOVERY_TIMEOUT_MS = 8000/);
assert.match(start, /SAVE_TIMEOUT_MS = 12000/);
assert.doesNotMatch(start, /Preparing secure draft recovery/);
assert.doesNotMatch(start, /setInterval/);
assert.match(start, /fleet\.assets\.manage/);

for (const tab of [
  "Task & Approval Inbox",
  "Case Timeline",
  "Secure Documents",
  "Missing & Quality Alerts",
  "Schedule Simulator",
  "Corrections & Amendments",
  "Receipts & Sharing",
]) {
  assert.match(operations, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const endpoint of [
  "/bootstrap",
  "/tasks",
  "/documents",
  "/approval",
  "/schedule/simulate",
  "/schedule/simulations",
  "/amendments",
  "/receipt",
  "/boss-alert/retry",
  "/issued-documents/",
]) {
  assert.match(operations, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(operations, /FileReader/);
assert.match(operations, /8 \* 1024 \* 1024/);
assert.match(operations, /application\/pdf,image\/jpeg,image\/png,image\/webp/);
assert.match(operations, /responseType: "blob"/);
assert.match(operations, /AbortController/);
assert.match(operations, /CASE_PAGE_SIZE/);
assert.match(operations, /INBOX_PAGE_SIZE/);
assert.match(operations, /has_next_page/);
assert.match(operations, /kyc_identity/);
assert.match(operations, /agreement_attachment/);
assert.doesNotMatch(operations, /buyer_id_front/);
assert.match(operations, /navigator\.clipboard/);
assert.match(operations, /window\.print/);
assert.match(operations, /Financial fields will remain original records/);
assert.match(operations, /This never changes the live agreement or payment records/);
assert.doesNotMatch(operations, /selectedContextId|useWorkspaceContext/);

assert.match(layout, /Task & Approval Inbox/);
assert.match(layout, /Case Operations/);
assert.match(layout, /stage=operations&tab=inbox/);
assert.match(layout, /stage=operations&tab=case/);
assert.doesNotMatch(layout, /Independent Finance staff division/);

assert.match(styles, /\.finance-draft-bar/);
assert.match(styles, /\.finance-ops__timeline/);
assert.match(styles, /\.finance-thermal-receipt/);
assert.match(styles, /@media \(max-width: 720px\)/);
assert.match(styles, /@media print/);
assert.match(styles, /width: 80mm/);
assert.match(styles, /overflow-x: auto/);
assert.match(styles, /overflow-wrap: anywhere/);

console.log("Equipment Finance Phase 3 operational polish frontend contract passed.");
