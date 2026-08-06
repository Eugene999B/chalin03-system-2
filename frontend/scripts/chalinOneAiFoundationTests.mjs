import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const entry = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const workspace = read(
  "src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx"
);
const api = read("src/chalin-one/ai/aiApi.js");
const css = read("src/chalin-one/ai/chalinIntelligence.css");
const main = read("src/main.jsx");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("intelligence is a standalone authenticated feature-gated surface", () => {
  assert.match(entry, /path === "\/intelligence"/);
  assert.match(entry, /path\.startsWith\("\/intelligence\/"\)/);
  assert.match(entry, /routePath="\/intelligence\/\*"/);
  assert.match(entry, /feature="aiEnabled"/);
  assert.match(entry, /permission="workspace\.view"/);
  assert.match(entry, /ProtectedRoute/);
  assert.match(entry, /PermissionRoute/);
  assert.match(main, /isChalinOneStandalonePath/);
});

check("client uses only protected backend AI endpoints", () => {
  assert.match(api, /"\/ai\/status"/);
  assert.match(api, /`\/ai\/\$\{persona\}`/);
  assert.match(api, /\/ai\/knowledge/);
  assert.match(api, /\/ai\/feedback/);
  assert.match(api, /\/ai\/usage/);
  assert.doesNotMatch(api, /OpenAI|Anthropic|Gemini|api[_-]?key|Bearer\s+/i);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
});

check("workspace obeys server-authoritative persona and permission state", () => {
  assert.match(workspace, /getAiStatus/);
  assert.match(workspace, /status\?\.flags\?\.chalinCopilot/);
  assert.match(workspace, /status\?\.flags\?\.chalinExecutive/);
  assert.match(workspace, /permissions\.has\("ai\.knowledge\.view"\)/);
  assert.match(workspace, /permissions\.has\("ai\.usage\.view"\)/);
  assert.match(workspace, /permissions\.has\("ai\.knowledge\.review"\)/);
  assert.match(workspace, /permissions\.has\("ai\.knowledge\.publish"\)/);
});

check("chat displays evidence, provider state, usage and feedback", () => {
  assert.match(workspace, /EvidenceList/);
  assert.match(workspace, /createAiFeedback/);
  assert.match(workspace, /resultMeta\?\.usage/);
  assert.match(workspace, /Provider:/);
  assert.match(workspace, /Read \/ recommend \/ prepare only/);
  assert.match(workspace, /provider is safely disabled/i);
});

check("knowledge interface follows draft review publish governance", () => {
  assert.match(workspace, /createAiKnowledgeDraft/);
  assert.match(workspace, /submitAiKnowledgeVersion/);
  assert.match(workspace, /decideAiKnowledgeApproval/);
  assert.match(workspace, /publishAiKnowledgeVersion/);
  assert.match(workspace, /Independent reviewer user ID/);
  assert.match(workspace, /Submit exact version/);
  assert.match(workspace, /Publish approved version/);
});

check("foundation UI contains no sensitive business action execution", () => {
  assert.doesNotMatch(
    workspace,
    /execute action|merge customer|change stock|change price|approve finance|release equipment|restore database|mass sms/i
  );
  assert.match(workspace, /AI cannot approve or execute sensitive changes/);
});

check("workspace is responsive at required mobile widths", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.ci-composer/);
  assert.match(css, /\.ci-card-grid/);
  assert.match(css, /\.ci-persona-switch/);
});

check("rendering avoids unsafe HTML and dynamic code execution", () => {
  assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(workspace, /\beval\s*\(|new Function/);
  assert.doesNotMatch(workspace, /<iframe|<script/i);
});

console.log(`\nCHALIN ONE AI frontend foundation: ${passed}/8 checks passed.`);
