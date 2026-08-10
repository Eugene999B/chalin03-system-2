import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage, getContentStudioDashboard } from "./contentStudioApi";
import ContentStudioAccessManager from "./ContentStudioAccessManager";
import ContentStudioCompanyInfoManager from "./ContentStudioCompanyInfoManager";
import ContentStudioDashboard from "./ContentStudioDashboard";
import ContentStudioFormManager from "./ContentStudioFormManager";
import ContentStudioLeadershipManager from "./ContentStudioLeadershipManager";
import ContentStudioMediaCleanupManager from "./ContentStudioMediaCleanupManager";
import ContentStudioMediaManager from "./ContentStudioMediaManagerPro";
import ContentStudioMediaReferenceDesk from "./ContentStudioMediaReferenceDesk";
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
import ContentStudioPublicAnalytics from "./ContentStudioPublicAnalytics";
import ContentStudioPublisherCommandCenter from "./ContentStudioPublisherCommandCenter";
import ContentStudioRedirectManager from "./ContentStudioRedirectManager";
import ContentStudioVisualBuilder from "./ContentStudioVisualBuilderPro";
import ContentStudioWebsiteControlCenter from "./ContentStudioWebsiteControlCenter";
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

const ACCESS_SECTION = Object.freeze({
  key: "access",
  label: "Studio Team & Access",
  shortLabel: "Team & Access",
  badge: "TA",
  scope: "access",
});

const SECTION_SCOPES = Object.freeze({
  "visual-builder": "pages",
  pages: "pages",
  newsroom: "newsroom",
  leadership: "company",
  projects: "company",
  equipment: "company",
  "company-info": "company",
  media: "media",
  "media-cleanup": "media",
  "media-reference": "media",
  forms: "forms",
  submissions: "submissions",
  approvals: "pages",
  "publisher-command": "pages",
  "public-analytics": "dashboard",
  "website-control": "pages",
  redirects: "navigation",
  navigation: "navigation",
  settings: "settings",
});

const MANAGERS = Object.freeze({
  "visual-builder": ContentStudioVisualBuilder,
  pages: ContentStudioPageManager,
  newsroom: ContentStudioNewsroomManager,
  leadership: ContentStudioLeadershipManager,
  projects: ContentStudioProjectManager,
  equipment: ContentStudioEquipmentManager,
  "company-info": ContentStudioCompanyInfoManager,
  media: ContentStudioMediaManager,
  "media-cleanup": ContentStudioMediaCleanupManager,
  "media-reference": ContentStudioMediaReferenceDesk,
  forms: ContentStudioFormManager,
  submissions: ContentStudioEnquiryDesk,
  approvals: ContentStudioApprovalInbox,
  "publisher-command": ContentStudioPublisherCommandCenter,
  "public-analytics": ContentStudioPublicAnalytics,
  "website-control": ContentStudioWebsiteControlCenter,
  redirects: ContentStudioRedirectManager,
  navigation: ContentStudioNavigationManager,
  settings: ContentStudioSettingsManager,
  access: ContentStudioAccessManager,
});

export default function ContentStudioWorkspace() {
  const auth = useAuth();
  const [activeKey, setActiveKey] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState({});
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const hasPermission = useCallback(
    (permission) => auth.hasPermission(permission),
    [auth]
  );
  const scopeSet = useMemo(
    () => new Set(auth.contentStudioScopes || []),
    [auth.contentStudioScopes]
  );
  const sections = useMemo(() => {
    const permissionSections = getAccessibleContentStudioSections(hasPermission).filter(
      (section) =>
        auth.isContentStudioOwner || scopeSet.has(SECTION_SCOPES[section.key] || "dashboard")
    );
    return auth.isContentStudioOwner
      ? [...permissionSections, ACCESS_SECTION]
      : permissionSections;
  }, [auth.isContentStudioOwner, hasPermission, scopeSet]);
  const activeSection = useMemo(
    () =>
      activeKey === "access"
        ? ACCESS_SECTION
        : CONTENT_STUDIO_SECTIONS.find((section) => section.key === activeKey) || null,
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
      !auth.isLoggedIn ||
      !auth.isContentStudioWorkspace ||
      !hasPermission(CONTENT_STUDIO_PERMISSIONS.view)
    ) {
      return undefined;
    }
    const controller = new AbortController();
    refreshDashboard({ signal: controller.signal });
    return () => controller.abort();
  }, [
    auth.isContentStudioWorkspace,
    auth.isLoggedIn,
    auth.loading,
    hasPermission,
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

  if (auth.loading) {
    return (
      <AccessState
        title="Opening Content Studio"
        message="Confirming your isolated Studio session, role and publishing scope."
        tone="neutral"
      />
    );
  }

  if (!auth.isLoggedIn || !auth.isContentStudioWorkspace) {
    return (
      <AccessState
        title="Content Studio sign-in required"
        message="Open Content Studio with a dedicated Studio identity. Operational Staff sessions cannot enter this workspace."
        tone="danger"
      />
    );
  }

  if (!hasPermission(CONTENT_STUDIO_PERMISSIONS.view)) {
    return (
      <AccessState
        title="Studio role required"
        message="Your Content Studio role does not include access to the publishing workspace."
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
            <span>Governed publishing workspace</span>
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
          <span>Studio identity</span>
          <strong>{auth.user?.full_name || auth.user?.username || "Content Studio user"}</strong>
          <small>{auth.contentStudioRoleName || auth.contentStudioRole || "Publishing role"}</small>
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
            <span className="cs-status-chip cs-status-success">
              {auth.isContentStudioOwner ? "Owner" : auth.contentStudioRoleName || "Protected"}
            </span>
            <a
              className="cs-button cs-button-secondary"
              href="/"
              target="_blank"
              rel="noreferrer"
              title="Open the governed public website in a new tab."
            >
              Open website
            </a>
          </div>
        </header>

        <main className="cs-content">
          {activeKey === "dashboard" ? (
            <ContentStudioDashboard
              dashboard={dashboard}
              sections={sections.filter((section) => section.key !== "access")}
              onOpenSection={openSection}
              loading={dashboardLoading}
              error={dashboardError}
              onRetry={refreshDashboard}
            />
          ) : ActiveManager ? (
            <ActiveManager onOpenSection={openSection} />
          ) : (
            <AccessState
              title="Manager unavailable"
              message="This Content Studio manager is not available to your Studio role."
            />
          )}
        </main>
      </div>
    </div>
  );
}
