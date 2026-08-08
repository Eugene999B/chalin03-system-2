import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import {
  getPublicResource,
  listPublicResource,
} from "./publicWebsiteApi";
import "./publicWorldEnhancements.css";

const BUSINESS_INTENTS = Object.freeze({
  "spare-parts": {
    label: "Spare Parts",
    intent: "parts",
    tokens: ["spare", "parts"],
    accent: "PARTS",
  },
  "mining-operations": {
    label: "Mining Operations",
    intent: "mining",
    tokens: ["mining", "mine"],
    accent: "MINING",
  },
  "equipment-business": {
    label: "Equipment Business",
    intent: "hire",
    tokens: ["equipment", "hire", "sales"],
    accent: "EQUIPMENT",
  },
});

const MEDIA_SOURCES = Object.freeze([
  { resource: "projects", label: "Projects", path: (item) => `/projects/${item.slug}` },
  { resource: "equipment", label: "Equipment", path: (item) => `/equipment/${item.slug}` },
  { resource: "news", label: "Newsroom", path: (item) => `/news/${item.slug}` },
  { resource: "leadership", label: "Leadership", path: () => "/leadership" },
]);

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function itemTitle(item) {
  return item?.title || item?.name || item?.full_name || "Published CHALIN ONE item";
}

function itemSummary(item) {
  return (
    item?.short_description ||
    item?.excerpt ||
    item?.summary ||
    item?.description ||
    item?.professional_summary ||
    ""
  );
}

function imageFor(item) {
  const media = item?.media || item?.portrait;
  return media?.media_type === "image" && media?.url ? media : null;
}

