import { Link } from "react-router-dom";
import { useWorkspaceContext } from "../context/WorkspaceContext";

function optionLabel(option) {
  const code = option.code ? `${option.code} — ` : "";
  return `${code}${option.name || "Unnamed location"}`;
}

export default function WorkspaceContextSelector({ compact = false }) {
  const {
    isManagedWorkspace,
    workspaceCode,
    contextType,
    options,
    selectedContextId,
    selectedContext,
    defaultContextId,
    canSelectAll,
    loading,
    savingDefault,
    error,
    selectContext,
    makeDefault,
  } = useWorkspaceContext();

  if (!isManagedWorkspace) return null;

  const isMining = workspaceCode === "mining";
  const noun = isMining ? "Mining site" : "Hire location";
  const plural = isMining ? "Mining sites" : "Hire locations";
  const administrationPath = isMining
    ? "/mining/administration"
    : "/equipment-hire-operations/administration";
  const selectedId = selectedContextId ? String(selectedContextId) : "";
  const isCurrentDefault =
    Number(defaultContextId) > 0 &&
    Number(defaultContextId) === Number(selectedContextId);

  return (
    <div
      className={`workspace-context-selector ${compact ? "is-compact" : ""}`}
    >
      <label>
        <span>{noun}</span>
        <select
          value={selectedId}
          disabled={loading || options.length === 0}
          onChange={(event) => selectContext(event.target.value)}
        >
          {canSelectAll ? <option value="">All {plural.toLowerCase()}</option> : null}
          {!canSelectAll && !selectedId ? (
            <option value="">Choose {noun.toLowerCase()}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {optionLabel(option)}
              {Number(option.id) === Number(defaultContextId) ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>

      {selectedContext && !isCurrentDefault ? (
        <button
          type="button"
          className="workspace-context-default-btn"
          disabled={savingDefault}
          onClick={makeDefault}
          title={`Make this the default ${noun.toLowerCase()}`}
        >
          {savingDefault ? "Saving…" : "Set default"}
        </button>
      ) : null}

      {selectedContext && isCurrentDefault ? (
        <span className="workspace-context-default-badge">Default</span>
      ) : null}

      {!loading && options.length === 0 ? (
        <Link className="workspace-context-empty-link" to={administrationPath}>
          No active {plural.toLowerCase()} — open administration
        </Link>
      ) : null}

      {contextType ? (
        <input type="hidden" value={contextType} readOnly aria-hidden="true" />
      ) : null}

      {error ? <small className="workspace-context-error">{error}</small> : null}
    </div>
  );
}
