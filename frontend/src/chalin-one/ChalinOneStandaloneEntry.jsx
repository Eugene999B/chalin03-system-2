import { lazy, Suspense } from "react";
import { BrowserRouter } from "react-router";
import FeatureFlagRoute from "../components/FeatureFlagRoute";
import PageErrorBoundary from "../components/PageErrorBoundary";
import PermissionRoute from "../components/PermissionRoute";
import ProtectedRoute from "../components/ProtectedRoute";
import { AuthProvider } from "../context/AuthContext";
import { WorkspaceContextProvider } from "../context/WorkspaceContext";

const ContentStudioWorkspace = lazy(() =>
  import("./content-studio/ContentStudioWorkspace")
);
const PublicWebsiteApp = lazy(() => import("./public-site/PublicWebsiteApp"));
const PublicWebsiteUnavailable = lazy(() =>
  import("./public-site/PublicWebsiteApp").then((module) => ({
    default: module.PublicWebsiteUnavailable,
  }))
);

export function isChalinOneStandalonePath(pathname) {
  const path = String(pathname || "");
  return path === "/content-studio" || path.startsWith("/content-studio/") ||
    path === "/website" || path.startsWith("/website/");
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
        background: "#f4f7fb",
        color: "#0a2342",
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

function PublicWebsiteEntry() {
  return (
    <BrowserRouter>
      <FeatureFlagRoute
        feature="publicWebsite"
        fallback={
          <SafeStandalone>
            <PublicWebsiteUnavailable />
          </SafeStandalone>
        }
        loadingFallback={<StandaloneLoading />}
      >
        <SafeStandalone>
          <PublicWebsiteApp />
        </SafeStandalone>
      </FeatureFlagRoute>
    </BrowserRouter>
  );
}

function ContentStudioEntry() {
  return (
    <AuthProvider>
      <WorkspaceContextProvider>
        <BrowserRouter>
          <FeatureFlagRoute
            feature="contentStudio"
            fallbackPath="/login"
            loadingFallback={<StandaloneLoading />}
          >
            <ProtectedRoute>
              <PermissionRoute permissions={["public_content.view"]}>
                <SafeStandalone>
                  <ContentStudioWorkspace />
                </SafeStandalone>
              </PermissionRoute>
            </ProtectedRoute>
          </FeatureFlagRoute>
        </BrowserRouter>
      </WorkspaceContextProvider>
    </AuthProvider>
  );
}

export default function ChalinOneStandaloneEntry() {
  const pathname = window.location.pathname;
  if (pathname === "/website" || pathname.startsWith("/website/")) {
    return <PublicWebsiteEntry />;
  }
  return <ContentStudioEntry />;
}
