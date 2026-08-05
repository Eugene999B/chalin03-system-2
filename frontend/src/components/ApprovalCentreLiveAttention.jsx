import { useEffect } from "react";

import axiosClient from "../api/axiosClient";

const USER_KEY = "chalin03_user";
const TOKEN_KEY = "chalin03_token";
const POLL_INTERVAL_MS = 12000;
const NEW_ARRIVAL_ANIMATION_MS = 5200;

function parseStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function canWatchApprovals() {
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

function needsAttention(request) {
  const executionStatus = String(request?.execution_status || "").toLowerCase();
  const requestStatus = String(request?.status || "").toLowerCase();

  return (
    executionStatus === "pending" ||
    executionStatus === "failed" ||
    (requestStatus === "pending" && !["executed", "rejected"].includes(executionStatus))
  );
}

function pendingRequestCount(payload) {
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const listCount = requests.filter(needsAttention).length;
  const summaryCount =
    Math.max(Number(payload?.summary?.pending || 0), 0) +
    Math.max(Number(payload?.summary?.failed || 0), 0);

  return Math.max(listCount, summaryCount);
}

function displayCount(count) {
  return count > 99 ? "99+" : String(count);
}

function ensureLiveBadge(button) {
  let badge = button.querySelector(".approval-launcher-count");

  if (!badge) {
    badge = document.createElement("span");
    badge.className = "approval-launcher-count approval-live-count";
    button.appendChild(badge);
  }

  badge.classList.add("approval-live-count");
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  badge.setAttribute("aria-atomic", "true");

  return badge;
}

export default function ApprovalCentreLiveAttention() {
  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;
    let currentCount = 0;
    let arrivalTimer = null;

    function applyLauncherState(count, announceArrival = false) {
      const button = document.querySelector(".approval-launcher-button");
      if (!button) return;

      const safeCount = Math.max(Number(count || 0), 0);
      const badge = ensureLiveBadge(button);
      const nextBadgeText = safeCount > 0 ? displayCount(safeCount) : "";
      const shouldHideBadge = safeCount === 0;

      button.classList.toggle("approval-launcher-has-attention", safeCount > 0);
      button.dataset.pendingApprovalCount = String(safeCount);
      button.setAttribute(
        "aria-label",
        safeCount > 0
          ? `Open Approval Centre. ${safeCount} request${safeCount === 1 ? "" : "s"} need attention.`
          : "Open Approval Centre. No requests are waiting."
      );

      if (badge.hidden !== shouldHideBadge) {
        badge.hidden = shouldHideBadge;
      }
      if (badge.textContent !== nextBadgeText) {
        badge.textContent = nextBadgeText;
      }
      badge.setAttribute(
        "aria-label",
        safeCount > 0
          ? `${safeCount} approval request${safeCount === 1 ? "" : "s"} waiting`
          : "No approval requests waiting"
      );

      if (announceArrival && safeCount > 0) {
        button.classList.remove("approval-launcher-new-arrival");
        void button.offsetWidth;
        button.classList.add("approval-launcher-new-arrival");

        if (arrivalTimer) window.clearTimeout(arrivalTimer);
        arrivalTimer = window.setTimeout(() => {
          button.classList.remove("approval-launcher-new-arrival");
          arrivalTimer = null;
        }, NEW_ARRIVAL_ANIMATION_MS);
      }
    }

    async function refreshAttention({ announce = true } = {}) {
      if (disposed || requestInFlight) return;

      if (!canWatchApprovals()) {
        currentCount = 0;
        applyLauncherState(0);
        return;
      }

      requestInFlight = true;
      try {
        const response = await axiosClient.get(
          "/audit-unlock-requests/operational"
        );
        const nextCount = pendingRequestCount(response.data);
        const increased = nextCount > currentCount;

        currentCount = nextCount;
        applyLauncherState(nextCount, announce && increased);
      } catch {
        // Keep the last reliable badge state when a silent background refresh fails.
      } finally {
        requestInFlight = false;
      }
    }

    function syncCurrentState() {
      applyLauncherState(currentCount);
    }

    function handleVisibilityChange() {
      if (!document.hidden) refreshAttention();
    }

    const observer = new MutationObserver(syncCurrentState);
    observer.observe(document.body, { childList: true, subtree: true });

    refreshAttention({ announce: false });
    const interval = window.setInterval(refreshAttention, POLL_INTERVAL_MS);

    window.addEventListener("focus", refreshAttention);
    window.addEventListener("storage", refreshAttention);
    window.addEventListener("popstate", refreshAttention);
    window.addEventListener("chalin03:approval-request-changed", refreshAttention);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(interval);
      if (arrivalTimer) window.clearTimeout(arrivalTimer);
      window.removeEventListener("focus", refreshAttention);
      window.removeEventListener("storage", refreshAttention);
      window.removeEventListener("popstate", refreshAttention);
      window.removeEventListener(
        "chalin03:approval-request-changed",
        refreshAttention
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <style>{`
      .approval-launcher-button {
        isolation: isolate;
        min-height: 50px;
        max-width: calc(100vw - 28px);
        transition: transform .2s ease, box-shadow .2s ease, filter .2s ease;
      }

      .approval-launcher-button:hover {
        transform: translateY(-2px);
      }

      .approval-launcher-count {
        position: absolute;
        top: -8px;
        right: -7px;
        min-width: 27px !important;
        height: 27px !important;
        padding: 0 6px;
        border: 3px solid #fff7d1;
        box-shadow: 0 7px 18px rgba(127, 29, 29, .34);
        font-size: 12px !important;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        z-index: 2;
      }

      .approval-launcher-count[hidden] {
        display: none !important;
      }

      .approval-launcher-has-attention {
        animation: approvalLauncherAttention 1.55s ease-in-out infinite;
      }

      .approval-launcher-new-arrival {
        animation: approvalLauncherArrival .72s ease-in-out 7 !important;
      }

      @keyframes approvalLauncherAttention {
        0%, 100% {
          box-shadow: 0 18px 48px rgba(7, 24, 44, .30), 0 0 0 0 rgba(185, 28, 28, 0);
          filter: brightness(1);
        }
        50% {
          box-shadow: 0 18px 48px rgba(7, 24, 44, .34), 0 0 0 8px rgba(185, 28, 28, .20);
          filter: brightness(1.08);
        }
      }

      @keyframes approvalLauncherArrival {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-3px) scale(1.045); }
      }

      @media (prefers-reduced-motion: reduce) {
        .approval-launcher-has-attention,
        .approval-launcher-new-arrival {
          animation: none !important;
          outline: 4px solid rgba(185, 28, 28, .28);
          outline-offset: 3px;
        }
      }

      @media (max-width: 900px) {
        .approval-overlay {
          padding: 10px !important;
        }

        .approval-modal {
          width: 100% !important;
          max-height: calc(100dvh - 20px) !important;
        }

        .approval-header {
          gap: 10px !important;
        }

        .approval-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      }

      @media (max-width: 720px) {
        .approval-launcher-button {
          right: max(12px, env(safe-area-inset-right)) !important;
          bottom: max(12px, calc(env(safe-area-inset-bottom) + 12px)) !important;
          min-height: 48px;
          padding: 10px 14px !important;
          gap: 7px !important;
          font-size: 14px;
          box-shadow: 0 14px 36px rgba(7, 24, 44, .34);
        }

        .approval-launcher-count {
          top: -7px;
          right: -5px;
        }

        .approval-overlay {
          padding: max(8px, env(safe-area-inset-top)) 0 0 !important;
          place-items: end stretch !important;
          overflow: hidden;
        }

        .approval-modal {
          width: 100% !important;
          height: min(94dvh, 900px);
          max-height: calc(100dvh - max(8px, env(safe-area-inset-top))) !important;
          border-radius: 24px 24px 0 0 !important;
          grid-template-rows: auto auto minmax(0, 1fr) !important;
          overscroll-behavior: contain;
        }

        .approval-header {
          padding: 14px 14px 13px !important;
          align-items: flex-start !important;
        }

        .approval-header h2 {
          margin-top: 3px !important;
          font-size: 20px !important;
          line-height: 1.2;
        }

        .approval-header p {
          margin-top: 5px !important;
          font-size: 13px;
          line-height: 1.35;
        }

        .approval-close {
          min-width: 74px;
          min-height: 42px;
          padding: 8px 10px !important;
          flex: 0 0 auto;
        }

        .approval-tabs {
          display: grid !important;
          grid-template-columns: minmax(0, .82fr) minmax(0, 1.18fr);
          gap: 7px !important;
          padding: 9px 10px !important;
          flex-wrap: nowrap !important;
        }

        .approval-tabs button {
          min-width: 0;
          min-height: 44px;
          padding: 8px 9px !important;
          border-radius: 12px !important;
          font-size: 12px;
          line-height: 1.2;
          white-space: normal;
        }

        .approval-body {
          padding: 11px 10px calc(18px + env(safe-area-inset-bottom)) !important;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }

        .approval-summary-grid {
          gap: 8px !important;
          margin-bottom: 10px !important;
        }

        .approval-summary-card {
          min-width: 0;
          padding: 10px !important;
          border-radius: 13px !important;
        }

        .approval-summary-card strong {
          margin-top: 3px !important;
          font-size: 18px !important;
        }

        .approval-card {
          padding: 12px !important;
          border-radius: 15px !important;
        }

        .approval-card-top {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 8px !important;
        }

        .approval-status {
          justify-self: start;
        }

        .approval-actions {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
        }

        .approval-actions button,
        .approval-primary,
        .approval-secondary,
        .approval-danger {
          width: 100%;
          min-height: 44px;
          padding: 10px 11px !important;
        }

        .approval-form-card {
          padding: 12px !important;
          border-radius: 15px !important;
        }

        .approval-grid {
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 10px !important;
        }

        .approval-form-card input,
        .approval-form-card select,
        .approval-form-card textarea {
          min-height: 44px;
          padding: 10px 11px !important;
          font-size: 16px !important;
        }

        .approval-form-card textarea {
          min-height: 100px;
        }

        .approval-item {
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 8px !important;
          padding: 10px !important;
        }

        .approval-review-overlay {
          padding: max(8px, env(safe-area-inset-top)) 0 0 !important;
          place-items: end stretch !important;
        }

        .approval-review-modal {
          width: 100% !important;
          max-height: calc(94dvh - env(safe-area-inset-top)) !important;
          border-radius: 22px 22px 0 0 !important;
          padding: 16px 14px calc(18px + env(safe-area-inset-bottom)) !important;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
      }

      @media (max-width: 420px) {
        .approval-launcher-button {
          max-width: calc(100vw - 24px);
          font-size: 13px;
        }

        .approval-header p {
          display: none;
        }

        .approval-close {
          min-width: 62px;
          font-size: 12px;
        }

        .approval-actions {
          grid-template-columns: minmax(0, 1fr) !important;
        }
      }
    `}</style>
  );
}
