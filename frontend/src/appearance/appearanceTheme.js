export const APPEARANCE_STORAGE_KEY = "chalin03:appearance";
export const APPEARANCE_OPTIONS = Object.freeze(["light", "dark", "system"]);

export function normalizeAppearance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return APPEARANCE_OPTIONS.includes(normalized) ? normalized : "system";
}

export function storedAppearance(storage = globalThis.localStorage) {
  try {
    return normalizeAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function systemPrefersDark(media = globalThis.matchMedia) {
  try {
    return typeof media === "function" && media("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolvedAppearance(preference, media = globalThis.matchMedia) {
  const normalized = normalizeAppearance(preference);
  if (normalized === "system") return systemPrefersDark(media) ? "dark" : "light";
  return normalized;
}

export function applyAppearance(preference, documentRef = globalThis.document, media = globalThis.matchMedia) {
  const normalized = normalizeAppearance(preference);
  const resolved = resolvedAppearance(normalized, media);
  if (documentRef?.documentElement) {
    documentRef.documentElement.dataset.theme = resolved;
    documentRef.documentElement.dataset.themePreference = normalized;
    documentRef.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function persistAppearance(preference, storage = globalThis.localStorage) {
  const normalized = normalizeAppearance(preference);
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, normalized);
  } catch {
    // Appearance remains usable for this session even when storage is unavailable.
  }
  return normalized;
}

export function initializeAppearance() {
  return applyAppearance(storedAppearance());
}
