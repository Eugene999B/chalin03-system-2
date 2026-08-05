(() => {
  const STATE_KEY = "chalin03:asset-recovery-state:v34";
  const WINDOW_MS = 2 * 60 * 1000;
  const MAX_ATTEMPTS = 8;
  let recoveryStarted = false;

  function readState() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
      if (
        parsed &&
        Date.now() - Number(parsed.startedAt || 0) < WINDOW_MS
      ) {
        return {
          startedAt: Number(parsed.startedAt),
          attempts: Number(parsed.attempts || 0),
        };
      }
    } catch {
      // Restricted browser storage must not block recovery.
    }

    return { startedAt: Date.now(), attempts: 0 };
  }

  function writeState(state) {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // Recovery continues without session storage.
    }
  }

  function clearState() {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      // Nothing else is required.
    }

    document.getElementById("chalin03-update-recovery")?.remove();
  }

  function recoveryUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("__chalin03_recovery", String(Date.now()));
    return url.toString();
  }

  function showStatus(message, allowRetry = false) {
    let panel = document.getElementById("chalin03-update-recovery");

    if (!panel) {
      panel = document.createElement("main");
      panel.id = "chalin03-update-recovery";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "assertive");
      panel.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:grid;" +
        "place-items:center;padding:24px;box-sizing:border-box;" +
        "background:#f5f7fb;color:#10213b;font-family:Arial,sans-serif;" +
        "text-align:center;";
      document.body.appendChild(panel);
    }

    panel.innerHTML =
      '<section style="max-width:560px;background:#fff;border:1px solid #dbe3ef;' +
      'border-radius:20px;padding:30px;box-shadow:0 18px 50px rgba(16,33,59,.14)">' +
      '<h1 style="margin:0 0 12px;font-size:1.55rem">Updating Chalin 03</h1>' +
      '<p style="margin:0;line-height:1.6;color:#526178">' +
      message +
      "</p>" +
      (allowRetry
        ? '<button id="chalin03-update-retry" type="button" style="margin-top:18px;' +
          'border:0;border-radius:10px;padding:11px 18px;background:#07182c;color:#fff;' +
          'font:inherit;font-weight:700;cursor:pointer">Retry now</button>'
        : "") +
      "</section>";

    document
      .getElementById("chalin03-update-retry")
      ?.addEventListener("click", () => {
        clearState();
        window.location.replace(recoveryUrl());
      });
  }

  async function clearRuntimeCaches() {
    const tasks = [];

    if ("serviceWorker" in navigator) {
      tasks.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations.map((registration) =>
                registration.unregister()
              )
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
    if (recoveryStarted) return;
    recoveryStarted = true;

    const state = readState();
    state.attempts += 1;
    writeState(state);

    if (state.attempts > MAX_ATTEMPTS) {
      showStatus(
        "The latest files are still being published. Your business records are safe. Select Retry now after a moment.",
        true
      );
      recoveryStarted = false;
      return;
    }

    showStatus(
      `A retired browser file was detected (${reason}). Clearing it and loading the current release automatically.`
    );

    await clearRuntimeCaches();

    window.setTimeout(() => {
      window.location.replace(recoveryUrl());
    }, Math.min(750 * state.attempts, 4500));
  }

  window.__chalin03RecoverFromAssetMismatch = recover;
  window.__chalin03MarkBootHealthy = clearState;

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
