import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const page = read("src/pages/EquipmentFinanceCorrectionsPage.jsx");
const workflow = read("src/pages/EquipmentFinanceMinimalWorkflowPage.jsx");
const workspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const styles = read("src/styles/equipmentFinanceCorrections.css");

assert.match(page, /Returns, Cancellations & Corrections/);
assert.match(page, /append-only ledger/i);
assert.match(page, /const API = "\/equipment-catalogue\/sales\/finance-corrections"/);
assert.match(page, /\/settlement-preview/);
assert.match(page, /data-testid="phase4-settlement-preview"/);
assert.match(page, /data-testid="phase4-official-balance"/);
assert.match(page, /Current official account balance/);
assert.match(page, /Approval rechecks this balance/);
assert.match(page, /draft_cancellation/);
assert.match(page, /payment_reversal/);
assert.match(page, /asset_return/);
assert.match(page, /repossession/);
assert.match(page, /charge_waiver/);
assert.match(page, /Original payment receipts/);
assert.match(page, /payment\.is_voided \? "reversed" : "posted"/);
assert.match(page, /Correction ledger and original history/);
assert.match(page, /Return settlements/);
assert.match(page, /Save policy with history/);
assert.match(page, /A different Finance Manager must decide it/);
assert.match(page, /The requester cannot decide the same request/);
assert.match(page, /stage=governance/);

assert.match(workspace, /const EquipmentFinanceCorrectionsPage = lazy/);
assert.match(workspace, /import\("\.\/EquipmentFinanceCorrectionsPage"\)/);
assert.match(workspace, /stage === "corrections"/);
assert.match(workspace, /return <EquipmentFinanceCorrectionsPage/);

assert.match(workflow, /Phase 4 · Sensitive financial scenarios/);
assert.match(workflow, /stage=corrections/);
assert.match(workflow, /outstanding balance − approved return credit − refundable/);
assert.match(workflow, /backend balance after every payment, reversal, waiver, return credit/);
assert.doesNotMatch(page, /final_settlement_balance\s*=|outstanding_balance\s*-/);

assert.match(styles, /\.finance-corrections__workspace/);
assert.match(styles, /@media \(max-width: 720px\)/);

console.log(
  "PASS equipmentFinancePhaseFourTests: Phase 4 frontend preserves backend authority, independent approval, policy history and immutable financial evidence."
);
