export const AI_CHAT_PREFERENCES_STORAGE_KEY = "chalin03:ai-chat-settings";

export const DEFAULT_AI_CHAT_PREFERENCES = Object.freeze({
  sendWithEnter: true,
  showTechnicalDetails: false,
});

export function normalizeAiChatPreferences(value = {}) {
  return Object.freeze({
    sendWithEnter: value?.sendWithEnter !== false,
    showTechnicalDetails: value?.showTechnicalDetails === true,
  });
}

export function loadAiChatPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(AI_CHAT_PREFERENCES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeAiChatPreferences(parsed);
  } catch {
    return normalizeAiChatPreferences(DEFAULT_AI_CHAT_PREFERENCES);
  }
}

export function saveAiChatPreferences(value, storage = globalThis.localStorage) {
  const normalized = normalizeAiChatPreferences(value);
  try {
    storage?.setItem(AI_CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Harmless UI preferences remain usable for the current session.
  }
  return normalized;
}
