import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const layout = read("src", "layouts", "InstallmentFinanceLayout.jsx");
const css = read("src", "styles", "equipmentFinanceThreePageSignature.css");
const start = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const applications = read("src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");

assert.match(layout, /equipmentFinanceThreePageSignature\.css/);

// Each redesign is anchored to a marker unique to that existing page.
assert.match(start, /finance-simple__steps/);
assert.match(applications, /finance-simple__toolbar[\s\S]*type="date"/);
assert.match(excavators, /finance-simple__machine-grid/);

assert.match(css, /:has\(> \.finance-simple > \.finance-simple__steps\)/);
assert.match(css, /:has\(> \.finance-simple > \.finance-simple__section > \.finance-simple__toolbar input\[type="date"\]\)/);
assert.match(css, /:has\(> \.finance-simple > \.finance-simple__section \.finance-simple__machine-grid\)/);

for (const phrase of [
  "private deal studio",
  "underwriting command board",
  "premium machine showroom",
  "@media (max-width: 760px)",
  "scroll-snap-type: x mandatory",
  "prefers-reduced-motion",
]) {
  assert.ok(css.includes(phrase), `Missing three-page design contract: ${phrase}`);
}

// This stylesheet must never contain an ungated top-level Finance selector.
const ungated = css
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith(".finance-simple") && !line.startsWith(".bwl-theme-finance-signature"));
assert.deepEqual(ungated, []);

for (const forbidden of [
  "spare-parts",
  "mining",
  "equipment-hire",
  "store-",
  "bwl-theme-earth",
]) {
  assert.equal(css.includes(forbidden), false, `Three-page redesign leaked into ${forbidden}`);
}

console.log("Equipment Finance three-page signature isolation contracts passed.");
