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
import "./styles/loginHumanCopy.css";
import "./styles/financeNumberLayout.css";

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v49-users-settings-intelligence-recovery";
const APP_SHELL_RELEASE = `browser-cache-integrity-v49-${APP_BUILD_ID}`;
const CACHE_RECOVERY_KEY = "__chalin03_frontend_recovery_v49__";

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

async function clearProductionFrontendCacheOnce() {
  if (!import.meta.env.PROD || typeof window === "undefined") return;

  try {
    if (window.localStorage.getItem(CACHE_RECOVERY_KEY) === "done") return;

    window.localStorage.setItem(CACHE_RECOVERY_KEY, "done");

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister())
      );
    }

    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => String(cacheName).startsWith("chalin03-"))
          .map((cacheName) => caches.delete(cacheName))
      );
    }

    window.location.reload();
  } catch (error) {
    console.warn("⚠️ Chalin 03 frontend cache recovery could not complete:", error);
  }
}

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
      console.log(
        "✅ Development service workers and old local caches were removed"
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not fully clear development service-worker caches:",
      error
    );
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
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "CHALIN03_ASSET_MISMATCH") {
      requestAssetRecovery("service-worker-asset-mismatch");
    }
  });

  window.addEventListener("load", () => {
    if (import.meta.env.PROD) {
      const hadActiveController = Boolean(navigator.serviceWorker.controller);
      let reloadingForUpdate = false;

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadActiveController || reloadingForUpdate) {
          return;
        }

        reloadingForUpdate = true;
        window.location.reload();
      });

      navigator.serviceWorker
        .register(`/sw.js?release=${encodeURIComponent(APP_SHELL_RELEASE)}`, {
          scope: "/",
          updateViaCache: "none",
        })
        .then((registration) => {
          registration.waiting?.postMessage({
            type: "CHALIN03_SKIP_WAITING",
          });

          registration.update().catch(() => {
            // The active worker remains available if an update check is offline.
          });

          console.log(
            `✅ Chalin 03 service worker registered (${APP_SHELL_RELEASE})`
          );
        })
        .catch((error) => {
          console.error("❌ Service worker registration failed:", error);
        });

      void clearProductionFrontendCacheOnce();
      return;
    }

    removeDevelopmentServiceWorkerCaches();
  });
}
