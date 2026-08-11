import React from "react";
import ReactDOM from "react-dom/client";
import { initializeAppearance } from "./appearance/appearanceTheme.js";
import {
  isChalinOneStandalonePath,
  isPublicWebsitePath,
} from "./chalin-one/chalinOnePathModel.js";

initializeAppearance();

const APP_BUILD_ID =
  import.meta.env.VITE_CHALIN03_BUILD_ID || "browser-cache-integrity-v36";
const APP_SHELL_RELEASE = `browser-cache-integrity-v36-${APP_BUILD_ID}`;
const publicWebsiteSurface = isPublicWebsitePath(window.location.pathname);
const standaloneChalinOne = isChalinOneStandalonePath(
  window.location.pathname
);
const PUBLIC_APP_HANDOFF_PATHS = new Set([
  "/login",
  "/staff",
  "/content-studio",
  "/intelligence",
]);

function publicApplicationHandoffUrl(target) {
  const pathname = target.pathname === "/login" ? "/staff" : target.pathname;
  return `${pathname}${target.search}${target.hash}`;
}

async function loadApplicationRoot() {
  if (publicWebsiteSurface) {
    return import("./chalin-one/PublicChalinOneEntry.jsx");
  }

  if (standaloneChalinOne) {
    return import("./chalin-one/ProtectedChalinOneEntry.jsx");
  }

  return import("./OperationalAppRoot.jsx");
}

const root = ReactDOM.createRoot(document.getElementById("root"));

loadApplicationRoot()
  .then(({ default: ApplicationRoot }) => {
    root.render(
      <React.StrictMode>
        <ApplicationRoot />
      </React.StrictMode>
    );
    window.__chalin03MarkBootHealthy?.(APP_SHELL_RELEASE);
  })
  .catch((error) => {
    console.error("CHALIN application root failed to load:", error);
    root.render(
      <main
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          background: "#07131f",
          color: "#ffffff",
          fontFamily: "Inter, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <strong>CHALIN 03 could not open this application surface.</strong>
          <p>
            Your open session will not refresh itself. Reload manually when you
            are ready, or use the normal support channel if the problem continues.
          </p>
        </div>
      </main>
    );
  });

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

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      window.location.href = publicApplicationHandoffUrl(target);
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

function installNoAutomaticRefreshPolicy() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    removeChalinServiceWorkerCaches({
      logMessage:
        "✅ CHALIN automatic service-worker refreshes are disabled system-wide",
    });
  });
}

installNoAutomaticRefreshPolicy();
