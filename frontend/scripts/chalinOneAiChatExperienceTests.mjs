import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const workspace = read("src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx");
const intelligenceCss = read("src/chalin-one/ai/chalinIntelligence.css");
const appearanceCss = read("src/styles/appearance.css");
const appearanceContext = read("src/appearance/AppearanceContext.jsx");
const appearanceToggle = read("src/appearance/AppearanceToggle.jsx");
const chatPreferences = read("src/appearance/aiChatPreferences.js");
const operationalRoot = read("src/OperationalAppRoot.jsx");
const protectedRoot = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
const main = read("src/main.jsx");

const themeModule = await import(
  pathToFileURL(path.join(frontendRoot, "src/appearance/appearanceTheme.js")).href
);
const preferenceModule = await import(
  pathToFileURL(path.join(frontendRoot, "src/appearance/aiChatPreferences.js")).href
);
const {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  normalizeAppearance,
  resolvedAppearance,
} = themeModule;
const {
  AI_CHAT_PREFERENCES_STORAGE_KEY,
  loadAiChatPreferences,
  saveAiChatPreferences,
} = preferenceModule;

assert.equal(APPEARANCE_STORAGE_KEY, "chalin03:appearance");
assert.equal(normalizeAppearance("dark"), "dark");
assert.equal(normalizeAppearance("LIGHT"), "light");
assert.equal(normalizeAppearance("garbage"), "system");
assert.equal(resolvedAppearance("system", () => ({ matches: true })), "dark");
assert.equal(resolvedAppearance("system", () => ({ matches: false })), "light");

const fakeDocument = { documentElement: { dataset: {}, style: {} } };
assert.equal(applyAppearance("dark", fakeDocument, () => ({ matches: false })), "dark");
assert.equal(fakeDocument.documentElement.dataset.theme, "dark");
assert.equal(fakeDocument.documentElement.dataset.themePreference, "dark");
assert.equal(fakeDocument.documentElement.style.colorScheme, "dark");

const storedValues = new Map();
const fakeStorage = {
  getItem(key) { return storedValues.get(key) ?? null; },
  setItem(key, value) { storedValues.set(key, value); },
};
assert.equal(AI_CHAT_PREFERENCES_STORAGE_KEY, "chalin03:ai-chat-settings");
assert.deepEqual(
  saveAiChatPreferences({ sendWithEnter: false, showTechnicalDetails: true }, fakeStorage),
  { sendWithEnter: false, showTechnicalDetails: true }
);
assert.deepEqual(loadAiChatPreferences(fakeStorage), {
  sendWithEnter: false,
  showTechnicalDetails: true,
});
assert.doesNotMatch(chatPreferences, /token|password|secret|conversation_key|message_key/i);

// Theme is applied before the application root renders, avoiding a bright boot flash.
assert.match(main, /initializeAppearance\(\)/);
assert.ok(main.indexOf("initializeAppearance();") < main.indexOf("ReactDOM.createRoot"));

// Staff login/workspaces and protected CHALIN surfaces share one persistent appearance system.
assert.match(operationalRoot, /AppearanceProvider/);
assert.match(operationalRoot, /AppearanceToggle compact/);
assert.match(operationalRoot, /styles\/appearance\.css/);
assert.match(protectedRoot, /AppearanceProvider/);
assert.match(protectedRoot, /AppearanceToggle compact/);
assert.match(protectedRoot, /styles\/appearance\.css/);
assert.doesNotMatch(protectedRoot, /intelligenceOverhaul\.css/);
assert.match(appearanceContext, /persistAppearance/);
assert.match(appearanceContext, /prefers-color-scheme: dark/);
assert.match(appearanceToggle, /Dark mode/);
assert.match(appearanceToggle, /Light mode/);

// Dark mode is intentionally styled across login, Spare Parts and managed business workspaces.
assert.match(appearanceCss, /html\[data-theme="dark"\] \.login-page/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.login-card/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.premium-layout/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.premium-main-topbar/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.bwl-shell/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.bwl-topbar/);
assert.match(appearanceCss, /html\[data-theme="dark"\] \.workspace-context-selector select/);
assert.doesNotMatch(appearanceCss, /background:\s*#000(?:000)?[;\s]/i);

// Conversation-list refreshes must not wipe the active chat. The only effect-time
// reset is deliberately guarded by a real persona transition.
assert.match(workspace, /activePersonaRef/);
assert.match(workspace, /activeChatEpochRef/);
assert.match(workspace, /loadConversations\(undefined, \{ silent: true, force: true \}\)/);
const personaGuard = workspace.indexOf("if (activePersonaRef.current !== persona) {");
const guardedConversationReset = workspace.indexOf("setConversation(null);", personaGuard);
const guardedMessageReset = workspace.indexOf("setMessages([]);", guardedConversationReset);
const effectRefresh = workspace.indexOf("loadConversations(controller.signal);", guardedMessageReset);
assert.ok(personaGuard >= 0, "persona reset must be explicitly guarded");
assert.ok(guardedConversationReset > personaGuard, "conversation reset must stay inside the persona guard");
assert.ok(guardedMessageReset > guardedConversationReset, "message reset must stay inside the persona guard");
assert.ok(effectRefresh > guardedMessageReset, "conversation refresh follows the guarded persona transition");
assert.equal((workspace.match(/setConversation\(null\)/g) || []).length, 2, "only persona switch and explicit New chat may clear the active conversation");

// Chat management belongs on each conversation row, not in a distant footer.
assert.match(workspace, /function ConversationRow/);
assert.match(workspace, /ci-conversation-more/);
assert.match(workspace, />•••<\/summary>/);
assert.match(workspace, />Rename<\/button>/);
assert.match(workspace, />Delete<\/button>/);
assert.match(workspace, /ConversationActionDialog/);
assert.doesNotMatch(workspace, /window\.prompt|window\.confirm/);

// Settings are part of the chat and expose appearance + calm composition preferences.
assert.match(workspace, /function ChatSettingsModal/);
assert.match(workspace, /Conversation preferences/);
assert.match(workspace, /Send with Enter/);
assert.match(workspace, /Technical response details/);
assert.match(workspace, /\["light", "dark", "system"\]/);
assert.match(workspace, /loadAiChatPreferences/);
assert.match(workspace, /saveAiChatPreferences/);
assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
assert.doesNotMatch(workspace, /OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/);

// The redesigned chat is intentionally calm: no pulsing thinking dot and no smooth auto-scroll.
assert.match(intelligenceCss, /html\[data-theme="dark"\]/);
assert.match(intelligenceCss, /\.ci-conversation-menu/);
assert.match(intelligenceCss, /\.ci-settings-panel/);
assert.match(intelligenceCss, /\.ci-message-user/);
assert.match(intelligenceCss, /\.ci-send-button/);
assert.match(intelligenceCss, /prefers-reduced-motion/);
assert.doesNotMatch(intelligenceCss, /@keyframes\s+ciThinkingBreathe|ci-thinking-dot/);
assert.doesNotMatch(workspace, /behavior:\s*"smooth"/);

console.log("CHALIN ONE AI chat stability + dark appearance contracts passed.");
