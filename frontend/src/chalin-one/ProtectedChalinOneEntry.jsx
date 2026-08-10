import { lazy, Suspense } from "react";
import { AppearanceProvider } from "../appearance/AppearanceContext";
import AppearanceToggle from "../appearance/AppearanceToggle";
import { FeatureFlagProvider } from "../context/FeatureFlagContext";
import ChalinOneStandaloneEntry from "./ChalinOneStandaloneEntry";
import "../index.css";
import "../styles/userPermissionManager.mobile.css";
import "../styles/commandGateExtensions.css";
import "../styles/mobileExperience.css";
import "../styles/adminMobileHotfix.css";
import "../styles/appearance.css";
import "./ai/intelligenceOverhaul.css";
import "./ai/providerControlOverhaul.css";

const AiProviderControlLauncher = lazy(() =>
  import("./ai/AiProviderControlLauncher")
);
const ContentStudioAiLauncher = lazy(() =>
  import("./content-studio/ContentStudioAiLauncher")
);

export default function ProtectedChalinOneEntry() {
  const pathname = window.location.pathname;
  const showProviderControl =
    pathname === "/intelligence" ||
    pathname.startsWith("/intelligence/");
  const showContentStudioAi =
    pathname === "/content-studio" ||
    pathname.startsWith("/content-studio/");

  return (
    <AppearanceProvider>
      <FeatureFlagProvider>
        <ChalinOneStandaloneEntry />
        <div className="chalin-global-appearance">
          <AppearanceToggle compact />
        </div>
        {showProviderControl ? (
          <Suspense fallback={null}>
            <AiProviderControlLauncher />
          </Suspense>
        ) : null}
        {showContentStudioAi ? (
          <Suspense fallback={null}>
            <ContentStudioAiLauncher />
          </Suspense>
        ) : null}
      </FeatureFlagProvider>
    </AppearanceProvider>
  );
}
