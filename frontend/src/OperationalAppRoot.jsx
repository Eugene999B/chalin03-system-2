import { lazy, Suspense } from "react";
import App from "./App.jsx";
import AdvancedAccountingExpenseFundingEvidence from "./components/AdvancedAccountingExpenseFundingEvidence.jsx";
import ApprovalCentreLiveAttention from "./components/ApprovalCentreLiveAttention.jsx";
import CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import OperationalApprovalLauncher from "./components/OperationalApprovalLauncher.jsx";
import ProductsPageShellRepair from "./components/ProductsPageShellRepair.jsx";
import { FeatureFlagProvider } from "./context/FeatureFlagContext.jsx";
import { AppearanceProvider } from "./appearance/AppearanceContext.jsx";
import AppearanceToggle from "./appearance/AppearanceToggle.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import { installCriticalFinanceWorkspacePreload } from "./utils/criticalFinanceWorkspacePreload.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";
import "./styles/appearance.css";
import "./styles/appearancePlacement.css";

const ContextualAiSidecar = lazy(() =>
  import("./chalin-one/ai/ContextualAiSidecar.jsx")
);

installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();

export default function OperationalAppRoot() {
  return (
    <AppearanceProvider>
      <FeatureFlagProvider>
        <>
          <App />
          <div className="chalin-global-appearance">
            <AppearanceToggle compact />
          </div>
          <Suspense fallback={null}>
            <ContextualAiSidecar />
          </Suspense>
          <ProductsPageShellRepair />
          <OperationalApprovalLauncher />
          <ApprovalCentreLiveAttention />
          <AdvancedAccountingExpenseFundingEvidence />
          <EmergencyCommandOverlay />
          <CommandArrivalBanner />
        </>
      </FeatureFlagProvider>
    </AppearanceProvider>
  );
}
