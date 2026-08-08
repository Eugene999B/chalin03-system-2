import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  getPublicResource,
  listPublicResource,
  publicWebsiteErrorMessage,
} from "./publicWebsiteApi";
import "./publicDetailCompanion.css";

const DETAIL_TYPES = Object.freeze({
  equipment: {
    resource: "equipment",
    archive: "/equipment",
    label: "Equipment",
    contact: "/contact?intent=hire",
  },
  projects: {
    resource: "projects",
    archive: "/projects",
    label: "Project",
    contact: "/contact",
  },
  news: {
    resource: "news",
    archive: "/news",
    label: "Newsroom",
    contact: "/contact",
  },
  careers: {
    resource: "vacancies",
    archive: "/careers",
    label: "Career",
    contact: "/contact?intent=career",
  },
});

function detailContext(pathname) {
  const parts = String(pathname || "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const config = DETAIL_TYPES[parts[0]];
  if (!config || !parts[1]) return null;
  return { ...config, slug: parts[1], pathRoot: parts[0] };
}

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function titleFor(item) {
  return item?.title || item?.name || "Published CHALIN ONE record";
}

function descriptionFor(item) {
  return (
    item?.short_description ||
    item?.excerpt ||
    item?.summary ||
    item?.description ||
    ""
  );
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function locationValue(item) {
  return item?.location?.name || item?.location || item?.location_text || "";
}

function factPairs(item, context) {
  const common = [
    ["Business", item?.division?.name],
    ["Location", locationValue(item)],
  ];

  if (context.resource === "equipment") {
    return [
      ["Category", item?.category?.name],
      ["Manufacturer", item?.manufacturer],
      ["Model", item?.model],
      ["Availability", item?.availability && humanize(item.availability)],
      ...common,
    ].filter(([, value]) => value).slice(0, 6);
  }

  if (context.resource === "projects") {
    return [
      ...common,
      ["Status", item?.status && humanize(item.status)],
      ["Reference", item?.reference_number],
      ["Published", formatDate(item?.published_at)],
    ].filter(([, value]) => value).slice(0, 6);
  }

  if (context.resource === "news") {
    return [
      ["Category", item?.category?.name],
      ["Business", item?.division?.name],
      ["Published", formatDate(item?.published_at)],
      ["Reference", item?.reference_number],
    ].filter(([, value]) => value).slice(0, 6);
  }

  return [
    ["Business", item?.division?.name],
    ["Employment type", item?.employment_type && humanize(item.employment_type)],
    ["Location", locationValue(item)],
    ["Status", item?.status && humanize(item.status)],
    ["Published", formatDate(item?.published_at)],
  ].filter(([, value]) => value).slice(0, 6);
}

function comparableValues(item, context) {
  const values = [];
  const push = (kind, value) => {
    const clean = String(value || "").trim().toLowerCase();
    if (clean) values.push(`${kind}:${clean}`);
  };

  push("division", item?.division?.name);
  push("category", item?.category?.name);
  push("location", locationValue(item));

  if (context.resource === "equipment") {
    push("manufacturer", item?.manufacturer);
    push("availability", item?.availability);
  } else if (context.resource === "projects") {
    push("status", item?.status);
  } else if (context.resource === "vacancies") {
    push("employment", item?.employment_type);
  }

  return new Set(values);
}

function relatedRecords(items, current, context) {
  const currentValues = comparableValues(current, context);
  if (currentValues.size === 0) return [];

  return items
    .filter((item) => item?.slug && item.slug !== current?.slug)
    .map((item) => {
      const values = comparableValues(item, context);
      let score = 0;
      values.forEach((value) => {
        if (currentValues.has(value)) score += 1;
      });
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bDate = new Date(b.item?.published_at || 0).getTime() || 0;
      const aDate = new Date(a.item?.published_at || 0).getTime() || 0;
      return bDate - aDate;
    })
    .slice(0, 6)
    .map((entry) => entry.item);
}

function imageFor(item) {
  const media = item?.media || item?.portrait;
  return media?.media_type === "image" && media?.url ? media : null;
}

export default function PublicDetailCompanion() {
  const location = useLocation();
  const navigate = useNavigate();
  const context = useMemo(() => detailContext(location.pathname), [location.pathname]);
  const [state, setState] = useState({ loading: false, item: null, related: [], error: "" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (!context) {
      setState({ loading: false, item: null, related: [], error: "" });
      return undefined;
    }

    const controller = new AbortController();
    setState({ loading: true, item: null, related: [], error: "" });

    Promise.all([
      getPublicResource(context.resource, context.slug, { signal: controller.signal }),
      listPublicResource(
        context.resource,
        { limit: 40, offset: 0 },
        { signal: controller.signal }
      ),
    ])
      .then(([item, listResult]) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          item,
          related: relatedRecords(listFromResult(listResult), item, context),
          error: "",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          item: null,
          related: [],
          error: publicWebsiteErrorMessage(error),
        });
      });

    return () => controller.abort();
  }, [context]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!context || state.loading || state.error || !state.item) return null;

  const facts = factPairs(state.item, context);
  const heroImage = imageFor(state.item);
  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        className="c1-detail-companion-trigger"
        onClick={() => setOpen(true)}
        aria-label={`Open published facts for ${titleFor(state.item)}`}
      >
        <span>PUBLIC RECORD</span>
        <strong>Facts + related</strong>
        <b>+</b>
      </button>

      {open ? (
        <div className="c1-detail-companion" role="dialog" aria-modal="true" aria-label={`${context.label} published facts`}>
          <button type="button" className="c1-detail-companion-backdrop" aria-label="Close published facts" onClick={() => setOpen(false)} />
          <section className="c1-detail-companion-panel">
            <header className={heroImage ? "has-image" : ""}>
              {heroImage ? <img src={heroImage.url} alt={heroImage.alt_text || ""} /> : null}
              <div>
                <span>CHALIN ONE / PUBLISHED RECORD</span>
                <small>{context.label}</small>
                <h2>{titleFor(state.item)}</h2>
                {descriptionFor(state.item) ? <p>{descriptionFor(state.item)}</p> : null}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close published facts">Close ×</button>
            </header>

            <div className="c1-detail-companion-body">
              <section className="c1-detail-facts">
                <header>
                  <span>VERIFIED PUBLIC FIELDS</span>
                  <h3>What this published record says.</h3>
                </header>
                {facts.length > 0 ? (
                  <dl>
                    {facts.map(([label, value]) => (
                      <div key={`${label}-${value}`}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="c1-detail-companion-empty">No additional public fact fields were published for this record.</p>
                )}
                <div className="c1-detail-companion-actions">
                  <button type="button" onClick={() => go(context.contact)}>Continue with an enquiry ↗</button>
                  <button type="button" onClick={() => go(context.archive)}>Open full archive</button>
                </div>
              </section>

              <section className="c1-detail-related">
                <header>
                  <span>RELATED PUBLIC SIGNALS</span>
                  <h3>Connected by published metadata.</h3>
                </header>
                {state.related.length > 0 ? (
                  <div>
                    {state.related.map((item, index) => {
                      const media = imageFor(item);
                      return (
                        <button
                          type="button"
                          key={item.slug || `${titleFor(item)}-${index}`}
                          onClick={() => go(`/${context.pathRoot}/${item.slug}`)}
                        >
                          {media ? <img src={media.url} alt={media.alt_text || ""} loading="lazy" decoding="async" /> : <span>{String(index + 1).padStart(2, "0")}</span>}
                          <div>
                            <small>{item?.division?.name || item?.category?.name || context.label}</small>
                            <strong>{titleFor(item)}</strong>
                            <p>{descriptionFor(item)}</p>
                          </div>
                          <b>↗</b>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="c1-detail-companion-empty">
                    No other published record currently shares enough public metadata to call it related.
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
