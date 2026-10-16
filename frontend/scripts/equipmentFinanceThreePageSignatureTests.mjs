import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const layout = read("src", "layouts", "InstallmentFinanceLayout.jsx");
const routeCss = read("src", "styles", "equipmentFinanceThreePageRouteSignature.css");
const start = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const applications = read("src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");

assert.match(layout, /equipmentFinanceThreePageRouteSignature\.css/);
assert.match(layout, /finance-installment-page--start/);
assert.match(layout, /finance-installment-page--applications/);
assert.match(layout, /finance-installment-page--excavators/);
assert.match(layout, /stage === "start"/);
assert.match(layout, /stage === "machines"/);
assert.match(layout, /if \(!stage\)/);
assert.match(layout, /document\.body\.classList\.remove/);
assert.match(layout, /document\.body\.classList\.add/);

// Business logic components remain intact; the layout only supplies presentation scope.
assert.match(start, /finance-simple__steps/);
assert.match(applications, /placeholder="Search customer, application, offer or excavator"/);
assert.match(excavators, /finance-simple__machine-grid/);

for (const pageClass of [
  "finance-installment-page--start",
  "finance-installment-page--applications",
  "finance-installment-page--excavators",
]) {
  assert.ok(routeCss.includes(`body.${pageClass}`), `Missing explicit route design: ${pageClass}`);
}

for (const contract of [
  "BUILD THE DEAL",
  "UNDERWRITING  /  DECISION CONTROL",
  "MACHINE VAULT  /  SALE INVENTORY",
  "grid-template-columns: 1fr",
  "grid-template-columns: repeat(2, minmax(0, 1fr))",
  "scroll-snap-type: x mandatory",
  "@media (max-width: 760px)",
  "@media (prefers-reduced-motion: reduce)",
]) {
  assert.ok(routeCss.includes(contract), `Missing three-page route design contract: ${contract}`);
}

// No ungated generic page selector is allowed in this final layer.
const ungated = routeCss
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith(".finance-simple") || line.startsWith(".bwl-theme-earth"));
assert.deepEqual(ungated, []);

for (const forbidden of [
  "spare-parts",
  "mining",
  "store-",
  "bwl-theme-earth",
]) {
  assert.equal(routeCss.includes(forbidden), false, `Three-page redesign leaked into ${forbidden}`);
}

console.log("Equipment Finance explicit three-page route isolation contracts passed.");
