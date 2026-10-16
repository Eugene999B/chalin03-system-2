import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [spareHelp, workspaceHelp, financeGuide, readme, auditStandard] = await Promise.all([
  read("src/pages/HelpPage.jsx"),
  read("src/pages/WorkspaceHelpPage.jsx"),
  read("src/pages/EquipmentFinanceGuidePage.jsx"),
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

assert.match(financeGuide, /Equipment Installment Finance Help &amp; Guide/);
assert.match(financeGuide, /Finance is company-wide — no Hire-location selection/);
assert.match(financeGuide, /Task & Approval Inbox/);
assert.match(financeGuide, /Opening Deposit & Machine Reservation/);
assert.match(financeGuide, /partial opening deposit records a receipt but does not reserve/);
assert.match(financeGuide, /allocates it to the oldest due installments first/);
assert.match(financeGuide, /Active Installments and Customer Installment Profiles/);
assert.match(financeGuide, /Secure Case Documents and evidence review/);
assert.match(financeGuide, /immutable issued-document snapshots with a SHA-256 fingerprint/);
assert.match(financeGuide, /Corrections, reversals, returns and settlements/);
assert.match(financeGuide, /dated owner-authorized restart release/);
assert.match(financeGuide, /self-disabling after its schema_migrations marker/);
assert.match(financeGuide, /general production reset endpoint.*remain blocked/);
assert.match(financeGuide, /stage=deposit/);
assert.match(financeGuide, /stage=corrections/);
assert.match(financeGuide, /stage=generated-documents/);
assert.match(financeGuide, /stage=finalization/);

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
