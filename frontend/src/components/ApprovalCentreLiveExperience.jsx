import { useEffect } from "react";

import axiosClient from "../api/axiosClient";

const USER_KEY = "chalin03_user";
const TOKEN_KEY = "chalin03_token";
const REFRESH_INTERVAL_MS = 10000;
const ACTIONABLE_STATUSES = new Set(["pending", "failed"]);

function parseStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function isApprovalCentreAvailable() {
  const user = parseStoredUser();
  const token = localStorage.getItem(TOKEN_KEY);
  const role = String(user?.role || "").toLowerCase();
  const workspaceCode = String(
    user?.workspace_code || user?.active_workspace?.code || "spare_parts"
  ).toLowerCase();

  return Boolean(
    token &&
      ["admin", "manager"].includes(role) &&
      workspaceCode === "spare_parts" &&
      !window.location.pathname.startsWith("/login")
  );
}

function actionableRequestCount(requests) {
  return (requests || []).filter((request) =>
    ACTIONABLE_STATUSES.has(String(request?.execution_status || "").toLowerCase())
  ).length;
}

function displayCount(value) {
  const count = Math.max(0, Number(value || 0));
  return count > 99 ? "99+" : String(count);
}

function updateLauncher(count) {
  const launcher = document.querySelector(".approval-launcher-button");
  if (!launcher) return false;

  const safeCount = Math.max(0, Number(count || 0));
  const hasPending = safeCount > 0;

  launcher.dataset.approvalEnhanced = "true";
  launcher.dataset.approvalPending = hasPending ? "true" : "false";
  launcher.dataset.approvalCount = displayCount(safeCount);
  launcher.setAttribute(
    "aria-label",
    hasPending
      ? `Approval Centre. ${safeCount} request${safeCount === 1 ? "" : "s"} need attention.`
      : "Approval Centre. No requests need attention."
  );
  launcher.title = hasPending
    ? `${safeCount} approval request${safeCount === 1 ? "" : "s"} need attention`
    : "Open protected admin approvals";

  return true;
}

function syncOpenState() {
  const centreIsOpen = Boolean(document.querySelector(".approval-overlay"));
  document.documentElement.classList.toggle(
    "approval-centre-mobile-open",
    centreIsOpen
  );
  document.body.classList.toggle("approval-centre-mobile-open", centreIsOpen);
}

