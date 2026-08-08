import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { getPublicResource } from "./publicWebsiteApi";
import "./publicEditorialFinish.css";

const EDITORIAL_TYPES = Object.freeze({
  news: {
    resource: "news",
    eyebrow: "NEWSROOM / PUBLISHED STORY",
    archive: "/news",
    archiveLabel: "Back to newsroom",
    contact: "/contact",
    contactLabel: "Media or company enquiry",
  },
  projects: {
    resource: "projects",
    eyebrow: "PROJECT / FIELD RECORD",
    archive: "/projects",
    archiveLabel: "Back to projects",
    contact: "/contact",
    contactLabel: "Start a project conversation",
  },
});

function editorialContext(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const config = EDITORIAL_TYPES[parts[0]];
  if (!config || !parts[1]) return null;
  return { ...config, slug: parts[1], routeRoot: parts[0] };
}

function textFromValue(value) {
  if (value === undefined || value === null) return "";
  if (["string", "number"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(textFromValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(textFromValue).join(" ");
  return "";
}

function readingMinutes(item) {
  const words = textFromValue(item?.body || item?.details || item?.description)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return null;
  return Math.max(1, Math.ceil(words / 220));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function locationText(item) {
  const location = item?.location;
  if (typeof location === "string" || typeof location === "number") return String(location);
  if (location && typeof location === "object") {
    return (
      location.name ||
      [location.address, location.city, location.region, location.country]
        .filter(Boolean)
        .join(", ")
    );
  }
  return String(item?.location_text || "");
}

function safeMediaUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function imageEntries(item) {
  const candidates = [item?.media, ...(Array.isArray(item?.gallery) ? item.gallery.map((entry) => entry?.media || entry) : [])];
  const seen = new Set();
  return candidates.flatMap((media) => {
    if (!media || media.media_type !== "image") return [];
    const url = safeMediaUrl(media.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ ...media, url }];
  });
}

function factPairs(item, context) {
  const common = [
    ["Business", item?.division?.name],
    ["Published", formatDate(item?.published_at)],
  ];
  if (context.resource === "news") {
    return [
      ["Category", item?.category?.name],
      ...common,
      ["Reference", item?.reference_number],
    ].filter(([, value]) => value);
  }
  return [
    ...common,
    ["Status", item?.status && humanize(item.status)],
    ["Location", locationText(item)],
    ["Reference", item?.reference_number],
  ].filter(([, value]) => value);
}

function useEditorialTargets(context) {
  const [targets, setTargets] = useState({ intro: null, gallery: null });

  useEffect(() => {
    setTargets({ intro: null, gallery: null });
    if (!context) return undefined;

    let active = true;
    let observer;
    let introHost;
    let galleryHost;
    let main;
    let legacyGallery;

    const resolve = () => {
      if (!active) return false;
      main = document.querySelector(".c1-route-stage main.c1-deep-page");
      const detail = main?.querySelector(":scope > .c1-detail-layout");
      const cta = main?.querySelector(":scope > .c1-deep-cta");
      if (!main || !detail || !cta) return false;

      introHost = document.createElement("div");
      introHost.className = "c1-editorial-intro-host";
      detail.before(introHost);

      galleryHost = document.createElement("div");
      galleryHost.className = "c1-editorial-gallery-host";
      cta.before(galleryHost);

      legacyGallery = Array.from(main.children).find((node) =>
        node.classList?.contains("c1-media-mosaic")
      );
      if (legacyGallery) legacyGallery.dataset.c1LegacyEditorialGallery = "true";
      main.dataset.c1EditorialFinish = context.routeRoot;
      setTargets({ intro: introHost, gallery: galleryHost });
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
      introHost?.remove();
      galleryHost?.remove();
      if (legacyGallery) delete legacyGallery.dataset.c1LegacyEditorialGallery;
      if (main) delete main.dataset.c1EditorialFinish;
    };
  }, [context?.routeRoot, context?.slug]);

  return targets;
}

function StoryDossier({ item, context, onShare, copyState }) {
  const facts = factPairs(item, context);
  const minutes = readingMinutes(item);
  return (
    <section className="c1-story-dossier" aria-label={`${context.routeRoot === "news" ? "Story" : "Project"} reading tools`}>
      <div className="c1-story-dossier-copy">
        <span>{context.eyebrow}</span>
        <h2>Read the published record.</h2>
        <p>
          This page is assembled from information approved for the public CHALIN ONE experience.
          {minutes ? ` Estimated reading time: ${minutes} min.` : ""}
        </p>
      </div>
      {facts.length > 0 ? (
        <dl className="c1-story-dossier-facts">
          {facts.slice(0, 5).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      ) : null}
      <div className="c1-story-dossier-actions">
        <button type="button" onClick={() => onShare("share")}>Share <b>↗</b></button>
        <button type="button" onClick={() => onShare("copy")}>{copyState || "Copy link"}</button>
        <button type="button" onClick={() => window.print()}>Print</button>
      </div>
    </section>
  );
}

function EditorialGallery({ images, context, item }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const active = activeIndex >= 0 ? images[activeIndex] : null;

  useEffect(() => {
    if (!active) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape") setActiveIndex(-1);
      if (event.key === "ArrowRight") setActiveIndex((index) => (index + 1) % images.length);
      if (event.key === "ArrowLeft") setActiveIndex((index) => (index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [active, images.length]);

  if (images.length === 0) return null;

  return (
    <section className="c1-editorial-gallery">
      <header>
        <div><span>VISUAL RECORD</span><h2>{context.resource === "projects" ? "See the field story." : "Published story imagery."}</h2></div>
        <strong>{String(images.length).padStart(2, "0")} APPROVED IMAGE{images.length === 1 ? "" : "S"}</strong>
      </header>
      <div className="c1-editorial-gallery-grid">
        {images.map((media, index) => (
          <button type="button" key={media.url} onClick={() => setActiveIndex(index)}>
            <img src={media.url} alt={media.alt_text || item?.title || item?.name || "CHALIN ONE published media"} loading="lazy" decoding="async" />
            <span>{String(index + 1).padStart(2, "0")}</span>
            {media.caption ? <small>{media.caption}</small> : null}
          </button>
        ))}
      </div>
      {active ? (
        <div className="c1-editorial-lightbox" role="dialog" aria-modal="true" aria-label="Published image viewer">
          <button className="c1-editorial-lightbox-backdrop" type="button" aria-label="Close image viewer" onClick={() => setActiveIndex(-1)} />
          <section>
            <header><span>{context.eyebrow}</span><button type="button" onClick={() => setActiveIndex(-1)}>Close ×</button></header>
            <div className="c1-editorial-lightbox-frame"><img src={active.url} alt={active.alt_text || item?.title || "Published CHALIN ONE media"} /></div>
            <footer>
              <div><strong>{active.caption || item?.title || item?.name}</strong>{active.credit ? <small>{active.credit}</small> : null}</div>
              {images.length > 1 ? <nav aria-label="Gallery controls"><button type="button" onClick={() => setActiveIndex((activeIndex - 1 + images.length) % images.length)}>← Previous</button><span>{activeIndex + 1} / {images.length}</span><button type="button" onClick={() => setActiveIndex((activeIndex + 1) % images.length)}>Next →</button></nav> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default function PublicEditorialFinish() {
  const location = useLocation();
  const context = useMemo(() => editorialContext(location.pathname), [location.pathname]);
  const targets = useEditorialTargets(context);
  const [item, setItem] = useState(null);
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    setItem(null);
    setCopyState("");
    if (!context) return undefined;
    const controller = new AbortController();
    getPublicResource(context.resource, context.slug, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setItem(value || null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setItem(null);
      });
    return () => controller.abort();
  }, [context?.resource, context?.slug]);

  if (!context || !item) return null;

  const images = imageEntries(item);
  const share = async (mode) => {
    const url = window.location.href;
    if (mode === "share" && navigator.share) {
      try {
        await navigator.share({ title: item.title || item.name || document.title, text: item.summary || item.excerpt || "", url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("Link copied");
      window.setTimeout(() => setCopyState(""), 1800);
    } catch {
      setCopyState("Copy unavailable");
      window.setTimeout(() => setCopyState(""), 1800);
    }
  };

  return (
    <>
      {targets.intro ? createPortal(<StoryDossier item={item} context={context} onShare={share} copyState={copyState} />, targets.intro) : null}
      {targets.gallery ? createPortal(<><EditorialGallery images={images} context={context} item={item} /><section className="c1-editorial-continuation"><div><span>CONTINUE THROUGH CHALIN ONE</span><h2>{context.resource === "projects" ? "Move from proof to conversation." : "Keep following the company signal."}</h2></div><div><Link to={context.archive}>{context.archiveLabel}</Link><Link to={context.contact}>{context.contactLabel} ↗</Link></div></section></>, targets.gallery) : null}
    </>
  );
}
