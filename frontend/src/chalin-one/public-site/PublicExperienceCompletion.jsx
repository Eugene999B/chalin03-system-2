import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  listPublicResource,
  publicWebsiteErrorMessage,
} from "./publicWebsiteApi";
import "./publicExperienceCompletion.css";

const SEARCH_RESOURCES = Object.freeze([
  { key: "divisions", label: "Businesses", path: (item) => `/businesses/${item.slug}` },
  { key: "equipment", label: "Equipment", path: (item) => `/equipment/${item.slug}` },
  { key: "projects", label: "Projects", path: (item) => `/projects/${item.slug}` },
  { key: "news", label: "Newsroom", path: (item) => `/news/${item.slug}` },
  { key: "vacancies", label: "Careers", path: (item) => `/careers/${item.slug}` },
  { key: "locations", label: "Locations", path: () => "/locations" },
]);

const QUICK_PATHS = Object.freeze([
  ["Businesses", "/businesses"],
  ["Equipment", "/equipment"],
  ["Projects", "/projects"],
  ["Newsroom", "/news"],
  ["Careers", "/careers"],
  ["Contact", "/contact"],
]);

function itemTitle(item) {
  return (
    item?.title ||
    item?.name ||
    item?.full_name ||
    item?.position_title ||
    "Published CHALIN ONE item"
  );
}

function itemDescription(item) {
  return (
    item?.short_description ||
    item?.excerpt ||
    item?.summary ||
    item?.description ||
    item?.location_text ||
    item?.address ||
    [item?.manufacturer, item?.model].filter(Boolean).join(" ") ||
    ""
  );
}

function searchableText(item) {
  return [
    itemTitle(item),
    itemDescription(item),
    item?.manufacturer,
    item?.model,
    item?.category?.name,
    item?.division?.name,
    item?.city,
    item?.region,
    item?.country,
    item?.employment_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rememberPage(pathname) {
  if (typeof window === "undefined" || !pathname || pathname === "/") return;
  try {
    const key = "chalin_one_recent_public_pages";
    const current = JSON.parse(window.localStorage.getItem(key) || "[]");
    const next = [pathname, ...current.filter((value) => value !== pathname)].slice(0, 5);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Browsing history enhancement is optional and must never block the site.
  }
}

function readRecentPages() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem("chalin_one_recent_public_pages") || "[]").filter(
      (value) => typeof value === "string" && value.startsWith("/")
    );
  } catch {
    return [];
  }
}

