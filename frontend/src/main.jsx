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
import { initializeChalinTheme } from "./utils/chalinTheme.js";
import "./index.css";
import "./styles/systemTheme.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";
import "./styles/productionLayoutStability.css";
import "./styles/themeHardening.css";
import "./styles/chalinDarkModeV4.css";
import "./styles/chalinDarkModeV4Compat.css";

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v38";
const APP_SHELL_RELEASE = `browser-cache-integrity-v38-${APP_BUILD_ID}`;

initializeChalinTheme();
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
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => String(cacheName).startsWith("chalin03-"))
          .map((cacheName) => caches.delete(cacheName))
      );
    }
  } catch (error) {
    console.warn("⚠️ Could not fully clear development service-worker caches:", error);
  }
}

function requestAssetRecovery(reason) {
  if (typeof window.__chalin03RecoverFromAssetMismatch === "function") {
    window.__chalin03RecoverFromAssetMismatch(reason);
    return;
  }
  window.location.reload();
}

if ("serviceWorker" in navigator) {
  // Temporary host-offline operation:
  // actively remove every Chalin03 service worker and its caches so browsers
  // cannot serve a Chalin03-generated offline page after DNS is disconnected.
  window.addEventListener("load", () => {
    removeDevelopmentServiceWorkerCaches();
  });
}

