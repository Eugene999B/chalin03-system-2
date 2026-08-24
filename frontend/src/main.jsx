import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";
import AdvancedAccountingExpenseFundingEvidence from "./components/AdvancedAccountingExpenseFundingEvidence.jsx";
import OperationalApprovalLauncher from "./components/OperationalApprovalLauncher.jsx";
import ApprovalCentreLiveAttention from "./components/ApprovalCentreLiveAttention.jsx";
import ProductsPageShellRepair from "./components/ProductsPageShellRepair.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import { installCriticalFinanceWorkspacePreload } from "./utils/criticalFinanceWorkspacePreload.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";
import "./styles/installmentExcavatorModalFinal.css";

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v37-excavator-optional-fields";
const APP_SHELL_RELEASE = `browser-cache-integrity-v37-${APP_BUILD_ID}`;

// Dedicated mobile experience release entry point.
installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <ProductsPageShellRepair />
    <OperationalApprovalLauncher />
    <ApprovalCentreLiveAttention />
    <AdvancedAccountingExpenseFundingEvidence />
    <EmergencyCommandOverlay />
    <CommandArrivalBanner />
  </React.StrictMode>
);

window.__chalin03MarkBootHealthy?.(APP_SHELL_RELEASE);

async function removeDevelopmentServiceWorkerCaches() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );

    if ("caches" in window) {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((cacheName) => String(cacheName).startsWith("chalin03-"))
          .map((cacheName) => caches.delete(cacheName))
      );
    }

    if (registrations.length > 0) {
      console.log("✅ Development service workers and old local caches were removed");
    }
  } catch (error) {
    console.warn("⚠️ Could not fully clear development service-worker caches:", error);
  }
}

function requestAssetRecovery(reason) {
  if (typeof window.__chalin03RecoverFromAssetMismatch === "function") {
    window.__chalin03RecoverFromAssetMismatch(reason);
  }
}

window.__chalin03RemoveDevelopmentServiceWorkerCaches = removeDevelopmentServiceWorkerCaches;
window.__chalin03RequestAssetRecovery = requestAssetRecovery;
