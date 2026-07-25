import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [spareHelp, workspaceHelp, readme, auditStandard] = await Promise.all([
  read("src/pages/HelpPage.jsx"),
  read("src/pages/WorkspaceHelpPage.jsx"),
  read("../README.md"),
  read("../docs/SYSTEM_GUIDE_AND_AUDIT_STANDARD.md"),
]);

assert.match(spareHelp, /New Spare Parts installment sales are retired/);
assert.doesNotMatch(spareHelp, /Choose Installment Sale/);
assert.match(spareHelp, /Request → Approve → Dispatch → Receive/);
assert.match(spareHelp, /signed Full System Backups/);
assert.match(spareHelp, /password-only sign-in/);

assert.match(workspaceHelp, /Mining Operations User Guide/);
assert.match(workspaceHelp, /Equipment Sales & Hire User Guide/);
assert.match(workspaceHelp, /Equipment sale agreements and installments/);
assert.match(workspaceHelp, /Equipment installments exist here, not in Spare Parts/);
assert.match(workspaceHelp, /protected boss signature/);
assert.match(workspaceHelp, /category-isolated/);

assert.match(readme, /Live deployment branch \| `production`/);
assert.match(readme, /Integration branch \| `main`/);
assert.match(readme, /New Spare Parts installment sales are retired/);
assert.match(readme, /signed `chalin03-full-system-v2` backups/);
assert.match(readme, /DB_SSL_REJECT_UNAUTHORIZED=false/);
assert.match(readme, /SYSTEM_GUIDE_AND_AUDIT_STANDARD\.md/);

assert.match(auditStandard, /Audit scoring model/);
assert.match(auditStandard, /Production safety, migrations and disaster recovery/);
assert.match(auditStandard, /Equipment Sales & Hire correctness/);

console.log("Help and documentation regression checks passed.");
