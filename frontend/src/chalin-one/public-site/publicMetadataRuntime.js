const METADATA_MAX_TEXT = 1200;
const ROBOTS_TOKEN = /^[a-z0-9:_-]+$/i;
const routeOverrides = new Map();
let installed = false;
let baselineRobots = "";
let syncQueued = false;

function clean(value, maximum = METADATA_MAX_TEXT) {
  return String(value ?? "").trim().slice(0, maximum);
}

export function safeHttpsMetadataUrl(value) {
  const raw = clean(value, 2000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function sanitizeRobotsDirective(value, fallback = "index,follow") {
  const tokens = clean(value || fallback, 200)
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((token) => token && ROBOTS_TOKEN.test(token))
    .slice(0, 8);
  return tokens.length ? [...new Set(tokens)].join(",") : fallback;
}

export function isNoIndexDirective(value) {
  return sanitizeRobotsDirective(value, "").split(",").includes("noindex");
}

function safeCurrentCanonical(origin, pathname) {
  const safeOrigin = safeHttpsMetadataUrl(origin);
  if (!safeOrigin) return "";
  try {
    const base = new URL(safeOrigin);
    const path = String(pathname || "/").startsWith("/") ? String(pathname || "/") : "/";
    const result = new URL(path, base.origin);
    result.search = "";
    result.hash = "";
    return result.toString();
  } catch {
    return "";
  }
}

export function buildPublicMetadataSnapshot(input = {}, environment = {}) {
  const lockedRobots = clean(environment.baselineRobots, 200);
  const robotsLocked = isNoIndexDirective(lockedRobots);
  const fallbackCanonical = safeCurrentCanonical(environment.origin, environment.pathname);
  const governedCanonical = safeHttpsMetadataUrl(input.canonicalUrl);
  const image = safeHttpsMetadataUrl(input.imageUrl);
  const title = clean(input.title, 300);
  const description = clean(input.description, 700);
  const robots = robotsLocked
    ? sanitizeRobotsDirective(lockedRobots, "noindex,nofollow,noarchive")
    : sanitizeRobotsDirective(input.robots, "index,follow");

  return {
    title,
    description,
    canonicalUrl: governedCanonical || fallbackCanonical,
    robots,
    robotsLocked,
    imageUrl: image,
    imageAlt: clean(input.imageAlt, 500),
    type: clean(input.type, 40) === "article" ? "article" : "website",
  };
}

function ensureMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  return node;
}

function ensureCanonicalLink() {
  let node = document.head.querySelector('link[rel="canonical"]');
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", "canonical");
    document.head.appendChild(node);
  }
  return node;
}

function removeNode(selector) {
  const node = document.head.querySelector(selector);
  if (node) node.remove();
}

function setContent(selector, identity, value) {
  if (!value) {
    removeNode(selector);
    return;
  }
  const node = ensureMeta(selector, identity);
  if (node.getAttribute("content") !== value) node.setAttribute("content", value);
}

export function writePublicMetadataToDocument(snapshot) {
  if (typeof document === "undefined" || !snapshot) return;
  if (snapshot.title && document.title !== snapshot.title) document.title = snapshot.title;
  setContent('meta[name="description"]', { name: "description" }, snapshot.description);
  setContent('meta[name="robots"]', { name: "robots" }, snapshot.robots);

  if (snapshot.canonicalUrl) {
    const canonical = ensureCanonicalLink();
    if (canonical.getAttribute("href") !== snapshot.canonicalUrl) canonical.setAttribute("href", snapshot.canonicalUrl);
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }

  setContent('meta[property="og:title"]', { property: "og:title" }, snapshot.title);
  setContent('meta[property="og:description"]', { property: "og:description" }, snapshot.description);
  setContent('meta[property="og:url"]', { property: "og:url" }, snapshot.canonicalUrl);
  setContent('meta[property="og:type"]', { property: "og:type" }, snapshot.type);
  setContent('meta[property="og:image"]', { property: "og:image" }, snapshot.imageUrl);
  setContent('meta[property="og:image:alt"]', { property: "og:image:alt" }, snapshot.imageUrl ? snapshot.imageAlt : "");
  setContent('meta[name="twitter:card"]', { name: "twitter:card" }, snapshot.imageUrl ? "summary_large_image" : "summary");
  setContent('meta[name="twitter:title"]', { name: "twitter:title" }, snapshot.title);
  setContent('meta[name="twitter:description"]', { name: "twitter:description" }, snapshot.description);
  setContent('meta[name="twitter:image"]', { name: "twitter:image" }, snapshot.imageUrl);
  setContent('meta[name="twitter:image:alt"]', { name: "twitter:image:alt" }, snapshot.imageUrl ? snapshot.imageAlt : "");
}

function currentPath() {
  return typeof window === "undefined" ? "/" : window.location.pathname || "/";
}

function currentDocumentInput() {
  if (typeof document === "undefined") return {};
  return {
    title: document.title,
    description: document.head.querySelector('meta[name="description"]')?.getAttribute("content") || "",
  };
}

export function syncCurrentPublicMetadata() {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const path = currentPath();
  const override = routeOverrides.get(path) || {};
  const current = currentDocumentInput();
  const snapshot = buildPublicMetadataSnapshot(
    {
      ...current,
      ...override,
      title: override.title || current.title,
      description: override.description || current.description,
    },
    {
      origin: window.location.origin,
      pathname: path,
      baselineRobots,
    }
  );
  writePublicMetadataToDocument(snapshot);
  return snapshot;
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncCurrentPublicMetadata();
  });
}

export function applyPublishedPublicMetadata(data = {}, options = {}) {
  if (typeof window === "undefined") return null;
  const seo = data?.seo || {};
  const media = data?.media || data?.featured_media || null;
  const title = clean(seo.title || data.title || data.name || options.title, 300);
  const description = clean(
    seo.description || data.excerpt || data.summary || data.short_description || options.description,
    700
  );
  const path = currentPath();
  routeOverrides.set(path, {
    title,
    description,
    canonicalUrl: seo.canonical_url || options.canonicalUrl || "",
    robots: seo.robots || options.robots || "",
    imageUrl: media?.url || options.imageUrl || "",
    imageAlt: media?.alt_text || title || options.imageAlt || "",
    type: options.type === "article" ? "article" : "website",
  });
  return syncCurrentPublicMetadata();
}

export function clearPublishedPublicMetadata(pathname = currentPath()) {
  routeOverrides.delete(pathname);
  return syncCurrentPublicMetadata();
}

export function installPublicMetadataRuntime() {
  if (installed || typeof document === "undefined" || typeof window === "undefined") return;
  installed = true;
  baselineRobots = document.head.querySelector('meta[name="robots"]')?.getAttribute("content") || "";

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.target === document.querySelector("title") || mutation.target === document.head.querySelector('meta[name="description"]'))) {
      queueSync();
    }
  });
  observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["content"] });

  const wrapHistory = (method) => {
    const original = window.history[method];
    if (typeof original !== "function" || original.__chalinMetadataWrapped) return;
    function wrappedHistory(...args) {
      const result = original.apply(this, args);
      queueSync();
      return result;
    }
    wrappedHistory.__chalinMetadataWrapped = true;
    window.history[method] = wrappedHistory;
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("popstate", queueSync);
  queueSync();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installPublicMetadataRuntime();
}