export default function ApprovalCentreLiveExperience() {
  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;
    let latestCount = 0;

    async function refreshApprovalCount() {
      if (disposed || requestInFlight || !isApprovalCentreAvailable()) {
        return;
      }

      requestInFlight = true;

      try {
        const response = await axiosClient.get(
          "/audit-unlock-requests/operational"
        );

        latestCount = actionableRequestCount(response.data.requests);
        updateLauncher(latestCount);
      } catch {
        // Keep the last known badge instead of flashing an incorrect zero during
        // a temporary connection failure. The original centre remains usable.
      } finally {
        requestInFlight = false;
      }
    }

    function syncLauncherAndOpenState() {
      const launcher = document.querySelector(".approval-launcher-button");

      if (launcher && launcher.dataset.approvalEnhanced !== "true") {
        const originalBadge = launcher.querySelector(
          ".approval-launcher-count"
        );
        const originalCount = Number(originalBadge?.textContent || 0);

        if (Number.isFinite(originalCount) && originalCount > latestCount) {
          latestCount = originalCount;
        }
      }

      updateLauncher(latestCount);
      syncOpenState();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshApprovalCount();
      }
    }

    const observer = new MutationObserver(syncLauncherAndOpenState);
    observer.observe(document.body, { childList: true, subtree: true });

    const interval = window.setInterval(
      refreshApprovalCount,
      REFRESH_INTERVAL_MS
    );

    window.addEventListener("focus", refreshApprovalCount);
    window.addEventListener("online", refreshApprovalCount);
    window.addEventListener(
      "chalin03:approval-request-updated",
      refreshApprovalCount
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);

    syncLauncherAndOpenState();
    refreshApprovalCount();

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshApprovalCount);
      window.removeEventListener("online", refreshApprovalCount);
      window.removeEventListener(
        "chalin03:approval-request-updated",
        refreshApprovalCount
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.documentElement.classList.remove("approval-centre-mobile-open");
      document.body.classList.remove("approval-centre-mobile-open");
    };
  }, []);

  return (
    <style>{`
      .approval-launcher-button {
        isolation: isolate;
        overflow: visible !important;
      }

      .approval-launcher-button[data-approval-enhanced="true"] .approval-launcher-count {
        display: none !important;
      }

      .approval-launcher-button[data-approval-pending="true"]::after {
        content: attr(data-approval-count);
        position: absolute;
        top: -9px;
        right: -7px;
        min-width: 25px;
        height: 25px;
        padding: 0 6px;
        border: 3px solid #ffffff;
        border-radius: 999px;
        background: #b91c1c;
        color: #ffffff;
        display: grid;
        place-items: center;
        font-size: 12px;
        line-height: 1;
        font-weight: 950;
        box-sizing: border-box;
        z-index: 2;
        box-shadow: 0 6px 16px rgba(127, 29, 29, .40);
        animation: approval-count-pulse 1.1s ease-in-out infinite;
      }

      .approval-launcher-button[data-approval-pending="true"] {
        animation: approval-centre-blink 1.1s ease-in-out infinite;
      }

      @keyframes approval-centre-blink {
        0%, 100% {
          opacity: 1;
          filter: brightness(1);
          box-shadow: 0 18px 48px rgba(7, 24, 44, .30),
            0 0 0 0 rgba(217, 169, 14, .55);
        }
        50% {
          opacity: .72;
          filter: brightness(1.18);
          box-shadow: 0 18px 48px rgba(7, 24, 44, .30),
            0 0 0 10px rgba(217, 169, 14, 0);
        }
      }

      @keyframes approval-count-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.13); }
      }

      html.approval-centre-mobile-open,
      body.approval-centre-mobile-open {
        overflow: hidden !important;
        overscroll-behavior: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .approval-launcher-button[data-approval-pending="true"],
        .approval-launcher-button[data-approval-pending="true"]::after {
          animation: none !important;
        }
      }

      @media (max-width: 720px) {
        .approval-launcher-button {
          right: 12px !important;
          bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
          min-height: 50px;
          max-width: calc(100vw - 24px);
          padding: 11px 17px !important;
          justify-content: center;
          font-size: 14px;
          line-height: 1.2;
          box-shadow: 0 12px 30px rgba(7, 24, 44, .30) !important;
        }

        .approval-overlay {
          padding: 0 !important;
          display: flex !important;
          align-items: stretch !important;
          justify-content: stretch !important;
          overscroll-behavior: contain;
        }

        .approval-modal {
          width: 100% !important;
          height: 100dvh !important;
          max-height: 100dvh !important;
          border-radius: 0 !important;
          grid-template-rows: auto auto minmax(0, 1fr) !important;
        }

        .approval-header {
          padding: calc(11px + env(safe-area-inset-top, 0px)) 12px 11px !important;
          gap: 9px !important;
          align-items: center !important;
        }

        .approval-header > div {
          min-width: 0;
        }

        .approval-header h2 {
          margin-top: 2px !important;
          font-size: 20px !important;
          line-height: 1.15;
        }

        .approval-header p {
          margin-top: 4px !important;
          font-size: 12px;
          line-height: 1.35;
        }

        .approval-close {
          flex: 0 0 auto;
          min-height: 44px;
          padding: 8px 10px !important;
          white-space: nowrap;
        }

        .approval-tabs {
          padding: 8px 10px !important;
          display: grid !important;
          grid-template-columns: 1fr !important;
          gap: 7px !important;
        }

        .approval-tabs button {
          width: 100%;
          min-height: 44px;
          border-radius: 12px !important;
          padding: 9px 11px !important;
          white-space: normal;
          text-align: center;
        }

        .approval-body {
          min-height: 0;
          padding: 10px 10px calc(24px + env(safe-area-inset-bottom, 0px)) !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        .approval-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
        }

        .approval-summary-card {
          min-width: 0;
          padding: 10px !important;
          border-radius: 13px !important;
        }

        .approval-summary-card strong {
          font-size: 18px !important;
        }

        .approval-card {
          padding: 12px !important;
          border-radius: 14px !important;
        }

        .approval-card-top {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 8px !important;
        }

        .approval-card h3 {
          font-size: 16px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .approval-meta {
          line-height: 1.45;
        }

        .approval-status {
          justify-self: start;
        }

        .approval-actions {
          display: grid !important;
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }

        .approval-actions button,
        .approval-primary,
        .approval-secondary,
        .approval-danger {
          width: 100%;
          min-height: 46px;
        }

        .approval-form-card {
          padding: 12px !important;
          border-radius: 14px !important;
        }

        .approval-grid,
        .approval-item {
          grid-template-columns: 1fr !important;
        }

        .approval-form-card input,
        .approval-form-card select,
        .approval-form-card textarea,
        .approval-review-modal input,
        .approval-review-modal textarea {
          min-height: 46px;
          font-size: 16px !important;
          box-sizing: border-box;
        }

        .approval-review-overlay {
          padding: 0 !important;
          align-items: end !important;
        }

        .approval-review-modal {
          width: 100% !important;
          max-height: 94dvh !important;
          padding: 16px 14px calc(18px + env(safe-area-inset-bottom, 0px)) !important;
          border-radius: 22px 22px 0 0 !important;
          -webkit-overflow-scrolling: touch;
        }
      }

      @media (max-width: 380px) {
        .approval-header p {
          display: none;
        }

        .approval-close {
          font-size: 12px;
        }
      }
    `}</style>
  );
}
