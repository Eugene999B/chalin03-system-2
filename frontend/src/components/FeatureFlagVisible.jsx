import { useFeatureFlags } from "../context/FeatureFlagContext";

export default function FeatureFlagVisible({
  feature,
  children,
  fallback = null,
}) {
  const { isFeatureEnabled, loading } = useFeatureFlags();

  if (loading || !isFeatureEnabled(feature)) {
    return fallback;
  }

  return children;
}
