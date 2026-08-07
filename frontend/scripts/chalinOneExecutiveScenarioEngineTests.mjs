import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const page = read("src/chalin-one/ai/ExecutiveScenarioEnginePage.jsx");
const css = read("src/chalin-one/ai/executiveScenarioEngine.css");
const entry = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const launcher = read("src/chalin-one/ai/ExecutiveScorecardLauncher.jsx");

assert.match(entry, /ExecutiveScenarioEnginePage/);
assert.match(entry, /\/intelligence\/executive-scenarios/);
assert.match(launcher, /\/intelligence\/executive-scenarios/);
assert.match(launcher, /Scenario Comparison Engine|Scenarios/);

assert.match(page, /\/group-executive\/summary/);
assert.match(page, /branch_scope: "all"/);
assert.match(page, /getAiStatus/);
assert.match(page, /ai\.executive\.use/);
assert.match(page, /chalinExecutive/);
assert.match(page, /original System Administrator/);

for (const preset of [
  "Protect cash",
  "Balanced plan",
  "Growth push",
  "Stress test",
]) {
  assert.match(page, new RegExp(preset));
}

assert.match(page, /revenue_change_pct/);
assert.match(page, /collection_rate_delta_pp/);
assert.match(page, /operating_cost_change_pct/);
assert.match(page, /receivables_recovery_pct/);
assert.match(page, /baselineRevenue \* \(1 \+ revenueChange \/ 100\)/);
assert.match(page, /baselineCollectionRate \+ collectionDelta/);
assert.match(page, /modeledRevenue \* \(targetCollectionRate \/ 100\)/);
assert.match(page, /baselineReceivables \* \(recoveryRate \/ 100\)/);
assert.match(page, /modeledPeriodCollections \+ recoveredExistingReceivables/);
assert.match(page, /baselineCost \* \(1 \+ costChange \/ 100\)/);
assert.match(page, /modeledRevenue - modeledOperatingCost/);
assert.match(page, /baselineReceivables - recoveredExistingReceivables/);

assert.match(page, /clamp\(asNumber\(inputs\.revenue_change_pct\), -50, 100\)/);
assert.match(page, /clamp\(asNumber\(inputs\.collection_rate_delta_pp\), -40, 40\)/);
assert.match(page, /clamp\(asNumber\(inputs\.operating_cost_change_pct\), -50, 100\)/);
assert.match(page, /clamp\(asNumber\(inputs\.receivables_recovery_pct\), 0, 100\)/);
assert.match(page, /clamp\(baselineCollectionRate \+ collectionDelta, 0, 100\)/);

assert.match(page, /Nothing here is a forecast, accounting entry, approval or operational instruction/);
assert.match(page, /No-write simulation/);
assert.match(page, /No hidden AI math/);
assert.match(page, /Management simulation only/);
assert.match(page, /change no CHALIN 03 record/);
assert.match(page, /create no AI action proposal/);
assert.doesNotMatch(page, /sendAiMessage\(/);
assert.doesNotMatch(page, /generateProviderResponse|POST\s+\/|PUT\s+\/|PATCH\s+\/|DELETE\s+\//i);

assert.match(css, /\.cse-preset-grid/);
assert.match(css, /\.cse-editor-grid/);
assert.match(css, /\.cse-metric-grid/);
assert.match(css, /\.cse-bars/);
assert.match(css, /\.cse-formula-grid/);
assert.match(css, /@media \(max-width: 600px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log("CHALIN ONE Executive scenario comparison source contract passed.");
