import { lazy, Suspense } from "react";
import { FeatureFlagProvider } from "../context/FeatureFlagContext";
import ChalinOneStandaloneEntry from "./ChalinOneStandaloneEntry";
import "../index.css";
import "../styles/userPermissionManager.mobile.css";
import "../styles/commandGateExtensions.css";
import "../styles/mobileExperience.css";
import "../styles/adminMobileHotfix.css";

const AiProviderControlLauncher = lazy(() =>
  import("./ai/AiProviderControlLauncher")
);

export default function ProtectedChalinOneEntry() {
  const showProviderControl =
    window.location.pathname === "/intelligence" ||
    window.location.pathname.startsWith("/intelligence/");

  return (
    <FeatureFlagProvider>
      <ChalinOneStandaloneEntry />
      {showProviderControl ? (
        <Suspense fallback={null}>
          <AiProviderControlLauncher />
        </Suspense>
      ) : null}
    </FeatureFlagProvider>
  );
}
