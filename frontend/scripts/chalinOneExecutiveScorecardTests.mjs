import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const page = read("src/chalin-one/ai/ExecutiveScorecardPage.jsx");
const launcher = read("src/chalin-one/ai/ExecutiveScorecardLauncher.jsx");
const entry = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const css = read("src/chalin-one/ai/executiveScorecard.css");

assert.match(entry, /ExecutiveScorecardPage/);
assert.match(entry, /ExecutiveScorecardLauncher/);
assert.match(entry, /\/intelligence\/executive-scorecard/);

assert.match(launcher, /getAiStatus/);
assert.match(launcher, /ai\.executive\.use/);
assert.match(launcher, /chalinExecutive/);
assert.match(launcher, /Executive scorecard/);

assert.match(page, /\/group-executive\/summary/);
assert.match(page, /branch_scope: "all"/);
assert.match(page, /getAiStatus/);
assert.match(page, /ai\.executive\.use/);
assert.match(page, /chalinExecutive/);
assert.match(page, /provider-independent|does not depend on the AI provider/i);
assert.match(page, /Recorded revenue/);
assert.match(page, /Cash received/);
assert.match(page, /Operating cost/);
assert.match(page, /Receivables/);
assert.match(page, /Indicative balance/);
assert.match(page, /Business pulse/);
assert.match(page, /Mining Operations/);
assert.match(page, /Equipment Hire/);
assert.match(page, /Shared Fleet/);
assert.match(page, /Cash Control/);
assert.match(page, /Trend intelligence/);
assert.match(page, /Management alerts/);
assert.match(page, /Management actions to review/);
assert.match(page, /cannot approve or execute changes/);
assert.doesNotMatch(page, /sendAiMessage\(/);
assert.doesNotMatch(page, /generateProviderResponse|AI_PROVIDER|provider_key\s*=/);

assert.match(css, /\.ces-metric-grid/);
assert.match(css, /\.ces-business-grid/);
assert.match(css, /\.ces-trend-chart/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log("CHALIN ONE Executive scorecard source contract passed.");
