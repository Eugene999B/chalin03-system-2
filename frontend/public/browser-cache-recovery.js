(() => {
  const STATE_KEY = "chalin03:asset-recovery-state:v35";
  const RECOVERY_PARAM = "__chalin03_recovery";
  const RETURN_PARAM = "__chalin03_return";
  const INTERNAL_PARAMS = [
    RECOVERY_PARAM,
    RETURN_PARAM,
    "__chalin03_sw_recovery",
    "__chalin03_sw_release",
  ];
  const WINDOW_MS = 2 * 60 * 1000;
  const MAX_ATTEMPTS = 5;
  let recoveryStarted = false;

  function removeInternalParams(url) {
    INTERNAL_PARAMS.forEach((name) => url.searchParams.delete(name));
    return url;
  }

  function safeReturnTarget(value) {
    if (!value) return "/";

    try {
      const url = removeInternalParams(
        new URL(String(value), window.location.origin)
      );
      if (url.origin !== window.location.origin) return "/";
      if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
        return "/";
      }
      if (
        url.pathname.startsWith("/assets/") ||
        /\.(?:js|mjs|css|wasm)$/i.test(url.pathname)
      ) {
        return "/";
      }
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      return "/";
    }
  }

  function requestedReturnTarget() {
    const current = new URL(window.location.href);
    const supplied = current.searchParams.get(RETURN_PARAM);
    if (supplied) return safeReturnTarget(supplied);
    return safeReturnTarget(
      `${current.pathname}${current.search}${current.hash}`
    );
  }

  function restoreReturnTarget() {
    const current = new URL(window.location.href);
    const supplied = current.searchParams.get(RETURN_PARAM);
    if (!supplied) return;

    const target = safeReturnTarget(supplied);
    window.history.replaceState(window.history.state, "", target);
  }

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
    const url = new URL("/", window.location.origin);
    url.searchParams.set(RECOVERY_PARAM, String(Date.now()));
    url.searchParams.set(RETURN_PARAM, requestedReturnTarget());
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

    panel.replaceChildren();
    const section = document.createElement("section");
    section.style.cssText =
      "max-width:560px;background:#fff;border:1px solid #dbe3ef;" +
      "border-radius:20px;padding:30px;box-shadow:0 18px 50px rgba(16,33,59,.14)";

    const heading = document.createElement("h1");
    heading.style.cssText = "margin:0 0 12px;font-size:1.55rem";
    heading.textContent = "Updating Chalin 03";

    const paragraph = document.createElement("p");
    paragraph.style.cssText = "margin:0;line-height:1.6;color:#526178";
    paragraph.textContent = message;

    section.append(heading, paragraph);

    if (allowRetry) {
      const button = document.createElement("button");
      button.id = "chalin03-update-retry";
      button.type = "button";
      button.style.cssText =
        "margin-top:18px;border:0;border-radius:10px;padding:11px 18px;" +
        "background:#07182c;color:#fff;font:inherit;font-weight:700;cursor:pointer";
      button.textContent = "Retry now";
      button.addEventListener("click", () => {
        clearState();
        window.location.replace(recoveryUrl());
      });
      section.appendChild(button);
    }

    panel.appendChild(section);
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
      `A retired browser file was detected (${reason}). Loading the current release automatically without losing your page.`
    );

    await clearRuntimeCaches();

    window.setTimeout(() => {
      window.location.replace(recoveryUrl());
    }, Math.min(600 * state.attempts, 3000));
  }

  restoreReturnTarget();

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