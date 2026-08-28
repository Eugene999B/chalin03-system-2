import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import WorkspaceContextSelector from "./WorkspaceContextSelector";
import "../styles/businessWorkspaceLayout.css";
import "../styles/systemTheme.css";

function initials(name) {
  const clean = String(name || "User").trim();

  return (
    clean
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"
  );
}

function canSee(item, role, auth) {
  if (!item.roles || item.roles.length === 0) {
    if (item.permissions?.length && !auth.hasEveryPermission(item.permissions)) return false;
    if (item.anyPermissions?.length && !auth.hasAnyPermission(item.anyPermissions)) return false;
    return true;
  }

  if (!item.roles.includes(role)) return false;
  if (item.permissions?.length && !auth.hasEveryPermission(item.permissions)) return false;
  if (item.anyPermissions?.length && !auth.hasAnyPermission(item.anyPermissions)) return false;
  return true;
}

function splitNavigationTarget(path) {
  const [pathname, query = ""] = String(path || "").split("?");
  return { pathname: pathname || "/", search: new URLSearchParams(query).toString() };
}

function isNavigationItemActive(item, location) {
  const target = splitNavigationTarget(item.path);
  const currentPath = location.pathname;
  const pathMatches = item.end
    ? currentPath === target.pathname
    : currentPath === target.pathname || currentPath.startsWith(`${target.pathname}/`);

  if (!pathMatches) return false;
  if (!item.matchSearch) return true;

  return new URLSearchParams(location.search).toString() === target.search;
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem("chalin03-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Ignore storage restrictions and use a safe default.
  }
  return "light";
}

export default function BusinessWorkspaceLayout({
  workspaceName,
  icon,
  description,
  theme,
  navigationSections,
  independenceLabel = "Independent workspace",
  contextHeading = "Active operating context",
  workspaceEyebrow = "Current business workspace",
  separationBadge = "Separated from Spare Parts",
}) {
  const auth = useAuth();
  const { user, role, workspaceRole, logout } = auth;
  const { isManagedWorkspace, selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(getInitialTheme);

  const visibleSections = useMemo(
    () =>
      navigationSections
        .map((section) => ({ ...section, items: section.items.filter((item) => canSee(item, role, auth)) }))
        .filter((section) => section.items.length > 0),
    [navigationSections, role, auth]
  );

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-chalin-theme", themeMode);
    try {
      localStorage.setItem("chalin03-theme", themeMode);
    } catch {
      // Theme remains active for the current session when storage is unavailable.
    }
  }, [themeMode]);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 960) setMenuOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function switchBusiness() {
    logout();
    navigate("/login", { replace: true });
  }

  function logoutCompletely() {
    logout();
    navigate("/login", { replace: true });
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  }

  const displayName = user?.full_name || user?.username || "Authorized User";
  const showContextSelector = isManagedWorkspace && workspaceName !== "Group Executive Control";
  const showIndependentNote = Boolean(independenceLabel || description);
  const contextStatus = selectedContext
    ? `${selectedContext.code ? `${selectedContext.code} — ` : ""}${selectedContext.name}`
    : automaticAccess
      ? "All locations"
      : "No location selected";

  return (
    <div className={`bwl-shell bwl-theme-${theme || "navy"}`}>
      <button
        type="button"
        className="bwl-mobile-toggle"
        aria-label="Open workspace menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span>☰</span>
        <strong>{workspaceName}</strong>
      </button>

      {menuOpen ? (
        <button className="bwl-overlay" type="button" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />
      ) : null}

      <aside className={`bwl-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="bwl-brand">
          <div className="bwl-brand-icon" aria-hidden="true">{icon}</div>
          <div>
            <small>Chalin 03 Company Limited</small>
            <strong>{workspaceName}</strong>
          </div>
        </div>

        {showIndependentNote ? (
          <div className="bwl-independent-note">
            {independenceLabel ? <span>{independenceLabel}</span> : null}
            {description ? <p>{description}</p> : null}
          </div>
        ) : null}

        {showContextSelector ? (
          <div className="bwl-context-summary">
            <small>{contextHeading}</small>
            <strong>{contextStatus}</strong>
            <span>
              {selectedContextId
                ? "Records are reviewed for this site or location."
                : automaticAccess
                  ? "Administrator view across every active location."
                  : "Ask an administrator to assign a location."}
            </span>
          </div>
        ) : null}

        <nav className="bwl-navigation" aria-label={`${workspaceName} navigation`}>
          {visibleSections.map((section) => (
            <section key={section.title}>
              <p className="bwl-section-title">{section.title}</p>
              <div className="bwl-nav-list">
                {section.items.map((item) => {
                  const active = isNavigationItemActive(item, location);
                  return (
                    <NavLink
                      key={`${item.title}:${item.path}`}
                      to={item.path}
                      end={Boolean(item.end)}
                      aria-current={active ? "page" : undefined}
                      className={() => `bwl-nav-item ${active ? "is-active" : ""}`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span className="bwl-nav-icon" aria-hidden="true">{item.icon}</span>
                      <span>
                        <strong>{item.title}</strong>
                        {item.description ? <small>{item.description}</small> : null}
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="bwl-user-card">
          <div className="bwl-avatar">{initials(displayName)}</div>
          <div>
            <strong>{displayName}</strong>
            <span>{String(workspaceRole || role || "staff").toUpperCase()}</span>
          </div>
        </div>

        <button
          type="button"
          className="bwl-theme-control"
          aria-pressed={themeMode === "dark"}
          onClick={toggleTheme}
          title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span aria-hidden="true">{themeMode === "dark" ? "☀" : "☾"}</span>
          {themeMode === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <div className="bwl-sidebar-actions">
          <button type="button" onClick={switchBusiness}>⇄ Switch Business</button>
          <button type="button" onClick={logoutCompletely}>↪ Logout</button>
        </div>
      </aside>

      <div className="bwl-main">
        <header className="bwl-topbar">
          <div>
            <small>{workspaceEyebrow}</small>
            <strong><span aria-hidden="true">{icon}</span> {workspaceName}</strong>
          </div>
          <div className="bwl-topbar-right">
            {showContextSelector ? <WorkspaceContextSelector compact /> : null}
            {separationBadge ? <span className="bwl-separation-badge">{separationBadge}</span> : null}
            <button
              type="button"
              className="bwl-theme-control"
              aria-pressed={themeMode === "dark"}
              onClick={toggleTheme}
              title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <span aria-hidden="true">{themeMode === "dark" ? "☀" : "☾"}</span>
              {themeMode === "dark" ? "Light" : "Dark"}
            </button>
            <button type="button" onClick={switchBusiness}>Switch Business</button>
          </div>
        </header>
        <main className="bwl-content"><Outlet /></main>
      </div>
    </div>
  );
}
