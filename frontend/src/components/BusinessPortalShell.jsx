import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PublicPageMeta from "./PublicPageMeta";
import "../styles/businessPortal.css";

function publicPathForWorkspace(workspaceCode) {
  return workspaceCode === "equipment_hire"
    ? "/equipment-hire"
    : "/mining-operations";
}

export default function BusinessPortalShell({ workspace }) {
  const { isLoggedIn } = useAuth();

  const protectedRoute = workspace.openRoute || "/";
  const loginRoute = `/login?workspace=${encodeURIComponent(workspace.code)}`;
  const primaryRoute = isLoggedIn ? protectedRoute : loginRoute;
  const canonicalPath = publicPathForWorkspace(workspace.code);
  const pageDescription = `${workspace.name} is a Chalin 03 Company Limited business division. ${workspace.summary}`;

  return (
    <div
      className={`business-preview-page business-preview-page--${workspace.accent}`}
    >
      <PublicPageMeta
        title={`${workspace.name} | Chalin 03 Company Limited`}
        description={pageDescription}
        canonicalPath={canonicalPath}
      />

      <div className="business-preview-background" />

      <header className="business-preview-topbar">
        <Link className="business-preview-brand" to="/company/">
          <span className="business-preview-logo">
            <img
              src="/chalin03-logo.png"
              alt="Chalin 03 Company Limited logo"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
            <strong>C03</strong>
          </span>

          <span>
            <small>Chalin 03 Company Limited</small>
            <strong>{workspace.name}</strong>
          </span>
        </Link>

        <nav aria-label="Public division navigation">
          <a className="business-preview-back" href="/company/">
            Company Overview
          </a>
          <Link className="business-preview-back" to={loginRoute}>
            Staff Login
          </Link>
        </nav>
      </header>

      <main className="business-preview-main">
        <section className="business-preview-hero">
          <div className="business-preview-copy">
            <div className="business-preview-badges">
              <span>
                {workspace.icon} {workspace.name}
              </span>
              <span>Chalin 03 business division</span>
              <span>Secure staff operations</span>
            </div>

            <p className="business-preview-eyebrow">
              Professional operations in Ghana
            </p>

            <h1>{workspace.headline}</h1>
            <p className="business-preview-summary">{workspace.summary}</p>

            <div className="business-preview-actions">
              <Link className="business-preview-primary" to={primaryRoute}>
                {isLoggedIn
                  ? `Open ${workspace.shortName} Workspace`
                  : `Staff Login to ${workspace.shortName}`}
              </Link>

              <a className="business-preview-secondary" href="#capabilities">
                Explore capabilities
              </a>
            </div>
          </div>

          <aside className="business-preview-status-panel">
            <span className="business-preview-status-dot" />
            <p>Digital operations</p>
            <strong>Controlled and accountable workspace</strong>
            <span>
              Authorized staff work within assigned sites, locations and
              permissions. Operational records remain separated from other Chalin
              03 business divisions.
            </span>
          </aside>
        </section>

        <section className="business-preview-safety">
          <div aria-hidden="true">🛡️</div>
          <div>
            <strong>Secure business operations</strong>
            <p>
              This public page contains company information only. Business records,
              staff controls, financial information and operational documents are
              available exclusively through authenticated workspaces.
            </p>
          </div>
        </section>

        <section id="capabilities" className="business-preview-section">
          <div className="business-preview-section-heading">
            <div>
              <p>Operational capabilities</p>
              <h2>How this division supports the business</h2>
            </div>

            <span>{workspace.modules.length} managed areas</span>
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
            <p className="business-preview-eyebrow">Accountable workflow</p>
            <h2>Clear staff responsibilities and management oversight</h2>
            <p>
              Staff see only the locations, machines and actions granted to their
              accounts. Sensitive approvals and corrections remain traceable.
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
            <p className="business-preview-eyebrow">Shared fleet control</p>
            <h2>Consistent machine records across operational divisions</h2>
            <p>
              Excavators and other machines are registered once. Location,
              availability, meter readings, fuel, inspections, maintenance and
              assignment history remain consistent across Mining Operations and
              Equipment Hire.
            </p>
          </div>
        </section>
      </main>

      <footer className="business-preview-footer">
        <span>Chalin 03 Company Limited</span>
        <span>Dunkwa Police Barrier, Ghana</span>
      </footer>
    </div>
  );
}
