import { useEffect, useState } from "react";

const STORAGE_KEY = "chalin03-theme";
const DARK_CLASS = "c03-dark-mode";

function readStoredTheme() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "dark";
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(DARK_CLASS, dark);
    root.style.colorScheme = dark ? "dark" : "light";
    window.localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      type="button"
      className="c03-theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setDark((current) => !current)}
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </button>
  );
}
