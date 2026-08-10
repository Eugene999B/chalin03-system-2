import App from "./App.jsx";
import AdvancedAccountingExpenseFundingEvidence from "./components/AdvancedAccountingExpenseFundingEvidence.jsx";
import ApprovalCentreLiveAttention from "./components/ApprovalCentreLiveAttention.jsx";
import ChalinOneGatewayLinks from "./components/ChalinOneGatewayLinks.jsx";
import CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import OperationalApprovalLauncher from "./components/OperationalApprovalLauncher.jsx";
import ProductsPageShellRepair from "./components/ProductsPageShellRepair.jsx";
import { FeatureFlagProvider } from "./context/FeatureFlagContext.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import { installCriticalFinanceWorkspacePreload } from "./utils/criticalFinanceWorkspacePreload.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";

installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();

export default function OperationalAppRoot() {
  return (
    <FeatureFlagProvider>
      <>
        <App />
        <ChalinOneGatewayLinks />
        <ProductsPageShellRepair />
        <OperationalApprovalLauncher />
        <ApprovalCentreLiveAttention />
        <AdvancedAccountingExpenseFundingEvidence />
        <EmergencyCommandOverlay />
        <CommandArrivalBanner />
      </>
    </FeatureFlagProvider>
  );
}
