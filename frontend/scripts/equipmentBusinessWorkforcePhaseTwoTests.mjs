import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const page = read("src/pages/EquipmentBusinessWorkforcePage.jsx");
const css = read("src/styles/equipmentBusinessWorkforce.css");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");
const businessLayout = read("src/components/BusinessWorkspaceLayout.jsx");
const workerProfiles = read("src/pages/ExpandedWorkerProfilePage.jsx");
const documents = read("src/pages/EmploymentDocumentsPage.jsx");
const permissionManager = read("src/pages/UserPermissionManagerPage.jsx");

assert.match(app, /EquipmentBusinessWorkforcePage/);
assert.match(app, /path="workforce"/);
assert.match(app, /<EquipmentBusinessWorkforcePage \/>/);
assert.match(hireLayout, /title: "Staff & Workforce"/);
assert.match(hireLayout, /\/equipment-hire-operations\/workforce/);
assert.match(financeLayout, /title: "Staff & Workforce"/);
assert.match(financeLayout, /\/equipment-installment-finance\/workforce/);

for (const phrase of [
  "Create Staff Login",
  "Role Templates & Default Permissions",
  "Worker Profiles & ID Cards",
  "Employment Documents",
  "Permission Overrides",
  "Hire / Finance / Dual",
]) {
  assert.match(page, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(page, /\/workspace-context\/equipment-divisions/);
assert.match(page, /axiosClient\.post\(`\$\{API\}\/staff`, form\)/);
assert.match(page, /axiosClient\.put\(`\$\{API\}\/staff\/\$\{person\.id\}`/);
assert.match(page, /force_password_change/);
assert.match(page, /location_ids/);
assert.match(page, /financeMode \? "finance_manager" : "hire_officer"/);
assert.match(page, /ExpandedWorkerProfilePage/);
assert.match(page, /EmploymentDocumentsPage/);
assert.match(page, /UserPermissionManagerPage/);

assert.match(workerProfiles, /ID Card/);
assert.match(workerProfiles, /workers-expanded/);
assert.match(documents, /Employment/);
assert.match(permissionManager, /explicit user grant/i);
assert.match(permissionManager, /explicit deny overrides every allow/i);

assert.match(businessLayout, /const showIndependentNote = Boolean\(independenceLabel \|\| description\)/);
assert.match(businessLayout, /showIndependentNote \?/);
assert.match(financeLayout, /independenceLabel=""/);
assert.match(financeLayout, /description=""/);
assert.doesNotMatch(financeLayout, /Independent Finance staff division/);
assert.doesNotMatch(financeLayout, /A complete excavator installment lifecycle/);

assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(max-width: 420px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /grid-template-columns:\s*1fr/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /overflow-wrap:\s*anywhere/);

console.log("Equipment Business Phase 2 staff and workforce contracts passed.");