import { useAppearance } from "./AppearanceContext";

export default function AppearanceToggle({ compact = false, className = "" }) {
  const { resolved, toggleAppearance } = useAppearance();
  const dark = resolved === "dark";

  return (
    <button
      type="button"
      className={`chalin-appearance-toggle${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
      onClick={toggleAppearance}
    >
      <span className="chalin-appearance-toggle-icon" aria-hidden="true">{dark ? "☀" : "☾"}</span>
      <span className="chalin-appearance-toggle-copy">
        <strong>{dark ? "Light mode" : "Dark mode"}</strong>
        {!compact ? <small>{dark ? "Use the bright workspace" : "Use the calm dark workspace"}</small> : null}
      </span>
    </button>
  );
}
