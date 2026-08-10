import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  applyAppearance,
  normalizeAppearance,
  persistAppearance,
  resolvedAppearance,
  storedAppearance,
} from "./appearanceTheme";

const AppearanceContext = createContext(null);

export function AppearanceProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => storedAppearance());
  const [resolved, setResolved] = useState(() => resolvedAppearance(storedAppearance()));

  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

    function sync() {
      setResolved(applyAppearance(preference));
    }

    sync();
    if (preference === "system") media?.addEventListener?.("change", sync);
    return () => media?.removeEventListener?.("change", sync);
  }, [preference]);

  function setAppearance(next) {
    const normalized = normalizeAppearance(next);
    persistAppearance(normalized);
    setPreferenceState(normalized);
    setResolved(applyAppearance(normalized));
  }

  function toggleAppearance() {
    setAppearance(resolved === "dark" ? "light" : "dark");
  }

  const value = useMemo(
    () => ({ preference, resolved, setAppearance, toggleAppearance }),
    [preference, resolved]
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside AppearanceProvider");
  }
  return value;
}
