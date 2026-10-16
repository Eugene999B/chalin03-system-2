const STORAGE_KEY = "chalin03-theme";
const VALID_MODES = new Set(["light", "dark", "system"]);

function normalizeMode(value) {
  return VALID_MODES.has(value) ? value : "system";
}

export function getStoredChalinTheme() {
  try {
    return normalizeMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function resolveChalinTheme(mode) {
  const normalized = normalizeMode(mode);
  if (normalized !== "system") return normalized;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function applyChalinTheme(mode) {
  const normalized = normalizeMode(mode);
  const resolved = resolveChalinTheme(normalized);
  const root = document.documentElement;
  root.dataset.chalinTheme = resolved;
  root.dataset.chalinThemeMode = normalized;
  root.style.colorScheme = resolved;
  return resolved;
}

export function setChalinTheme(mode) {
  const normalized = normalizeMode(mode);
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Keep the theme working for restricted storage environments.
  }
  applyChalinTheme(normalized);
  window.dispatchEvent(new CustomEvent("chalin03-theme-change", { detail: { mode: normalized } }));
  return normalized;
}

export function initializeChalinTheme() {
  applyChalinTheme(getStoredChalinTheme());

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (getStoredChalinTheme() === "system") applyChalinTheme("system");
  };
  media?.addEventListener?.("change", onSystemChange);
  window.__chalin03ThemeCleanup = () => media?.removeEventListener?.("change", onSystemChange);
}

export function getChalinThemeMode() {
  return document.documentElement.dataset.chalinThemeMode || getStoredChalinTheme();
}

export { STORAGE_KEY };
