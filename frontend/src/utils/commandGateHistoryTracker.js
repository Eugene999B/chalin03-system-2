import { saveLastWork } from "./commandGate";

const EXCLUDED_PATHS = new Set([
  "/login",
  "/owner-recovery",
  "/change-password",
  "/mining/change-password",
  "/equipment-hire-operations/change-password",
]);

const PUBLIC_TOP_LEVEL_PATHS = new Set([
  "about",
  "businesses",
  "projects",
  "equipment",
  "news",
  "leadership",
  "media",
  "careers",
  "locations",
  "contact",
  "faqs",
  "tenders",
  "testimonials",
  "forms",
  "pages",
  "website",
]);

const NON_SPARE_PARTS_PREFIXES = [
  "/login",
  "/owner-recovery",
  "/mining",
  "/mining-operations",
  "/equipment-hire",
  "/equipment-hire-operations",
  "/equipment-installment-finance",
  "/content-studio",
  "/intelligence",
  "/group-executive-control",
];

function readWorkspaceCode() {
  try {
    const user = JSON.parse(localStorage.getItem("chalin03_user") || "null");
    return user?.workspace_code || user?.active_workspace?.code || "spare_parts";
  } catch {
    return "spare_parts";
  }
}

function isPublicPath(pathname) {
  if (pathname === "/") return true;
  const firstSegment = String(pathname || "")
    .replace(/^\/+/, "")
    .split("/")[0];
  return PUBLIC_TOP_LEVEL_PATHS.has(firstSegment);
}

function isSparePartsOperationalPath(pathname) {
  const path = String(pathname || "").split(/[?#]/)[0];
  if (!path || path === "/" || isPublicPath(path)) return false;
  if (path === "/staff" || path.startsWith("/staff/")) return true;
  return !NON_SPARE_PARTS_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function normalizeHistoryDestination(url) {
  if (!localStorage.getItem("chalin03_token")) return url;
  if (readWorkspaceCode() !== "spare_parts") return url;
  if (!isSparePartsOperationalPath(window.location.pathname)) return url;
  if (url === undefined || url === null) return url;

  try {
    const target = new URL(String(url), window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== "/") {
      return url;
    }
    return `/staff${target.search}${target.hash}`;
  } catch {
    return url;
  }
}

function routeClassForPath(pathname) {
  if (!pathname || pathname === "/" || pathname === "/staff") return "dashboard";

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

  window.history.pushState = (state, unused, url) => {
    const result = originalPushState(state, unused, normalizeHistoryDestination(url));
    queueMicrotask(captureCurrentPath);
    return result;
  };

  window.history.replaceState = (state, unused, url) => {
    const result = originalReplaceState(state, unused, normalizeHistoryDestination(url));
    queueMicrotask(captureCurrentPath);
    return result;
  };

  window.addEventListener("popstate", captureCurrentPath);
  window.addEventListener("load", captureCurrentPath, { once: true });
  queueMicrotask(captureCurrentPath);
}
