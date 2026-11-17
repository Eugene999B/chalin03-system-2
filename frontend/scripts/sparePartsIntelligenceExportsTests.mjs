import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(resolve(root, "src/pages/ExportsPage.jsx"), "utf8");
const css = readFileSync(resolve(root, "src/pages/ExportsPage.css"), "utf8");

for (const endpoint of [
  "/exports/business-intelligence",
  "/exports/collections-intelligence",
  "/exports/audit-intelligence",
  "/exports/stock-intelligence",
  "/exports/supplier-intelligence",
]) assert.ok(page.includes(endpoint), "Missing working report endpoint " + endpoint);
assert.match(page, /Analyse this store/);
assert.match(page, /\/exports\/business-intelligence\/preview/);
assert.match(page, /responseType: "blob"/);
assert.match(page, /Current open debt|Current open debt|Current open debt|Current open debt/);
assert.match(page, /stock are current snapshots/);
assert.match(page, /[Ff]ull.*Spare Parts.*Business Review|Complete Spare Parts Business Review/);
assert.match(page, /intelligencePreview\.charts/);
assert.match(page, /intelligencePreview\.findings/);
assert.match(page, /useEffect\(\(\) => \{[\s\S]*?setIntelligencePreview\(null\)/);
assert.match(page, /"admin", "manager", "auditor"/);
assert.match(css, /ec-intelligence-live/);
assert.match(css, /ec-intelligence-kpis/);
assert.match(css, /ec-live-chart-grid/);
assert.match(css, /@media \(max-width:600px\)/);
assert.match(css, /min-height:48px/);
console.log("Spare Parts Intelligence Export Centre source contracts passed.");
