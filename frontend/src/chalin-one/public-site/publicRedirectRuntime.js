let installed = false;
let lastLookupPath = "";
let lookupInFlight = false;

function currentPath() {
  if (typeof window === "undefined") return "";
  return String(window.location.pathname || "/");
}

export function safeRuntimeRedirectDestination(value) {
  const raw = String(value || "").trim();
  if (/^\/(?!\/)/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function shouldResolveRenderedNotFound(documentRef = document) {
  return Boolean(documentRef?.querySelector?.(".c1-not-found"));
}

export async function resolveRenderedNotFound(resolveRedirect) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof resolveRedirect !== "function" ||
    !shouldResolveRenderedNotFound(document)
  ) {
    return null;
  }

  const pathname = currentPath();
  if (!pathname || lookupInFlight || pathname === lastLookupPath) return null;

  lookupInFlight = true;
  lastLookupPath = pathname;
  try {
    const redirect = await resolveRedirect(pathname);
    if (!redirect || redirect.source_path !== pathname) return null;
    const destination = safeRuntimeRedirectDestination(redirect.destination_url);
    if (!destination) return null;
    window.location.replace(destination);
    return redirect;
  } catch {
    // Redirect resolution must never replace the normal public 404 with an API error.
    return null;
  } finally {
    lookupInFlight = false;
  }
}

export function installPublicRedirectRuntime(resolveRedirect) {
  if (
    installed ||
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return;
  }
  installed = true;

  const check = () => {
    if (shouldResolveRenderedNotFound(document)) {
      void resolveRenderedNotFound(resolveRedirect);
    }
  };

  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(check);
}
