import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useFeatureFlags } from "../../context/FeatureFlagContext";
import { contentStudioErrorMessage, getContentStudioDashboard } from "./contentStudioApi";
import ContentStudioCompanyInfoManager from "./ContentStudioCompanyInfoManager";
import ContentStudioDashboard from "./ContentStudioDashboard";
import ContentStudioFormManager from "./ContentStudioFormManager";
import ContentStudioLeadershipManager from "./ContentStudioLeadershipManager";
import ContentStudioMediaManager from "./ContentStudioMediaManager";
import ContentStudioNewsroomManager from "./ContentStudioNewsroomManager";
import {
  ContentStudioApprovalInbox,
  ContentStudioEnquiryDesk,
  ContentStudioNavigationManager,
  ContentStudioSettingsManager,
} from "./ContentStudioOperationalManagers";
import ContentStudioPageManager from "./ContentStudioPageManager";
import {
  ContentStudioEquipmentManager,
  ContentStudioProjectManager,
} from "./ContentStudioPortfolioManagers";
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

const MANAGERS = Object.freeze({
  pages: ContentStudioPageManager,
  newsroom: ContentStudioNewsroomManager,
  leadership: ContentStudioLeadershipManager,
  projects: ContentStudioProjectManager,
  equipment: ContentStudioEquipmentManager,
  "company-info": ContentStudioCompanyInfoManager,
  media: ContentStudioMediaManager,
  forms: ContentStudioFormManager,
  submissions: ContentStudioEnquiryDesk,
  approvals: ContentStudioApprovalInbox,
  navigation: ContentStudioNavigationManager,
  settings: ContentStudioSettingsManager,
});

export default function ContentStudioWorkspace() {
  const auth = useAuth();
  const { loading: featureLoading, error: featureError, isFeatureEnabled } =
    useFeatureFlags();
  const [activeKey, setActiveKey] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState({});
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

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
  const ActiveManager = activeKey === "dashboard" ? null : MANAGERS[activeKey] || null;

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
          ) : ActiveManager ? (
            <ActiveManager />
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
