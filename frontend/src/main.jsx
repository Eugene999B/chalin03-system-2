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
import axiosClient from "./api/axiosClient";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";
import "./styles/mobileExperience.css";
import "./styles/adminMobileHotfix.css";
import "./styles/productionLayoutStability.css";

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v37";
const APP_SHELL_RELEASE = `browser-cache-integrity-v37-${APP_BUILD_ID}`;
const FINANCE_ACCOUNTS_API = "/equipment-catalogue/sales/finance-lifecycle/accounts";
const TERMINAL_FINANCE_SCHEDULE_STATUSES = new Set([
  "paid",
  "cancelled",
  "waived",
  "rescheduled",
]);

function nextDueFromSchedule(schedule) {
  return [...(Array.isArray(schedule) ? schedule : [])]
    .filter((row) => {
      const status = String(row?.schedule_status || "").toLowerCase();
      return Boolean(row?.due_date) && !TERMINAL_FINANCE_SCHEDULE_STATUSES.has(status);
    })
    .sort((left, right) => {
      const dateCompare = String(left.due_date).slice(0, 10).localeCompare(String(right.due_date).slice(0, 10));
      if (dateCompare !== 0) return dateCompare;
      return Number(left.sequence_number || 0) - Number(right.sequence_number || 0);
    })[0]?.due_date || null;
}

let financeAccountsInterceptorInstalled = false;

function installFinanceAccountsScheduleEnrichment() {
  if (financeAccountsInterceptorInstalled || !axiosClient?.interceptors?.response) return;
  financeAccountsInterceptorInstalled = true;
  axiosClient.interceptors.response.use(async (response) => {
    const url = String(response?.config?.url || "").split("?")[0];
    if (url !== FINANCE_ACCOUNTS_API || !Array.isArray(response?.data?.accounts)) {
      return response;
    }

    const accounts = response.data.accounts;
    const missing = accounts.filter(
      (account) =>
        account?.agreement_id &&
        !account?.next_installment_due_date &&
        !account?.next_due_date
    );

    if (!missing.length) return response;

    const enriched = await Promise.allSettled(
      missing.slice(0, 25).map(async (account) => {
        const detailResponse = await axiosClient.get(
          `${FINANCE_ACCOUNTS_API}/${account.agreement_id}`
        );
        return {
          agreementId: String(account.agreement_id),
          nextDue: nextDueFromSchedule(detailResponse.data?.schedule),
        };
      })
    );

    const byAgreement = new Map(
      enriched
        .filter((item) => item.status === "fulfilled" && item.value.nextDue)
        .map((item) => [item.value.agreementId, item.value.nextDue])
    );

    if (!byAgreement.size) return response;

    response.data = {
      ...response.data,
      accounts: accounts.map((account) => {
        const nextDue = byAgreement.get(String(account.agreement_id));
        return nextDue
          ? {
              ...account,
              next_due_date: nextDue,
              next_installment_due_date: nextDue,
            }
          : account;
      }),
    };
    return response;
  });
}

// Dedicated mobile experience release entry point.
installCommandGateHistoryTracker();
installCriticalFinanceWorkspacePreload();
installFinanceAccountsScheduleEnrichment();

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
          .filter((cacheName) =>
            String(cacheName).startsWith("chalin03-")
          )
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

    removeDevelopmentServiceWorkerCaches();
  });
}
