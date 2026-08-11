(() => {
  const PANEL_ID = "chalin03-update-recovery";
  const RECOVERY_PARAM = "__chalin03_recovery";
  const RETURN_PARAM = "__chalin03_return";
  const RECOVERY_MARKERS = Object.freeze([
    RECOVERY_PARAM,
    RETURN_PARAM,
    "__chalin03_sw_recovery",
    "__chalin03_sw_release",
  ]);
  let recoveryStarted = false;

  function removeRecoveryMarkers(url) {
    RECOVERY_MARKERS.forEach((name) => url.searchParams.delete(name));
    return url;
  }

  function routeText(url) {
    return `${url.pathname}${url.search}${url.hash}` || "/";
  }

  function restoreRequestedRouteFromStatic404() {
    const current = new URL(window.location.href);
    const returnValue = current.searchParams.get(RETURN_PARAM);

    if (!returnValue) return false;

    const cleanedCurrent = removeRecoveryMarkers(new URL(current.href));
    const rawReturnValue = String(returnValue).trim();
    let target = null;

    try {
      target = new URL(rawReturnValue, window.location.origin);
    } catch {
      target = null;
    }

    const safeRelativeTarget =
      rawReturnValue.startsWith("/") &&
      !rawReturnValue.startsWith("//") &&
      target?.origin === window.location.origin;

    if (!safeRelativeTarget) {
      window.history.replaceState(
        window.history.state,
        "",
        routeText(cleanedCurrent)
      );
      return false;
    }

    removeRecoveryMarkers(target);
    window.history.replaceState(window.history.state, "", routeText(target));
    return true;
  }

  // 404.html cannot serve a deep SPA route directly on every host. It records
  // the intended route in __chalin03_return and loads /. Restore that route
  // synchronously here, before the module entry chooses the public, protected,
  // or operational React application shell. This changes browser history only;
  // it never reloads or interrupts an already-running workspace.
  restoreRequestedRouteFromStatic404();

  function showUpdateAvailable(reason = "new-release") {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:2147483647;" +
      "width:min(390px,calc(100vw - 36px));box-sizing:border-box;" +
      "background:#07182c;color:#fff;border:1px solid rgba(255,255,255,.16);" +
      "border-radius:16px;padding:16px 18px;box-shadow:0 18px 48px rgba(7,24,44,.28);" +
      "font-family:Inter,Arial,sans-serif;line-height:1.45;";

    const heading = document.createElement("strong");
    heading.textContent = "CHALIN update available";
    heading.style.cssText = "display:block;font-size:15px;margin-bottom:6px";

    const copy = document.createElement("span");
    copy.textContent =
      "A newer application file is available. CHALIN will not refresh or interrupt your work automatically. Reload only when you are ready.";
    copy.style.cssText = "display:block;font-size:13px;color:#d9e3ef";

    const detail = document.createElement("small");
    detail.textContent = `Detected: ${String(reason || "update")}`;
    detail.style.cssText = "display:block;margin-top:7px;color:#9fb1c7";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap";

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload when ready";
    reload.style.cssText =
      "border:0;border-radius:9px;padding:9px 12px;background:#fff;color:#07182c;" +
      "font:inherit;font-size:13px;font-weight:800;cursor:pointer";
    reload.addEventListener("click", () => {
      window.location.reload();
    });

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Keep working";
    dismiss.style.cssText =
      "border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:9px 12px;" +
      "background:transparent;color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer";
    dismiss.addEventListener("click", () => panel.remove());

    actions.append(reload, dismiss);
    panel.append(heading, copy, detail, actions);
    document.body.appendChild(panel);
    return panel;
  }

  async function clearRuntimeCaches() {
    const tasks = [];

    if ("serviceWorker" in navigator) {
      tasks.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations.map((registration) => registration.unregister())
            )
          )
          .catch(() => undefined)
      );
    }

    if ("caches" in window) {
      tasks.push(
        caches
          .keys()
          .then((names) =>
            Promise.all(
              names
                .filter((name) => String(name).startsWith("chalin03-"))
                .map((name) => caches.delete(name))
            )
          )
          .catch(() => undefined)
      );
    }

    await Promise.allSettled(tasks);
  }

  function isBuildAssetUrl(value) {
    if (!value) return false;

    try {
      const url = new URL(String(value), window.location.origin);
      return (
        url.origin === window.location.origin &&
        (url.pathname.startsWith("/assets/") ||
          /\.(?:js|mjs|css|wasm)$/i.test(url.pathname))
      );
    } catch {
      return false;
    }
  }

  async function recover(reason = "asset-mismatch") {
    if (recoveryStarted) {
      showUpdateAvailable(reason);
      return;
    }

    recoveryStarted = true;
    await clearRuntimeCaches();
    showUpdateAvailable(reason);
    recoveryStarted = false;
  }

  window.__chalin03RecoverFromAssetMismatch = recover;
  window.__chalin03MarkBootHealthy = () => {
    // A healthy boot never forces navigation. Existing manual update notices
    // may remain until the user dismisses them or chooses to reload.
  };

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      const resourceUrl =
        target && typeof target === "object"
          ? target.src || target.href
          : "";

      if (isBuildAssetUrl(resourceUrl)) {
        event.preventDefault?.();
        recover("retired-build-asset");
      }
    },
    true
  );

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recover("vite-preload-error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = String(event.reason?.message || event.reason || "");

    if (
      /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|MIME type/i.test(
        message
      )
    ) {
      event.preventDefault();
      recover("dynamic-import-error");
    }
  });
})();
