import { businessWorkspaces } from "../data/businessWorkspaces";
import "../styles/businessPortal.css";

export default function BusinessWorkspaceSelector({
  selectedCode = "spare_parts",
  onSelect,
}) {
  return (
    <section
      className="business-workspace-selector"
      aria-labelledby="business-workspace-title"
    >
      <div className="business-workspace-heading">
        <div>
          <p className="business-workspace-kicker">Chalin 03 Group</p>
          <h2 id="business-workspace-title">Choose Business Workspace</h2>
        </div>

        <span className="business-workspace-count">
          {businessWorkspaces.length} workspaces
        </span>
      </div>

      <div className="business-workspace-grid">
        {businessWorkspaces.map((workspace) => {
          const isSelected = workspace.code === selectedCode;
          const className = [
            "business-workspace-card",
            `business-workspace-card--${workspace.accent}`,
            isSelected ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={workspace.code}
              type="button"
              className={className}
              aria-pressed={isSelected}
              onClick={() => onSelect?.(workspace.code)}
            >
              <div className="business-workspace-card-top">
                <span className="business-workspace-icon" aria-hidden="true">
                  {workspace.icon}
                </span>

                <span
                  className={`business-workspace-status business-workspace-status--${workspace.statusTone}`}
                >
                  {workspace.status}
                </span>
              </div>

              <strong>{workspace.shortName}</strong>
              <p>{workspace.description}</p>

              <span className="business-workspace-action">
                {isSelected ? "Selected for login" : "Select for login"}{" "}
                <span aria-hidden="true">→</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="business-workspace-note">
        Spare Parts alone uses Main Store and Second Store. Mining sites and
        Equipment Hire locations are created by administrators inside their own
        independent workspaces.
      </p>
    </section>
  );
}
