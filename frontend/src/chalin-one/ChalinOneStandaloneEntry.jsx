import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import FeatureFlagRoute from "../components/FeatureFlagRoute";
import PageErrorBoundary from "../components/PageErrorBoundary";
import PermissionRoute from "../components/PermissionRoute";
import ProtectedRoute from "../components/ProtectedRoute";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { WorkspaceContextProvider } from "../context/WorkspaceContext";
import PublicAnalyticsRuntime from "./public-site/PublicAnalyticsRuntime";
import PublicDetailCompanion from "./public-site/PublicDetailCompanion";
import PublicEditorialFinish from "./public-site/PublicEditorialFinish";
import PublicExperienceCompletion from "./public-site/PublicExperienceCompletion";
import PublicInteractionSafety from "./public-site/PublicInteractionSafety";
import PublicTechnicalFinish from "./public-site/PublicTechnicalFinish";
import PublicWorldEnhancements from "./public-site/PublicWorldEnhancements";

const ContentStudioWorkspace = lazy(() =>
  import("./content-studio/ContentStudioWorkspace")
);
const ContentStudioLoginPage = lazy(() =>
  import("./content-studio/ContentStudioLoginPage")
);
const ContentStudioChangePasswordPage = lazy(() =>
  import("./content-studio/ContentStudioChangePasswordPage")
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
                <PublicInteractionSafety />
                <PublicAnalyticsRuntime />
                <PublicExperienceCompletion />
                <PublicDetailCompanion />
                <PublicWorldEnhancements />
                <PublicEditorialFinish />
                <PublicTechnicalFinish />
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

function ContentStudioSessionGate({ children }) {
  const {
    loading,
    isLoggedIn,
    isContentStudioWorkspace,
    mustChangePassword,
  } = useAuth();

  if (loading) return <StandaloneLoading />;
  if (!isLoggedIn || !isContentStudioWorkspace) {
    return <Navigate replace to="/content-studio/login" />;
  }
  if (mustChangePassword) {
    return <Navigate replace to="/content-studio/change-password" />;
  }
  return children;
}

function ContentStudioEntry() {
  return (
    <AuthProvider>
      <WorkspaceContextProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/content-studio/login"
              element={<SafeStandalone><ContentStudioLoginPage /></SafeStandalone>}
            />
            <Route
              path="/content-studio/change-password"
              element={
                <ContentStudioSessionGate>
                  <SafeStandalone><ContentStudioChangePasswordPage /></SafeStandalone>
                </ContentStudioSessionGate>
              }
            />
            <Route
              path="/content-studio/*"
              element={
                <ContentStudioSessionGate>
                  <PermissionRoute permissions={["public_content.view"]}>
                    <SafeStandalone><ContentStudioWorkspace /></SafeStandalone>
                  </PermissionRoute>
                </ContentStudioSessionGate>
              }
            />
            <Route path="*" element={<FullApplicationHandoff />} />
          </Routes>
        </BrowserRouter>
      </WorkspaceContextProvider>
    </AuthProvider>
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
