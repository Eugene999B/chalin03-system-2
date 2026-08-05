import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";
import AdvancedAccountingExpenseFundingEvidence from "./components/AdvancedAccountingExpenseFundingEvidence.jsx";
import OperationalApprovalLauncher from "./components/OperationalApprovalLauncher.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import { installCriticalFinanceWorkspacePreload } from "./utils/criticalFinanceWorkspacePreload.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";

const APP_SHELL_RELEASE = "finance-outer-workspace-unlock-v33";

// Dedicated mobile experience release entry point.
installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <OperationalApprovalLauncher />
    <AdvancedAccountingExpenseFundingEvidence />
    <EmergencyCommandOverlay />
    <CommandArrivalBanner />
  </React.StrictMode>
);

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
        cacheNames.map((cacheName) => caches.delete(cacheName))
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

if ("serviceWorker" in navigator) {
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
        .register(`/sw.js?release=${APP_SHELL_RELEASE}`, {
          scope: "/",
          updateViaCache: "none",
        })
        .then((registration) => {
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

      return;
    }

    removeDevelopmentServiceWorkerCaches();
  });
}
