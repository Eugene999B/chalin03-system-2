import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";
import AdvancedAccountingExpenseFundingEvidence from "./components/AdvancedAccountingExpenseFundingEvidence.jsx";
import OperationalApprovalLauncher from "./components/OperationalApprovalLauncher.jsx";
import ApprovalCentreLiveAttention from "./components/ApprovalCentreLiveAttention.jsx";
import ProductsPageShellRepair from "./components/ProductsPageShellRepair.jsx";
import ChalinOneGatewayLinks from "./components/ChalinOneGatewayLinks.jsx";
import ChalinOneStandaloneEntry, {
  isChalinOneStandalonePath,
  isPublicWebsitePath,
} from "./chalin-one/ChalinOneStandaloneEntry.jsx";
import { FeatureFlagProvider } from "./context/FeatureFlagContext.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import { installCriticalFinanceWorkspacePreload } from "./utils/criticalFinanceWorkspacePreload.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v35";
const APP_SHELL_RELEASE = `browser-cache-integrity-v35-${APP_BUILD_ID}`;
const publicWebsiteSurface = isPublicWebsitePath(window.location.pathname);
const standaloneChalinOne = isChalinOneStandalonePath(
  window.location.pathname
);
const PUBLIC_APP_HANDOFF_PATHS = new Set([
  "/login",
  "/content-studio",
  "/intelligence",
]);

// Dedicated mobile experience release entry point.
installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FeatureFlagProvider>
      {standaloneChalinOne ? (
        <ChalinOneStandaloneEntry />
      ) : (
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
      )}
    </FeatureFlagProvider>
  </React.StrictMode>
);

window.__chalin03MarkBootHealthy?.(APP_SHELL_RELEASE);

function installPublicApplicationBoundaryHandoffs() {
  if (!publicWebsiteSurface) return;

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button > 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target?.closest?.("a[href]");
      if (!anchor) return;

      let target;
      try {
        target = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }

      if (target.origin !== window.location.origin) return;

      const handoffPath = Array.from(PUBLIC_APP_HANDOFF_PATHS).find(
        (path) =>
          target.pathname === path || target.pathname.startsWith(`${path}/`)
      );
      if (!handoffPath) return;

      // Public CHALIN ONE and the protected staff applications use different
      // router roots. A hard same-origin handoff is intentional here so React's
      // public router cannot swallow /login or protected standalone routes.
      event.preventDefault();
      window.location.assign(
        `${target.pathname}${target.search}${target.hash}`
      );
    },
    true
  );
}

installPublicApplicationBoundaryHandoffs();

async function removeChalinServiceWorkerCaches({ logMessage = "" } = {}) {
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
          .filter((cacheName) =>
            String(cacheName).startsWith("chalin03-")
          )
          .map((cacheName) => caches.delete(cacheName))
      );
    }

    if (logMessage) {
      console.log(logMessage);
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not fully clear CHALIN service-worker caches:",
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
  // The public company website is deliberately outside the aggressive business-
  // app cache-recovery loop. It must never jump, reload, or interrupt a visitor
  // merely because another staging release has been deployed.
  if (!publicWebsiteSurface) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "CHALIN03_ASSET_MISMATCH") {
        requestAssetRecovery("service-worker-asset-mismatch");
      }
    });
  }

  window.addEventListener("load", () => {
    if (import.meta.env.PROD) {
      if (publicWebsiteSurface) {
        removeChalinServiceWorkerCaches({
          logMessage:
            "✅ CHALIN ONE public website is running without automatic service-worker refreshes",
        });
        return;
      }

      const hadActiveController = Boolean(navigator.serviceWorker.controller);
      let reloadingForUpdate = false;

      // Operational workspaces retain their one-time handover reload because
      // stale cashier/finance/operations code is materially riskier than a
      // public website interruption.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadActiveController || reloadingForUpdate) {
          return;
        }

        reloadingForUpdate = true;
        window.location.reload();
      });

      navigator.serviceWorker
        .register(
          `/sw.js?release=${encodeURIComponent(APP_SHELL_RELEASE)}`,
          {
            scope: "/",
            updateViaCache: "none",
          }
        )
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

      return;
    }

    removeChalinServiceWorkerCaches({
      logMessage:
        "✅ Development service workers and old local caches were removed",
    });
  });
}