function humanPath(pathname) {
  const value = String(pathname || "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .at(-1);
  if (!value) return "Home";
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contextualActions(pathname) {
  if (pathname.startsWith("/equipment")) {
    return [
      ["Equipment enquiry", "/contact?intent=hire"],
      ["Equipment Business", "/businesses/equipment-business"],
    ];
  }
  if (pathname.startsWith("/businesses/spare-parts")) {
    return [["Find a part", "/contact?intent=parts"], ["All businesses", "/businesses"]];
  }
  if (pathname.startsWith("/businesses/mining")) {
    return [["Mining enquiry", "/contact?intent=mining"], ["Projects", "/projects"]];
  }
  if (pathname.startsWith("/businesses/equipment")) {
    return [["Hire equipment", "/contact?intent=hire"], ["Equipment catalogue", "/equipment"]];
  }
  if (pathname.startsWith("/careers")) {
    return [["Explore businesses", "/businesses"], ["Company story", "/about"]];
  }
  if (pathname.startsWith("/news")) {
    return [["Media centre", "/media"], ["Contact company", "/contact"]];
  }
  if (pathname.startsWith("/projects")) {
    return [["Explore businesses", "/businesses"], ["Start an enquiry", "/contact"]];
  }
  return [["Explore businesses", "/businesses"], ["Start an enquiry", "/contact"]];
}

function ensureMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function syncPublicMetadata(pathname) {
  const title = document.title || "CHALIN ONE | Chalin 03 Company Limited";
  const description =
    document.head.querySelector('meta[name="description"]')?.getAttribute("content") ||
    "CHALIN ONE — the public company platform for Chalin 03 Company Limited.";
  const canonicalUrl = `${window.location.origin}${pathname}${window.location.search}`;

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", canonicalUrl);

  ensureMeta('meta[property="og:title"]', { property: "og:title", content: title });
  ensureMeta('meta[property="og:description"]', { property: "og:description", content: description });
  ensureMeta('meta[property="og:url"]', { property: "og:url", content: canonicalUrl });
  ensureMeta('meta[property="og:type"]', {
    property: "og:type",
    content: pathname.startsWith("/news/") ? "article" : "website",
  });
  ensureMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  ensureMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  ensureMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
}

export default function PublicExperienceCompletion() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [catalogue, setCatalogue] = useState([]);
  const [recent, setRecent] = useState(() => readRecentPages());
  const [routeAnnouncement, setRouteAnnouncement] = useState("CHALIN ONE public website");

  useEffect(() => {
    rememberPage(location.pathname);
    setRecent(readRecentPages());
    setOpen(false);

    const settle = window.setTimeout(() => {
      const main = document.querySelector(".c1-site main");
      if (main) {
        main.id = "c1-main-content";
      }
      syncPublicMetadata(location.pathname);
      setRouteAnnouncement(`${humanPath(location.pathname)} — ${document.title}`);
    }, 80);

    const resync = window.setTimeout(() => {
      syncPublicMetadata(location.pathname);
    }, 650);

    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(resync);
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (["input", "textarea", "select"].includes(tagName)) return;
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open || loaded || loading) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.allSettled(
      SEARCH_RESOURCES.map(async (resource) => {
        const response = await listPublicResource(
          resource.key,
          { limit: 50, offset: 0 },
          { signal: controller.signal }
        );
        const items = Array.isArray(response) ? response : response?.items || [];
        return items.map((item) => ({
          ...item,
          __resource: resource.key,
          __group: resource.label,
          __path: resource.path(item),
        }));
      })
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const successful = results.flatMap((result) =>
          result.status === "fulfilled" ? result.value : []
        );
        setCatalogue(successful);
        const rejected = results.find((result) => result.status === "rejected");
        if (successful.length === 0 && rejected) {
          setError(publicWebsiteErrorMessage(rejected.reason));
        }
        setLoaded(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loaded, loading, open]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const matches = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return catalogue.slice(0, 16);
    return catalogue
      .filter((item) => searchableText(item).includes(cleaned))
      .slice(0, 30);
  }, [catalogue, query]);

  const grouped = useMemo(() => {
    return SEARCH_RESOURCES.map((resource) => ({
      ...resource,
      items: matches.filter((item) => item.__resource === resource.key),
    })).filter((group) => group.items.length > 0);
  }, [matches]);

  const actions = contextualActions(location.pathname);
  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <a className="c1-skip-link" href="#c1-main-content">Skip to main content</a>
      <div className="c1-route-announcer" aria-live="polite" aria-atomic="true">{routeAnnouncement}</div>

      <aside className="c1-completion-rail" aria-label="CHALIN ONE page actions">
        <button type="button" onClick={() => setOpen(true)}>
          <span>DISCOVER</span>
          <strong>Search CHALIN ONE</strong>
          <kbd>/</kbd>
        </button>
        <div>
          <span>YOU ARE HERE</span>
          <strong>{humanPath(location.pathname)}</strong>
        </div>
        {actions.map(([label, path]) => (
          <button type="button" key={path} onClick={() => go(path)}>
            <span>NEXT</span>
            <strong>{label}</strong>
            <b>↗</b>
          </button>
        ))}
      </aside>

      <button
        type="button"
        className="c1-mobile-discovery-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search CHALIN ONE"
      >
        <span>⌕</span>
        <strong>Search</strong>
      </button>

      {open ? (
        <div className="c1-discovery" role="dialog" aria-modal="true" aria-label="Search CHALIN ONE">
          <button className="c1-discovery-backdrop" type="button" aria-label="Close search" onClick={() => setOpen(false)} />
          <section className="c1-discovery-panel">
            <header>
              <div>
                <span>CHALIN ONE / DISCOVERY</span>
                <h2>Find anything published.</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close search">Close ×</button>
            </header>

            <label className="c1-discovery-search">
              <span>⌕</span>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search business, machine, project, story, career or location…"
              />
              <kbd>ESC</kbd>
            </label>

            <div className="c1-discovery-quick">
              {QUICK_PATHS.map(([label, path]) => (
                <button type="button" key={path} onClick={() => go(path)}>{label}</button>
              ))}
            </div>

            <div className="c1-discovery-body">
              {loading ? <div className="c1-discovery-state">Building the published index…</div> : null}
              {!loading && error ? <div className="c1-discovery-state is-error">{error}</div> : null}
              {!loading && loaded && grouped.length === 0 ? (
                <div className="c1-discovery-state">
                  <strong>No published result matches “{query}”.</strong>
                  <button type="button" onClick={() => go("/contact")}>Start a company enquiry ↗</button>
                </div>
              ) : null}

              {!loading && grouped.length > 0 ? (
                <div className="c1-discovery-groups">
                  {grouped.map((group) => (
                    <section key={group.key}>
                      <header><span>{group.label}</span><b>{group.items.length}</b></header>
                      <div>
                        {group.items.map((item, index) => (
                          <button
                            type="button"
                            key={`${item.__resource}-${item.slug || item.key || itemTitle(item)}-${index}`}
                            onClick={() => go(item.__path)}
                          >
                            <small>{item?.division?.name || item?.category?.name || group.label}</small>
                            <strong>{itemTitle(item)}</strong>
                            <p>{itemDescription(item)}</p>
                            <b>↗</b>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>

            {recent.length > 0 ? (
              <footer>
                <span>RECENTLY VIEWED</span>
                <div>
                  {recent.slice(0, 4).map((path) => (
                    <button type="button" key={path} onClick={() => go(path)}>{humanPath(path)}</button>
                  ))}
                </div>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
