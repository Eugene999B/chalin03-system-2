import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import FeatureFlagRoute from "../components/FeatureFlagRoute";
import PageErrorBoundary from "../components/PageErrorBoundary";
import { FeatureFlagProvider } from "../context/FeatureFlagContext";
import PublicAnalyticsRuntime from "./public-site/PublicAnalyticsRuntime";
import PublicDetailCompanion from "./public-site/PublicDetailCompanion";
import PublicEditorialFinish from "./public-site/PublicEditorialFinish";
import PublicExperienceCompletion from "./public-site/PublicExperienceCompletion";
import PublicInteractionSafety from "./public-site/PublicInteractionSafety";
import PublicTechnicalFinish from "./public-site/PublicTechnicalFinish";
import "./public-site/publicBootPolish.css";

const PublicCorporateWebsiteApp = lazy(() =>
  import("./public-site/PublicCorporateWebsiteApp")
);
const PublicCorporateWebsiteUnavailable = lazy(() =>
  import("./public-site/PublicCorporateWebsiteApp").then((module) => ({
    default: module.PublicCorporateWebsiteUnavailable,
  }))
);
const PublicWorldEnhancements = lazy(() =>
  import("./public-site/PublicWorldEnhancements")
);

function DeferredPublicWorldEnhancements() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setReady(true), {
        timeout: 1800,
      });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timerId = window.setTimeout(() => setReady(true), 900);
    return () => window.clearTimeout(timerId);
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <PublicWorldEnhancements />
    </Suspense>
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

function SafePublic({ children, fallback }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

export default function PublicChalinOneEntry() {
  const quietFallback = <PublicStandaloneLoading />;

  return (
    <FeatureFlagProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/*"
            element={
              <FeatureFlagRoute
                feature="publicWebsite"
                fallback={
                  <SafePublic fallback={quietFallback}>
                    <PublicCorporateWebsiteUnavailable />
                  </SafePublic>
                }
                loadingFallback={quietFallback}
              >
                <>
                  <PublicInteractionSafety />
                  <PublicAnalyticsRuntime />
                  <PublicExperienceCompletion />
                  <PublicDetailCompanion />
                  <DeferredPublicWorldEnhancements />
                  <PublicEditorialFinish />
                  <PublicTechnicalFinish />
                  <SafePublic fallback={quietFallback}>
                    <PublicCorporateWebsiteApp />
                  </SafePublic>
                </>
              </FeatureFlagRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </FeatureFlagProvider>
  );
}
