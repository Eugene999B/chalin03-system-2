import { Navigate } from "react-router";
import { useFeatureFlags } from "../context/FeatureFlagContext";

export default function FeatureFlagRoute({
  feature,
  children,
  fallbackPath = "/",
  fallback = null,
  loadingFallback = null,
}) {
  const { isFeatureEnabled, loading } = useFeatureFlags();

  if (loading) {
    return loadingFallback;
  }

  if (!isFeatureEnabled(feature)) {
    if (fallback) {
      return fallback;
    }

    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}
