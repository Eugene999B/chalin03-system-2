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
const pathModel = read("src/chalin-one/chalinOnePathModel.js");
const protectedRoot = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
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
  assert.match(pathModel, /path === "\/intelligence"/);
  assert.match(pathModel, /path\.startsWith\("\/intelligence\/"\)/);
  assert.match(entry, /routePath="\/intelligence\/\*"/);
  assert.match(entry, /feature="aiEnabled"/);
  assert.match(entry, /permission="workspace\.view"/);
  assert.match(entry, /ProtectedRoute/);
  assert.match(entry, /PermissionRoute/);
  assert.match(protectedRoot, /ChalinOneStandaloneEntry/);
  assert.match(main, /isChalinOneStandalonePath/);
  assert.match(main, /ProtectedChalinOneEntry/);
});

check("client uses only protected backend AI endpoints and never handles provider secrets", () => {
  assert.match(api, /"\/ai\/status"/);
  assert.match(api, /`\/ai\/\$\{persona\}`/);
  assert.match(api, /\/ai\/provider-control/);
  assert.match(api, /\/ai\/knowledge/);
  assert.match(api, /\/ai\/feedback/);
  assert.match(api, /\/ai\/usage/);

  assert.doesNotMatch(
    api,
    /(?:process\.env|import\.meta\.env)\.(?:OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|ANTHROPIC_API_KEY)/i
  );
  assert.doesNotMatch(
    api,
    /api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com/i
  );
  assert.doesNotMatch(api, /Authorization\s*:|Bearer\s+/i);
  assert.doesNotMatch(api, /\bfetch\s*\(/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
  assert.match(api, /axiosClient/);
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

check("chat displays evidence, provider state, optional technical details and feedback", () => {
  assert.match(workspace, /EvidenceList/);
  assert.match(workspace, /createAiFeedback/);
  assert.match(workspace, /resultMeta\?\.usage/);
  assert.match(workspace, /status\.provider\?\.key/);
  assert.match(workspace, /status\.provider\?\.model_key/);
  assert.match(workspace, /showTechnicalDetails/);
  assert.match(workspace, /No usable provider is active for Copilot/);
  assert.match(workspace, /CHALIN is thinking/);
});

check("conversation lifecycle is persistent, titled, row-menu managed and silently synchronized", () => {
  assert.match(workspace, /deriveConversationTitle/);
  assert.match(workspace, /deleteAiConversation/);
  assert.match(workspace, /ConversationRow/);
  assert.match(workspace, /ci-conversation-more/);
  assert.match(workspace, />Rename<\/button>/);
  assert.match(workspace, />Delete<\/button>/);
  assert.match(workspace, /ConversationActionDialog/);
  assert.match(workspace, /silent: true, force: true/);
  assert.match(workspace, /maxLength=\{32000\}/);
  assert.doesNotMatch(workspace, /window\.prompt|window\.confirm/);
  assert.doesNotMatch(workspace, />Archive<\/button>/);
  assert.match(api, /axiosClient\.delete/);
  assert.match(api, /conversationCache/);
});

check("background conversation refresh does not blindly clear the active chat", () => {
  assert.match(workspace, /activePersonaRef/);
  assert.match(workspace, /activeChatEpochRef/);
  const personaGuard = workspace.indexOf("if (activePersonaRef.current !== persona) {");
  const guardedConversationReset = workspace.indexOf("setConversation(null);", personaGuard);
  const guardedMessageReset = workspace.indexOf("setMessages([]);", guardedConversationReset);
  assert.ok(personaGuard >= 0);
  assert.ok(guardedConversationReset > personaGuard);
  assert.ok(guardedMessageReset > guardedConversationReset);
  assert.equal((workspace.match(/setConversation\(null\)/g) || []).length, 2);
  assert.match(workspace, /loadConversations\(undefined, \{ silent: true, force: true \}\)/);
});

check("chat has first-class settings with isolated non-sensitive persistence", () => {
  assert.match(workspace, /ChatSettingsModal/);
  assert.match(workspace, /loadAiChatPreferences/);
  assert.match(workspace, /saveAiChatPreferences/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
  assert.match(workspace, /Send with Enter/);
  assert.match(workspace, /Technical response details/);
  assert.match(workspace, /Appearance/);
  assert.match(workspace, /Light|light/);
  assert.match(workspace, /Dark|dark/);
  assert.match(workspace, /System|system/);
  assert.match(workspace, /useAppearance/);
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
  assert.match(workspace, /permission-scoped read tool/);
});

check("workspace is responsive, reduced-motion safe and has no chat breathing animation", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.ci-composer/);
  assert.match(css, /\.ci-conversation-menu/);
  assert.match(css, /\.ci-settings-panel/);
  assert.doesNotMatch(css, /@keyframes\s+ciThinkingBreathe|ci-thinking-dot/);
  assert.doesNotMatch(workspace, /behavior:\s*"smooth"/);
});

check("rendering avoids unsafe HTML and dynamic code execution", () => {
  assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(workspace, /\beval\s*\(|new Function/);
  assert.doesNotMatch(workspace, /<iframe|<script/i);
});

console.log(`\nCHALIN ONE AI frontend foundation: ${passed}/11 checks passed.`);