function locationText(item) {
  const location = item?.location;
  if (typeof location === "string" || typeof location === "number") return String(location);
  if (location && typeof location === "object") {
    return [
      location.name,
      location.address,
      location.city,
      location.region,
      location.country,
    ]
      .filter(Boolean)
      .join(", ");
  }
  return [item?.address, item?.city, item?.region, item?.country]
    .filter(Boolean)
    .join(", ");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function businessContext(pathname) {
  const match = String(pathname || "").match(/^\/businesses\/([^/]+)/);
  if (!match) return null;
  const slug = match[1];
  return {
    slug,
    ...(BUSINESS_INTENTS[slug] || {
      label: humanize(slug),
      intent: "",
      tokens: slug.split("-").filter((token) => token.length > 3),
      accent: "BUSINESS",
    }),
  };
}

function matchesBusiness(item, context, division) {
  if (!item || !context) return false;
  const entryDivision = item.division || {};
  const slug = normalize(entryDivision.slug);
  const name = normalize(entryDivision.name);
  const currentSlug = normalize(division?.slug || context.slug);
  const currentName = normalize(division?.name || context.label);

  if (slug && currentSlug && slug === currentSlug) return true;
  if (name && currentName && name === currentName) return true;

  const haystack = `${slug} ${name}`;
  return context.tokens.some((token) => token.length > 3 && haystack.includes(normalize(token)));
}

function usePortalTarget(pathname) {
  const [target, setTarget] = useState(null);

  useEffect(() => {
    setTarget(null);
    let active = true;
    let observer;

    const resolve = () => {
      if (!active) return false;
      const node = document.querySelector(".c1-route-stage main.c1-deep-page");
      if (!node) return false;
      setTarget(node);
      return true;
    };

    if (!resolve()) {
      observer = new MutationObserver(() => {
        if (resolve()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [pathname]);

  return target;
}

function useEnhancementData(kind, context) {
  const [state, setState] = useState({ loading: false, data: null });

  useEffect(() => {
    if (!kind) {
      setState({ loading: false, data: null });
      return undefined;
    }

    const controller = new AbortController();
    setState({ loading: true, data: null });

    const load = async () => {
      if (kind === "business") {
        const requests = await Promise.allSettled([
          getPublicResource("divisions", context.slug, { signal: controller.signal }),
          listPublicResource("projects", { limit: 30, offset: 0 }, { signal: controller.signal }),
          listPublicResource("equipment", { limit: 30, offset: 0 }, { signal: controller.signal }),
          listPublicResource("news", { limit: 30, offset: 0 }, { signal: controller.signal }),
          listPublicResource("locations", { limit: 30, offset: 0 }, { signal: controller.signal }),
        ]);
        return {
          division: requests[0].status === "fulfilled" ? requests[0].value : null,
          projects: requests[1].status === "fulfilled" ? listFromResult(requests[1].value) : [],
          equipment: requests[2].status === "fulfilled" ? listFromResult(requests[2].value) : [],
          news: requests[3].status === "fulfilled" ? listFromResult(requests[3].value) : [],
          locations: requests[4].status === "fulfilled" ? listFromResult(requests[4].value) : [],
        };
      }

      if (kind === "media") {
        const requests = await Promise.allSettled(
          MEDIA_SOURCES.map((source) =>
            listPublicResource(source.resource, { limit: 40, offset: 0 }, { signal: controller.signal })
          )
        );
        return MEDIA_SOURCES.flatMap((source, index) => {
          const result = requests[index];
          if (result.status !== "fulfilled") return [];
          return listFromResult(result.value)
            .map((item) => ({
              ...item,
              __source: source.label,
              __path: source.path(item),
              __image: imageFor(item),
            }))
            .filter((item) => item.__image);
        });
      }

      if (kind === "locations" || kind === "contact") {
        const requests = await Promise.allSettled([
          listPublicResource("locations", { limit: 60, offset: 0 }, { signal: controller.signal }),
          listPublicResource("divisions", { limit: 20, offset: 0 }, { signal: controller.signal }),
        ]);
        return {
          locations: requests[0].status === "fulfilled" ? listFromResult(requests[0].value) : [],
          divisions: requests[1].status === "fulfilled" ? listFromResult(requests[1].value) : [],
        };
      }

      return null;
    };

    load()
      .then((data) => {
        if (!controller.signal.aborted) setState({ loading: false, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ loading: false, data: null });
      });

    return () => controller.abort();
  }, [context?.slug, kind]);

  return state;
}

function SignalCard({ item, type, path }) {
  const media = imageFor(item);
  return (
    <Link className="c1-world-signal-card" to={path}>
      {media ? (
        <img src={media.url} alt={media.alt_text || itemTitle(item)} loading="lazy" decoding="async" />
      ) : (
        <div className="c1-world-signal-art" aria-hidden="true">C1</div>
      )}
      <div>
        <small>{type}</small>
        <h3>{itemTitle(item)}</h3>
        {itemSummary(item) ? <p>{itemSummary(item)}</p> : null}
        <span>Open published signal ↗</span>
      </div>
    </Link>
  );
}

function BusinessWorldPulse({ context, data }) {
  const division = data?.division || null;
  const projects = (data?.projects || []).filter((item) => matchesBusiness(item, context, division));
  const equipment = (data?.equipment || []).filter((item) => matchesBusiness(item, context, division));
  const news = (data?.news || []).filter((item) => matchesBusiness(item, context, division));
  const locations = (data?.locations || []).filter((item) => matchesBusiness(item, context, division));
  const signals = [
    ...projects.slice(0, 2).map((item) => ({ item, type: "Project", path: `/projects/${item.slug}` })),
    ...equipment.slice(0, 2).map((item) => ({ item, type: "Equipment", path: `/equipment/${item.slug}` })),
    ...news.slice(0, 2).map((item) => ({ item, type: "Newsroom", path: `/news/${item.slug}` })),
  ].slice(0, 5);

  return (
    <section className="c1-world-pulse" aria-label={`${context.label} public signals`}>
      <header>
        <div>
          <span>{context.accent} / LIVE PUBLIC WORLD</span>
          <h2>This business should feel alive.</h2>
        </div>
        <p>
          Published work, machines, company signals and locations connected to this business are brought into one view automatically.
        </p>
      </header>

      <div className="c1-world-pulse-metrics">
        <article><strong>{projects.length}</strong><span>published projects</span></article>
        <article><strong>{equipment.length}</strong><span>published equipment</span></article>
        <article><strong>{news.length}</strong><span>published stories</span></article>
        <article><strong>{locations.length}</strong><span>published locations</span></article>
      </div>

      {signals.length > 0 ? (
        <div className="c1-world-signal-grid">
          {signals.map(({ item, type, path }, index) => (
            <SignalCard item={item} type={type} path={path} key={`${type}-${item.slug || item.key || index}`} />
          ))}
        </div>
      ) : (
        <div className="c1-world-empty-signal">
          <span>PUBLICATION READY</span>
          <strong>The business world is connected.</strong>
          <p>Approved projects, equipment and stories will populate this live layer automatically.</p>
        </div>
      )}

      <div className="c1-world-pathways">
        <Link to={`/contact${context.intent ? `?intent=${context.intent}` : ""}`}>
          <small>START</small><strong>Business enquiry</strong><b>↗</b>
        </Link>
        <Link to="/projects"><small>PROOF</small><strong>Project archive</strong><b>↗</b></Link>
        <Link to="/news"><small>SIGNAL</small><strong>Newsroom</strong><b>↗</b></Link>
        <Link to="/locations"><small>PLACE</small><strong>Operating network</strong><b>↗</b></Link>
      </div>
    </section>
  );
}

function MediaJournal({ items }) {
  const [filter, setFilter] = useState("All");
  const [active, setActive] = useState(null);
  const sources = useMemo(
    () => ["All", ...Array.from(new Set(items.map((item) => item.__source)))],
    [items]
  );
  const filtered = filter === "All" ? items : items.filter((item) => item.__source === filter);

  useEffect(() => {
    if (!active) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => event.key === "Escape" && setActive(null);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  return (
    <section className="c1-media-journal" aria-label="CHALIN ONE visual journal">
      <header>
        <div><span>VISUAL JOURNAL / GOVERNED MEDIA</span><h2>Not a gallery. A record of the company.</h2></div>
        <p>Photography is grouped by the published record it belongs to, so every image keeps its business context.</p>
      </header>

      <div className="c1-media-journal-filters" role="group" aria-label="Filter media journal">
        {sources.map((source) => (
          <button
            type="button"
            className={filter === source ? "is-active" : ""}
            aria-pressed={filter === source}
            onClick={() => setFilter(source)}
            key={source}
          >
            {source}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="c1-media-journal-grid">
          {filtered.map((item, index) => (
            <button
              type="button"
              className={index % 5 === 0 ? "is-wide" : ""}
              onClick={() => setActive(item)}
              key={`${item.__source}-${item.slug || item.key || index}`}
            >
              <img src={item.__image.url} alt={item.__image.alt_text || itemTitle(item)} loading="lazy" decoding="async" />
              <span>{item.__source}</span>
              <strong>{itemTitle(item)}</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="c1-world-empty-signal"><strong>No published image in this view yet.</strong></div>
      )}

      {active ? (
        <div className="c1-media-lightbox" role="dialog" aria-modal="true" aria-label={itemTitle(active)}>
          <button type="button" className="c1-media-lightbox-backdrop" aria-label="Close image" onClick={() => setActive(null)} />
          <article>
            <button type="button" className="c1-media-lightbox-close" onClick={() => setActive(null)}>Close ×</button>
            <img src={active.__image.url} alt={active.__image.alt_text || itemTitle(active)} />
            <div>
              <span>{active.__source}</span>
              <h3>{itemTitle(active)}</h3>
              {itemSummary(active) ? <p>{itemSummary(active)}</p> : null}
              <Link to={active.__path} onClick={() => setActive(null)}>Open the published record ↗</Link>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}

function LocationsNetwork({ locations }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All");
  const regions = useMemo(() => {
    const values = Array.from(
      new Set(locations.map((item) => item.region || item.city).filter(Boolean).map(String))
    );
    return ["All", ...values.sort((a, b) => a.localeCompare(b))];
  }, [locations]);

  const filtered = useMemo(() => {
    const clean = normalize(query);
    return locations.filter((item) => {
      const place = locationText(item);
      const searchable = normalize(`${item.name || ""} ${place} ${item.division?.name || ""}`);
      const regionMatches = region === "All" || String(item.region || item.city || "") === region;
      return regionMatches && (!clean || searchable.includes(clean));
    });
  }, [locations, query, region]);

  return (
    <section className="c1-location-intelligence" aria-label="Explore CHALIN ONE locations">
      <header>
        <div><span>OPERATING NETWORK / FIND A PLACE</span><h2>Move from company view to physical location.</h2></div>
        <p>Only locations approved for public display are searchable here.</p>
      </header>

      <div className="c1-location-controls">
        <label>
          <span>Search location</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, town, region or business…" />
        </label>
        {regions.length > 2 ? (
          <div role="group" aria-label="Filter location region">
            {regions.map((value) => (
              <button type="button" className={region === value ? "is-active" : ""} onClick={() => setRegion(value)} key={value}>{value}</button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="c1-location-network-grid">
        {filtered.map((item, index) => {
          const address = locationText(item);
          const directions = address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
            : "";
          return (
            <article key={item.key || item.slug || item.name || index}>
              <span>{String(index + 1).padStart(2, "0")} / LOCATION</span>
              <h3>{item.name || "Published location"}</h3>
              {item.division?.name ? <small>{item.division.name}</small> : null}
              {address ? <p>{address}</p> : null}
              <div>
                {item.phone ? <a href={`tel:${String(item.phone).replace(/[^+\d]/g, "")}`}>Call</a> : null}
                {item.email ? <a href={`mailto:${item.email}`}>Email</a> : null}
                {directions ? <a href={directions} target="_blank" rel="noreferrer">Directions ↗</a> : null}
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="c1-world-empty-signal"><strong>No published location matches this view.</strong></div>
      ) : null}
    </section>
  );
}

function ContactRouting({ divisions, locations, search }) {
  const selectedIntent = normalize(new URLSearchParams(search).get("intent"));
  const routes = [
    ["parts", "Spare Parts", "Find or enquire about a part"],
    ["mining", "Mining Operations", "Start a mining conversation"],
    ["hire", "Equipment Hire", "Discuss a machine or hire requirement"],
    ["buy", "Equipment Sales", "Discuss buying equipment"],
    ["career", "Careers", "Ask about a published opportunity"],
  ];

  return (
    <section className="c1-contact-routing" aria-label="Choose a CHALIN ONE contact route">
      <header>
        <div><span>CONTACT ROUTING / NO DEAD ENDS</span><h2>Enter the company through the right door.</h2></div>
        <p>The website can carry your purpose into the governed enquiry form instead of treating every visitor the same.</p>
      </header>
      <div className="c1-contact-routing-grid">
        {routes.map(([intent, label, text], index) => (
          <Link className={selectedIntent === intent ? "is-active" : ""} to={`/contact?intent=${intent}`} key={intent}>
            <span>0{index + 1}</span><small>{label}</small><strong>{text}</strong><b>↗</b>
          </Link>
        ))}
      </div>
      {(divisions.length > 0 || locations.length > 0) ? (
        <div className="c1-contact-published-context">
          <div><span>PUBLISHED BUSINESSES</span><strong>{divisions.length || 3}</strong></div>
          <div><span>PUBLIC LOCATIONS</span><strong>{locations.length}</strong></div>
          <Link to="/locations">Explore the operating network ↗</Link>
        </div>
      ) : null}
    </section>
  );
}

export default function PublicWorldEnhancements() {
  const location = useLocation();
  const target = usePortalTarget(location.pathname);
  const business = useMemo(() => businessContext(location.pathname), [location.pathname]);
  const kind = business
    ? "business"
    : location.pathname === "/media"
      ? "media"
      : location.pathname === "/locations"
        ? "locations"
        : location.pathname === "/contact"
          ? "contact"
          : "";
  const request = useEnhancementData(kind, business);

  useEffect(() => {
    if (!target || !kind) return undefined;
    target.dataset.c1Enhancement = kind;
    return () => {
      if (target.dataset.c1Enhancement === kind) delete target.dataset.c1Enhancement;
    };
  }, [kind, target]);

  if (!target || !kind || request.loading || !request.data) return null;

  let content = null;
  if (kind === "business") {
    content = <BusinessWorldPulse context={business} data={request.data} />;
  } else if (kind === "media") {
    content = <MediaJournal items={request.data} />;
  } else if (kind === "locations") {
    content = <LocationsNetwork locations={request.data.locations || []} />;
  } else if (kind === "contact") {
    content = (
      <ContactRouting
        divisions={request.data.divisions || []}
        locations={request.data.locations || []}
        search={location.search}
      />
    );
  }

  return content ? createPortal(content, target) : null;
}
