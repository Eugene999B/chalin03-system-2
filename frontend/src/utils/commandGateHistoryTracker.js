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

function routeClassForPath(pathname) {
  if (!pathname || pathname === "/") return "dashboard";

  return pathname
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "dashboard";
}

function updateRoutePresentation() {
  const body = document.body;
  if (!body) return;

  Array.from(body.classList)
    .filter((className) => className.startsWith("chalin-route-"))
    .forEach((className) => body.classList.remove(className));

  const pathname = window.location.pathname || "/";
  const routeClass = `chalin-route-${routeClassForPath(pathname)}`;

  body.classList.add(routeClass);
  body.dataset.chalinRoute = pathname;
  window.dispatchEvent(
    new CustomEvent("chalin:route-change", {
      detail: { pathname, routeClass },
    })
  );
}

function captureCurrentPath() {
  updateRoutePresentation();

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
