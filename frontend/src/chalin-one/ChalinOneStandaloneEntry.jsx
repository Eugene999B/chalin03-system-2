import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import FeatureFlagRoute from "../components/FeatureFlagRoute";
import PageErrorBoundary from "../components/PageErrorBoundary";
import PermissionRoute from "../components/PermissionRoute";
import ProtectedRoute from "../components/ProtectedRoute";
import { AuthProvider } from "../context/AuthContext";
import { WorkspaceContextProvider } from "../context/WorkspaceContext";

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
      Opening CHALIN ONE…
    </main>
  );
}

function SafeStandalone({ children }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<StandaloneLoading />}>{children}</Suspense>
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
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/*"
          element={
            <FeatureFlagRoute
              feature="publicWebsite"
              fallback={
                <SafeStandalone>
                  <PublicCorporateWebsiteUnavailable />
                </SafeStandalone>
              }
              loadingFallback={<StandaloneLoading />}
            >
              <SafeStandalone>
                <PublicCorporateWebsiteApp />
              </SafeStandalone>
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
