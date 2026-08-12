import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(frontendRoot, "..");

function read(relativePath, root = frontendRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const modelModule = await import(
  pathToFileURL(path.join(frontendRoot, "src/chalin-one/ai/contextualAiModel.js")).href
);
const { contextualAiProfileForPath } = modelModule;

const sidecar = read("src/chalin-one/ai/ContextualAiSidecar.jsx");
const api = read("src/chalin-one/ai/contextualAiApi.js");
const css = read("src/chalin-one/ai/contextualAi.css");
const root = read("src/OperationalAppRoot.jsx");
const tracker = read("src/utils/commandGateHistoryTracker.js");
const routes = read("backend/routes/aiRoutes.js", repoRoot);
const profiles = read("backend/services/aiContextProfileService.js", repoRoot);
const contextualProvider = read("backend/services/aiContextualProviderService.js", repoRoot);

const routeCases = [
  ["/staff", "spare_parts.operations"],
  ["/products", "spare_parts.inventory"],
  ["/low-stock", "spare_parts.inventory"],
  ["/debts", "spare_parts.collections"],
  ["/reports", "spare_parts.operations"],
  ["/mining", "mining.operations"],
  ["/mining/fuel", "mining.stock_fuel"],
  ["/mining/production", "mining.production_cost"],
  ["/equipment-hire-operations", "equipment_hire.operations"],
  ["/equipment-hire-operations/fleet", "equipment_hire.fleet"],
  ["/equipment-hire-operations/invoices", "equipment_hire.receivables"],
  ["/equipment-installment-finance", "equipment_finance.portfolio"],
  ["/equipment-installment-finance/arrears", "equipment_finance.arrears"],
  ["/equipment-installment-finance/payments", "equipment_finance.cashflow"],
  ["/equipment-installment-finance/applications", "equipment_finance.sales_pipeline"],
];

for (const [pathname, expected] of routeCases) {
  assert.equal(
    contextualAiProfileForPath(pathname)?.key,
    expected,
    `${pathname} should map to ${expected}`
  );
}
for (const pathname of ["/login", "/intelligence", "/content-studio", "/owner-recovery"]) {
  assert.equal(contextualAiProfileForPath(pathname), null, `${pathname} must not mount contextual AI`);
}

assert.match(root, /lazy\(\(\)\s*=>\s*import\("\.\/chalin-one\/ai\/ContextualAiSidecar\.jsx"\)/);
assert.match(root, /<ContextualAiSidecar\s*\/>/);
assert.match(root, /<Suspense fallback=\{null\}>/);
assert.doesNotMatch(root, /ChalinOneGatewayLinks/);
assert.match(tracker, /chalin:route-change/);
assert.match(sidecar, /addEventListener\("chalin:route-change"/);
assert.match(sidecar, /resetConversation/);
assert.match(sidecar, /currentScopeFingerprint/);
assert.match(sidecar, /flags\?\.aiEnabled === true/);
assert.match(sidecar, /permissions\.has\("ai\.use"\)/);
assert.match(sidecar, /permissions\.has\("ai\.conversations\.manage"\)/);
assert.match(sidecar, /permissions\.has\("ai\.executive\.use"\)/);
assert.match(sidecar, /function RobotIcon/);
assert.match(sidecar, /cai-launcher-robot/);
assert.match(sidecar, /Open CHALIN mini chat/);
assert.match(sidecar, /Expand full Intelligence/);
assert.match(sidecar, /Open full Intelligence/);
assert.match(sidecar, /Read-only intelligence/);
assert.match(sidecar, /Server-owned context/);
assert.match(sidecar, /No autonomous business changes/);
assert.match(sidecar, /Governed evidence/);
assert.doesNotMatch(sidecar, /dangerouslySetInnerHTML|\beval\s*\(|new Function/);

assert.match(api, /context_key:\s*contextKey/);
assert.match(api, /conversation_key:\s*conversationKey/);
assert.match(api, /message,/);
assert.doesNotMatch(api, /tool_key|tool_input|branch_id|mining_site_id|hire_location_id/);
assert.doesNotMatch(
  api,
  /api\.openai\.com|generativelanguage\.googleapis\.com|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/
);

assert.match(routes, /contextKey = String\(req\.body\.context_key/);
assert.match(routes, /createContextualAiProvider/);
assert.match(routes, /provider:\s*contextual\?\.provider \|\| null/);
assert.doesNotMatch(routes, /req\.body\.tool_key|req\.body\.tool_input/);

for (const key of [
  "spare_parts.operations",
  "spare_parts.inventory",
  "spare_parts.collections",
  "mining.operations",
  "mining.stock_fuel",
  "mining.production_cost",
  "equipment_hire.operations",
  "equipment_hire.fleet",
  "equipment_hire.receivables",
  "equipment_finance.portfolio",
  "equipment_finance.arrears",
  "equipment_finance.cashflow",
  "equipment_finance.sales_pipeline",
]) {
  assert.match(profiles, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
}
assert.match(profiles, /classification:\s*"confidential"/);
assert.match(profiles, /hasEquipmentDivisionAccess/);
assert.match(profiles, /AI_CONTEXT_WORKSPACE_MISMATCH/);
assert.match(profiles, /AI_CONTEXT_EQUIPMENT_DIVISION_DENIED/);
assert.match(contextualProvider, /offeredTool\(tools, this\.profile\.preload_tool\)/);
assert.match(contextualProvider, /Number\(preload\.risk_level \|\| 0\) > 1/);
assert.match(contextualProvider, /input:\s*\{\}/);
assert.match(contextualProvider, /resolveAiProviderSelection/);
assert.match(contextualProvider, /data_classification:\s*profile\.classification/);

assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\.cai-panel/);
assert.match(css, /\.cai-composer/);
assert.match(css, /\.cai-robot-icon/);
assert.match(css, /\.cai-launcher-tooltip/);
assert.match(css, /bottom:\s*18px/);

console.log("CHALIN ONE AI contextual workspace + compact robot launcher contracts passed.");
