import { safeHttpsMetadataUrl } from "./publicMetadataRuntime.js";

const SCRIPT_ID = "chalin-one-route-structured-data";
const routeGraphs = new Map();
let installed = false;
let syncQueued = false;

function clean(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeIsoDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeCurrentUrl(origin, pathname) {
  const safeOrigin = safeHttpsMetadataUrl(origin);
  if (!safeOrigin) return "";
  try {
    const base = new URL(safeOrigin);
    const route = String(pathname || "/").startsWith("/") ? String(pathname || "/") : "/";
    const url = new URL(route, base.origin);
    url.search = "";
    url.hash = "";
    return safeHttpsMetadataUrl(url.toString());
  } catch {
    return "";
  }
}

function humanize(value) {
  return clean(value, 160)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function absolutePathUrl(origin, pathname) {
  return safeCurrentUrl(origin, pathname);
}

export function buildBreadcrumbItems(pathname, title, origin) {
  const path = String(pathname || "/").split(/[?#]/)[0] || "/";
  const segments = path.split("/").filter(Boolean);
  const items = [{ name: "Home", item: absolutePathUrl(origin, "/") }];
  if (!segments.length) return items.filter((entry) => entry.item);

  const landingLabels = {
    businesses: "Businesses",
    projects: "Projects",
    equipment: "Equipment",
    news: "Newsroom",
    careers: "Careers",
    tenders: "Tenders",
  };
  const prefix = segments[0];
  if (landingLabels[prefix] && segments.length > 1) {
    items.push({ name: landingLabels[prefix], item: absolutePathUrl(origin, `/${prefix}`) });
  }

  if (prefix === "businesses" && segments.length > 2) {
    items.push({
      name: humanize(segments[1]),
      item: absolutePathUrl(origin, `/businesses/${segments[1]}`),
    });
  }

  const canonicalPath = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  const finalName =
    prefix === "businesses" && segments.length > 2
      ? humanize(segments[segments.length - 1])
      : clean(title, 200) || humanize(segments[segments.length - 1]);
  const finalUrl = absolutePathUrl(origin, canonicalPath);
  if (finalUrl && !items.some((entry) => entry.item === finalUrl)) {
    items.push({ name: finalName, item: finalUrl });
  }
  return items.filter((entry) => entry.name && entry.item);
}

function breadcrumbGraph(items) {
  if (!Array.isArray(items) || items.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

function authorNode(value) {
  const name = clean(value, 200);
  if (!name) return null;
  return {
    "@type": /chalin/i.test(name) ? "Organization" : "Person",
    name,
  };
}

export function buildPublicStructuredDataGraph(data = {}, options = {}, environment = {}) {
  const seo = data?.seo || {};
  const media = data?.media || data?.featured_media || null;
  const pathname = String(environment.pathname || options.pathname || "/");
  const origin = environment.origin || options.origin || "";
  const canonical =
    safeHttpsMetadataUrl(seo.canonical_url || options.canonicalUrl || "") ||
    safeCurrentUrl(origin, pathname);
  if (!canonical) return null;

  const title = clean(seo.title || data.title || data.name || options.title, 300);
  const description = clean(
    seo.description || data.excerpt || data.summary || data.short_description || options.description,
    700
  );
  const imageUrl = safeHttpsMetadataUrl(media?.url || options.imageUrl || "");
  const publishedAt = safeIsoDate(data.published_at || options.publishedAt);
  const isArticle = options.type === "article";
  const pageNode = {
    "@type": isArticle ? "NewsArticle" : "WebPage",
    "@id": `${canonical}#webpage`,
    url: canonical,
    name: title || "CHALIN ONE",
    isPartOf: {
      "@type": "WebSite",
      "@id": `${new URL(canonical).origin}/#website`,
      name: "CHALIN ONE",
    },
  };
  if (description) pageNode.description = description;
  if (imageUrl) {
    pageNode.primaryImageOfPage = {
      "@type": "ImageObject",
      url: imageUrl,
      caption: clean(media?.alt_text || title, 500),
    };
    if (isArticle) pageNode.image = [imageUrl];
  }
  if (publishedAt) pageNode.datePublished = publishedAt;

  if (isArticle) {
    pageNode.headline = title || "CHALIN ONE News";
    pageNode.publisher = {
      "@type": "Organization",
      name: "Chalin 03 Company Limited",
    };
    const author = authorNode(data.author || data.author_display_name || options.author);
    if (author) pageNode.author = author;
  }

  const crumbs = breadcrumbGraph(
    buildBreadcrumbItems(pathname, title || data.name, new URL(canonical).origin)
  );
  const graph = [pageNode];
  if (crumbs) graph.push(crumbs);
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export function writePublicStructuredDataToDocument(graph) {
  if (typeof document === "undefined") return;
  let script = document.getElementById(SCRIPT_ID);
  if (!graph?.["@graph"]?.length) {
    script?.remove();
    return;
  }
  if (!script) {
    script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  const serialized = JSON.stringify(graph);
  if (script.textContent !== serialized) script.textContent = serialized;
}

function currentPath() {
  return typeof window === "undefined" ? "/" : window.location.pathname || "/";
}

export function syncCurrentPublicStructuredData() {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const graph = routeGraphs.get(currentPath()) || null;
  writePublicStructuredDataToDocument(graph);
  return graph;
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncCurrentPublicStructuredData();
  });
}

export function applyPublishedPublicStructuredData(data = {}, options = {}) {
  if (typeof window === "undefined") return null;
  const path = currentPath();
  const graph = buildPublicStructuredDataGraph(data, options, {
    origin: window.location.origin,
    pathname: path,
  });
  if (graph) routeGraphs.set(path, graph);
  else routeGraphs.delete(path);
  writePublicStructuredDataToDocument(graph);
  return graph;
}

export function clearPublishedPublicStructuredData(pathname = currentPath()) {
  routeGraphs.delete(pathname);
  return syncCurrentPublicStructuredData();
}

export function installPublicStructuredDataRuntime() {
  if (installed || typeof document === "undefined" || typeof window === "undefined") return;
  installed = true;

  const wrapHistory = (method) => {
    const original = window.history[method];
    if (typeof original !== "function" || original.__chalinStructuredDataWrapped) return;
    function wrappedHistory(...args) {
      const result = original.apply(this, args);
      queueSync();
      return result;
    }
    wrappedHistory.__chalinStructuredDataWrapped = true;
    window.history[method] = wrappedHistory;
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("popstate", queueSync);

  const title = document.querySelector("title");
  if (title) {
    const observer = new MutationObserver(queueSync);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
  }
  queueSync();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installPublicStructuredDataRuntime();
}
