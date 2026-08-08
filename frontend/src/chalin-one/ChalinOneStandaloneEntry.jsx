import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import FeatureFlagRoute from "../components/FeatureFlagRoute";
import PageErrorBoundary from "../components/PageErrorBoundary";
import PermissionRoute from "../components/PermissionRoute";
import ProtectedRoute from "../components/ProtectedRoute";
import { AuthProvider } from "../context/AuthContext";
import { WorkspaceContextProvider } from "../context/WorkspaceContext";
import PublicDetailCompanion from "./public-site/PublicDetailCompanion";
import PublicExperienceCompletion from "./public-site/PublicExperienceCompletion";

const ContentStudioWorkspace = lazy(() =>
  import("./content-studio/ContentStudioWorkspace")
);
const ChalinIntelligenceWorkspace = lazy(() =>
  import("./ai/ChalinIntelligenceWorkspace")
);
const DocumentIntelligencePage = lazy(() =>
  import("./ai/DocumentIntelligencePage")
);
const DocumentIntelligenceLauncher = lazy(() =>
  import("./ai/DocumentIntelligenceLauncher")
);
const ExecutiveScorecardPage = lazy(() =>
  import("./ai/ExecutiveScorecardPage")
);
const ExecutiveScenarioEnginePage = lazy(() =>
  import("./ai/ExecutiveScenarioEnginePage")
);
const ExecutiveScorecardLauncher = lazy(() =>
  import("./ai/ExecutiveScorecardLauncher")
);
const PublicCorporateWebsiteApp = lazy(() =>
  import("./public-site/PublicCorporateWebsiteApp")
);
const PublicCorporateWebsiteUnavailable = lazy(() =>
  import("./public-site/PublicCorporateWebsiteApp").then((module) => ({
    default: module.PublicCorporateWebsiteUnavailable,
  }))
);

const PUBLIC_TOP_LEVEL_PATHS = new Set([
  "about",
  "businesses",
  "projects",
  "equipment",
  "news",
  "leadership",
  "media",
  "careers",
  "locations",
  "contact",
  "faqs",
  "tenders",
  "testimonials",
  "forms",
  "pages",
  "website",
]);

export function isPublicWebsitePath(pathname) {
  const path = String(pathname || "").split(/[?#]/)[0] || "/";

  // CHALIN ONE is the permanent company front door. Staff work now enters
  // through /login and the explicit /staff dashboard rather than borrowing /.
  if (path === "/") return true;

  const firstSegment = path.replace(/^\/+/, "").split("/")[0];
  return PUBLIC_TOP_LEVEL_PATHS.has(firstSegment);
}

export function isChalinOneStandalonePath(pathname) {
  const path = String(pathname || "");
  return (
    isPublicWebsitePath(path) ||
    path === "/content-studio" ||
    path.startsWith("/content-studio/") ||
    path === "/intelligence" ||
    path.startsWith("/intelligence/")
  );
}

function StandaloneLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "#07131f",
        color: "#ffffff",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 800,
      }}
    >
      Loading secure workspace…
    </main>
  );
}

function PublicStandaloneLoading() {
  return (
    <main
      role="status"
      aria-label="Loading CHALIN ONE public website"
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(90deg, rgba(240,189,53,.95), rgba(122,214,255,.9), rgba(240,189,53,.95)) top left / 26% 2px no-repeat, #05080d",
      }}
    />
  );
}

function SafeStandalone({ children, fallback = <StandaloneLoading /> }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

function FullApplicationHandoff() {
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return <StandaloneLoading />;
}

function PublicWebsiteEntry() {
  const quietFallback = <PublicStandaloneLoading />;
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/*"
          element={
            <FeatureFlagRoute
              feature="publicWebsite"
              fallback={
                <SafeStandalone fallback={quietFallback}>
                  <PublicCorporateWebsiteUnavailable />
                </SafeStandalone>
              }
              loadingFallback={quietFallback}
            >
              <>
                <PublicExperienceCompletion />
                <PublicDetailCompanion />
                <SafeStandalone fallback={quietFallback}>
                  <PublicCorporateWebsiteApp />
                </SafeStandalone>
              </>
            </FeatureFlagRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function StaffStandaloneShell({ routePath, feature, permission, children }) {
  return (
    <AuthProvider>
      <WorkspaceContextProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path={routePath}
              element={
                <FeatureFlagRoute
                  feature={feature}
                  fallbackPath="/login"
                  loadingFallback={<StandaloneLoading />}
                >
                  <ProtectedRoute>
                    <PermissionRoute permissions={[permission]}>
                      <SafeStandalone>{children}</SafeStandalone>
                    </PermissionRoute>
                  </ProtectedRoute>
                </FeatureFlagRoute>
              }
            />
            <Route path="*" element={<FullApplicationHandoff />} />
          </Routes>
        </BrowserRouter>
      </WorkspaceContextProvider>
    </AuthProvider>
  );
}

function ContentStudioEntry() {
  return (
    <StaffStandaloneShell
      routePath="/content-studio/*"
      feature="contentStudio"
      permission="public_content.view"
    >
      <ContentStudioWorkspace />
    </StaffStandaloneShell>
  );
}

function IntelligenceWorkspaceSurface() {
  if (window.location.pathname === "/intelligence/documents") {
    return <DocumentIntelligencePage />;
  }
  if (window.location.pathname === "/intelligence/executive-scorecard") {
    return <ExecutiveScorecardPage />;
  }
  if (window.location.pathname === "/intelligence/executive-scenarios") {
    return <ExecutiveScenarioEnginePage />;
  }

  return (
    <>
      <ChalinIntelligenceWorkspace />
      <DocumentIntelligenceLauncher />
      <ExecutiveScorecardLauncher />
    </>
  );
}

function IntelligenceEntry() {
  return (
    <StaffStandaloneShell
      routePath="/intelligence/*"
      feature="aiEnabled"
      permission="workspace.view"
    >
      <IntelligenceWorkspaceSurface />
    </StaffStandaloneShell>
  );
}

export default function ChalinOneStandaloneEntry() {
  const pathname = window.location.pathname;
  if (pathname === "/content-studio" || pathname.startsWith("/content-studio/")) {
    return <ContentStudioEntry />;
  }
  if (pathname === "/intelligence" || pathname.startsWith("/intelligence/")) {
    return <IntelligenceEntry />;
  }
  return <PublicWebsiteEntry />;
}
