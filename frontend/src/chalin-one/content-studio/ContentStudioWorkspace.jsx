import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useFeatureFlags } from "../../context/FeatureFlagContext";
import {
  contentStudioErrorMessage,
  getContentStudioDashboard,
  listContentStudioResource,
} from "./contentStudioApi";
import ContentStudioDashboard from "./ContentStudioDashboard";
import ContentStudioLeadershipManager from "./ContentStudioLeadershipManager";
import ContentStudioNewsroomManager from "./ContentStudioNewsroomManager";
import ContentStudioPageManager from "./ContentStudioPageManager";
import {
  CONTENT_STUDIO_PERMISSIONS,
  CONTENT_STUDIO_SECTIONS,
  getAccessibleContentStudioSections,
} from "./contentStudioModel";
import "./contentStudio.css";

function AccessState({ title, message, tone = "warning" }) {
  return (
    <main className="cs-access-state">
      <div className={`cs-access-card cs-access-${tone}`}>
        <span className="cs-access-mark" aria-hidden="true">CS</span>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </main>
  );
}

function ModuleOverview({ section, data, loading, error, onRefresh }) {
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : [];
  const total = Number(data?.total ?? items.length ?? 0);

  return (
    <div className="cs-module">
      <section className="cs-module-hero">
        <div className={`cs-badge cs-badge-${section.tone}`} aria-hidden="true">
          {section.badge}
        </div>
        <div>
          <span className="cs-eyebrow">{section.group}</span>
          <h2>{section.label}</h2>
          <p>{section.description}</p>
        </div>
        <button type="button" className="cs-button cs-button-secondary" onClick={onRefresh}>
          Refresh
        </button>
      </section>

      {error ? (
        <div className="cs-alert cs-alert-danger" role="alert">
          <div>
            <strong>Manager could not be refreshed</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <section className="cs-panel cs-module-panel" aria-busy={loading ? "true" : "false"}>
        <div className="cs-panel-heading">
          <div>
            <span className="cs-eyebrow">Read-only foundation</span>
            <h3>{loading ? "Loading records…" : `${total.toLocaleString("en-GH")} records`}</h3>
          </div>
          <span className="cs-status-chip cs-status-neutral">Editor interface next</span>
        </div>
        <p className="cs-module-note">
          This first visual release verifies protected navigation, permissions and API
          loading. Create, edit, review and publish forms will be added module by module
          without weakening the backend approval workflow.
        </p>
        <div className="cs-record-preview">
          {items.slice(0, 5).map((item, index) => (
            <div className="cs-record-row" key={item.id || item.key || item.slug || index}>
              <span>{item.title || item.name || item.label || item.slug || `Record ${index + 1}`}</span>
              <small>{item.publication_status || item.status || item.latest_version_status || "Available"}</small>
            </div>
          ))}
          {!loading && items.length === 0 ? (
            <div className="cs-empty-state">
              <strong>No records yet</strong>
              <span>This manager is ready for its first approved content.</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default function ContentStudioWorkspace() {
  const auth = useAuth();
  const { loading: featureLoading, error: featureError, isFeatureEnabled } =
    useFeatureFlags();
  const [activeKey, setActiveKey] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState({});
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [moduleData, setModuleData] = useState(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleError, setModuleError] = useState("");

  const hasPermission = useCallback(
    (permission) => auth.hasPermission(permission),
    [auth]
  );
  const sections = useMemo(
    () => getAccessibleContentStudioSections(hasPermission),
    [hasPermission]
  );
  const activeSection = useMemo(
    () => CONTENT_STUDIO_SECTIONS.find((section) => section.key === activeKey) || null,
    [activeKey]
  );

  const refreshDashboard = useCallback(async ({ signal } = {}) => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const nextDashboard = await getContentStudioDashboard({ signal });
      if (!signal?.aborted) setDashboard(nextDashboard);
    } catch (error) {
      if (!signal?.aborted) setDashboardError(contentStudioErrorMessage(error));
    } finally {
      if (!signal?.aborted) setDashboardLoading(false);
    }
  }, []);

  const refreshModule = useCallback(async ({ signal } = {}) => {
    if (!activeSection) return;
    setModuleLoading(true);
    setModuleError("");
    try {
      const nextData = await listContentStudioResource(
        activeSection.endpoint,
        { limit: 30, offset: 0 },
        { signal }
      );
      if (!signal?.aborted) setModuleData(nextData);
    } catch (error) {
      if (!signal?.aborted) {
        setModuleError(contentStudioErrorMessage(error));
        setModuleData(null);
      }
    } finally {
      if (!signal?.aborted) setModuleLoading(false);
    }
  }, [activeSection]);

  useEffect(() => {
    if (
      auth.loading ||
      featureLoading ||
      !auth.isLoggedIn ||
      !isFeatureEnabled("contentStudio") ||
      !hasPermission(CONTENT_STUDIO_PERMISSIONS.view)
    ) {
      return undefined;
    }
    const controller = new AbortController();
    refreshDashboard({ signal: controller.signal });
    return () => controller.abort();
  }, [
    auth.isLoggedIn,
    auth.loading,
    featureLoading,
    hasPermission,
    isFeatureEnabled,
    refreshDashboard,
  ]);

  useEffect(() => {
    if (
      activeKey === "dashboard" ||
      activeKey === "pages" ||
      activeKey === "newsroom" ||
      activeKey === "leadership"
    ) {
      setModuleData(null);
      setModuleError("");
      return undefined;
    }
    const controller = new AbortController();
    refreshModule({ signal: controller.signal });
    return () => controller.abort();
  }, [activeKey, refreshModule]);

  useEffect(() => {
    if (
      activeKey !== "dashboard" &&
      !sections.some((section) => section.key === activeKey)
    ) {
      setActiveKey("dashboard");
    }
  }, [activeKey, sections]);

  function openSection(key) {
    setActiveKey(key);
    setMenuOpen(false);
  }

  if (auth.loading || featureLoading) {
    return (
      <AccessState
        title="Opening Content Studio"
        message="Confirming your secure session, feature access and publishing permissions."
        tone="neutral"
      />
    );
  }

  if (!auth.isLoggedIn) {
    return (
      <AccessState
        title="Staff sign-in required"
        message="Content Studio is a protected staff workspace. Sign in through the normal Chalin 03 login."
        tone="danger"
      />
    );
  }

  if (!isFeatureEnabled("contentStudio")) {
    return (
      <AccessState
        title="Content Studio is not enabled"
        message={featureError || "This CHALIN ONE feature remains safely disabled in this environment."}
      />
    );
  }

  if (!hasPermission(CONTENT_STUDIO_PERMISSIONS.view)) {
    return (
      <AccessState
        title="Permission required"
        message="Your account does not have permission to view public website content administration."
        tone="danger"
      />
    );
  }

  return (
    <div className="cs-shell">
      <button
        type="button"
        className="cs-mobile-backdrop"
        aria-label="Close Content Studio menu"
        data-open={menuOpen ? "true" : "false"}
        onClick={() => setMenuOpen(false)}
      />

      <aside className="cs-sidebar" data-open={menuOpen ? "true" : "false"}>
        <div className="cs-brand">
          <span className="cs-brand-mark" aria-hidden="true">C1</span>
          <div>
            <strong>Chalin Content Studio</strong>
            <span>Public website control</span>
          </div>
        </div>

        <nav className="cs-nav" aria-label="Content Studio managers">
          <button
            type="button"
            className={activeKey === "dashboard" ? "cs-nav-item is-active" : "cs-nav-item"}
            onClick={() => openSection("dashboard")}
          >
            <span className="cs-nav-badge">DB</span>
            <span>Dashboard</span>
          </button>
          {sections.map((section) => (
            <button
              type="button"
              key={section.key}
              className={activeKey === section.key ? "cs-nav-item is-active" : "cs-nav-item"}
              onClick={() => openSection(section.key)}
            >
              <span className="cs-nav-badge">{section.badge}</span>
              <span>{section.shortLabel}</span>
            </button>
          ))}
        </nav>

        <div className="cs-sidebar-footer">
          <span>Signed in as</span>
          <strong>{auth.user?.full_name || auth.user?.username || "Staff member"}</strong>
          <small>{auth.workspaceName || "Chalin 03"}</small>
        </div>
      </aside>

      <div className="cs-main">
        <header className="cs-topbar">
          <button
            type="button"
            className="cs-menu-button"
            aria-label="Open Content Studio menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <div>
            <span className="cs-topbar-label">Content Studio</span>
            <strong>{activeSection?.label || "Dashboard"}</strong>
          </div>
          <div className="cs-topbar-actions">
            <span className="cs-status-chip cs-status-success">Protected</span>
            <button
              type="button"
              className="cs-button cs-button-secondary"
              disabled
              title="Public preview will be enabled after the separate website renderer is connected."
            >
              Preview website
            </button>
          </div>
        </header>

        <main className="cs-content">
          {activeKey === "dashboard" ? (
            <ContentStudioDashboard
              dashboard={dashboard}
              sections={sections}
              onOpenSection={openSection}
              loading={dashboardLoading}
              error={dashboardError}
              onRetry={refreshDashboard}
            />
          ) : activeKey === "pages" ? (
            <ContentStudioPageManager />
          ) : activeKey === "newsroom" ? (
            <ContentStudioNewsroomManager />
          ) : activeKey === "leadership" ? (
            <ContentStudioLeadershipManager />
          ) : activeSection ? (
            <ModuleOverview
              section={activeSection}
              data={moduleData}
              loading={moduleLoading}
              error={moduleError}
              onRefresh={refreshModule}
            />
          ) : (
            <AccessState
              title="Manager unavailable"
              message="This Content Studio manager is not available to your account."
            />
          )}
        </main>
      </div>
    </div>
  );
}
