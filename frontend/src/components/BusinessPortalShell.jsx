import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/businessPortal.css";

export default function BusinessPortalShell({ workspace }) {
  const { isLoggedIn } = useAuth();

  const protectedRoute = workspace.openRoute || "/";
  const loginRoute = `/login?workspace=${encodeURIComponent(workspace.code)}`;
  const primaryRoute = isLoggedIn ? protectedRoute : loginRoute;

  return (
    <div
      className={`business-preview-page business-preview-page--${workspace.accent}`}
    >
      <div className="business-preview-background" />

      <header className="business-preview-topbar">
        <Link className="business-preview-brand" to={loginRoute}>
          <span className="business-preview-logo">
            <img
              src="/chalin03-logo.png"
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
            <strong>C03</strong>
          </span>

          <span>
            <small>Chalin 03 Group Operations Platform</small>
            <strong>{workspace.name}</strong>
          </span>
        </Link>

        <Link className="business-preview-back" to={loginRoute}>
          ← Return to Staff Login
        </Link>
      </header>

      <main className="business-preview-main">
        <section className="business-preview-hero">
          <div className="business-preview-copy">
            <div className="business-preview-badges">
              <span>
                {workspace.icon} {workspace.name}
              </span>
              <span>Operational MVP</span>
              <span>Separate workspace</span>
            </div>

            <p className="business-preview-eyebrow">
              New Chalin 03 business module
            </p>

            <h1>{workspace.headline}</h1>
            <p className="business-preview-summary">{workspace.summary}</p>

            <div className="business-preview-actions">
              <Link className="business-preview-primary" to={primaryRoute}>
                {isLoggedIn
                  ? `Open ${workspace.shortName} Workspace`
                  : `Login to ${workspace.shortName}`}
              </Link>

              <a className="business-preview-secondary" href="#module-plan">
                View operational areas
              </a>
            </div>
          </div>

          <aside className="business-preview-status-panel">
            <span className="business-preview-status-dot" />
            <p>Current rollout status</p>
            <strong>
              {workspace.openRoute ? "Operational workspace" : "Workspace prepared"}
            </strong>
            <span>
              {workspace.rolloutMessage ||
                "The workspace is separated from the live spare-parts operation. Operational forms and database routes will be enabled phase by phase after testing."}
            </span>
          </aside>
        </section>

        <section className="business-preview-safety">
          <div aria-hidden="true">🛡️</div>
          <div>
            <strong>Live-system protection</strong>
            <p>
              This public overview page does not create, change or delete business
              records. Sign in through the workspace-aware login to enter the
              protected operational area.
            </p>
          </div>
        </section>

        <section id="module-plan" className="business-preview-section">
          <div className="business-preview-section-heading">
            <div>
              <p>Connected operational areas</p>
              <h2>Everything this workspace manages</h2>
            </div>

            <span>{workspace.modules.length} module areas</span>
          </div>

          <div className="business-preview-module-grid">
            {workspace.modules.map((module) => (
              <article className="business-preview-module" key={module.title}>
                <span aria-hidden="true">{module.icon}</span>
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="business-preview-workflow">
          <div>
            <p className="business-preview-eyebrow">Operating flow</p>
            <h2>Simple staff workflow, strong management control</h2>
            <p>
              Staff will see only the sites, machines and actions granted to
              their account. Sensitive approvals and corrections will remain
              traceable.
            </p>
          </div>

          <ol>
            {workspace.workflow.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="business-preview-shared-fleet">
          <div className="business-preview-fleet-icon" aria-hidden="true">
            🚜
          </div>

          <div>
            <p className="business-preview-eyebrow">Shared fleet foundation</p>
            <h2>One machine register for Mining and Equipment Hire</h2>
            <p>
              Excavators and other machines are registered once. Their location,
              availability, meter readings, fuel, inspections, maintenance and
              assignment history stay consistent across both workspaces.
            </p>
          </div>
        </section>
      </main>

      <footer className="business-preview-footer">
        <span>Chalin 03 Company Limited</span>
        <span>Group Operations Local Completion</span>
      </footer>
    </div>
  );
}
