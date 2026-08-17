import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("src/pages/InstallmentCompletionPhaseFourPage.jsx");
const css = read("src/styles/installmentCompletionPhaseFour.css");
const workspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const workflow = read("../.github/workflows/chalin03-verification.yml");

for (const title of [
  "Reset Centre",
  "Review exactly what will be reset",
  "Authorize the reset",
]) {
  assert.match(page, new RegExp(title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
}

assert.match(page, /const API = "\/equipment-catalogue\/sales\/completion-phase-four"/);
assert.match(page, /\$\{API\}\/readiness/);
assert.match(page, /\$\{API\}\/reset\/dry-run/);
assert.match(page, /\$\{API\}\/reset\/execute/);
assert.match(page, /Current password/);
assert.match(page, /RESET INSTALLMENT FINANCE/);
assert.match(page, /Reset Installment Finance Data/);
assert.match(page, /dry_run_fingerprint/);
assert.match(page, /original System Administrator/i);

assert.match(workspace, /InstallmentCompletionPhaseFourPage/);
assert.match(workspace, /stage === "finalization"/);
assert.match(layout, /title: "Final Operations & Reset"/);
assert.match(layout, /stage=finalization/);

assert.match(css, /--phase4-green: #174f35/);
assert.match(css, /--phase4-gold: #d3a72c/);
assert.match(css, /finance-completion-four__production-lock/);
assert.match(css, /finance-completion-four__feature-grid/);
assert.match(css, /finance-completion-four__dry-run/);
assert.match(css, /@media \(max-width: 700px\)/);
assert.match(css, /@media \(max-width: 480px\)/);

assert.match(workflow, /equipmentFinanceCompletionPhaseFour\.spec\.js/);
assert.match(workflow, /finance-completion-phase-four-browser\.log/);

console.log("Installment Completion Phase 4 source contracts passed.");
