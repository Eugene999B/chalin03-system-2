import { saveLastWork } from "./commandGate";

const EXCLUDED_PATHS = new Set([
  "/login",
  "/owner-recovery",
  "/change-password",
  "/mining/change-password",
  "/equipment-hire-operations/change-password",
]);

function readWorkspaceCode() {
  try {
    const user = JSON.parse(localStorage.getItem("chalin03_user") || "null");
    return user?.workspace_code || user?.active_workspace?.code || "spare_parts";
  } catch {
    return "spare_parts";
  }
}

function captureCurrentPath() {
  if (!localStorage.getItem("chalin03_token")) return;

  const pathname = window.location.pathname;
  if (EXCLUDED_PATHS.has(pathname)) return;

  saveLastWork(readWorkspaceCode(), pathname);
}

export function installCommandGateHistoryTracker() {
  if (window.__chalinCommandGateHistoryInstalled) return;
  window.__chalinCommandGateHistoryInstalled = true;

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = (...args) => {
    const result = originalPushState(...args);
    queueMicrotask(captureCurrentPath);
    return result;
  };

  window.history.replaceState = (...args) => {
    const result = originalReplaceState(...args);
    queueMicrotask(captureCurrentPath);
    return result;
  };

  window.addEventListener("popstate", captureCurrentPath);
  window.addEventListener("load", captureCurrentPath, { once: true });
  queueMicrotask(captureCurrentPath);
}
