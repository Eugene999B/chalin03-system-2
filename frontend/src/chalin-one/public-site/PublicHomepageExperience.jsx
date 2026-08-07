import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  getPublicBootstrap,
  listPublicResource,
  publicWebsiteErrorMessage,
} from "./publicWebsiteApi";
import {
  PublicFooterNavigation,
  PublicNavigation,
  publicNavigationPath,
} from "./PublicNavigation";
import "./publicWebsite.css";
import "./publicHomepageExperience.css";

const PUBLIC_ROOT = "/website";
const COLLECTION_LIMITS = Object.freeze({
  news: 6,
  leadership: 4,
  projects: 6,
  equipment: 6,
  locations: 4,
});

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function settingValue(settings, key, fallback = "") {
  const value = settings?.[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    return String(value.text || value.name || value.label || value.value || fallback);
  }
  return fallback;
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

function formatMoney(price) {
  if (!price || price.amount === undefined || price.amount === null) return "";
  const amount = Number(price.amount);
  if (!Number.isFinite(amount)) return "";
  const currency = /^[A-Z]{3}$/.test(String(price.currency || "").toUpperCase())
    ? String(price.currency).toUpperCase()
    : "GHS";
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-GH")}`;
  }
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PublicLink({ target, children, className = "", ariaLabel }) {
  const descriptor = publicNavigationPath(target);
  if (!descriptor) return <span className={className}>{children}</span>;
  if (descriptor.external) {
    const newTab = descriptor.href.startsWith("http");
    return (
      <a
        className={className}
        href={descriptor.href}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noreferrer" : undefined}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }
  return <Link className={className} to={descriptor.href} aria-label={ariaLabel}>{children}</Link>;
}

function PublishedMedia({ media, className = "", eager = false }) {
  if (!media?.url) return null;
  if (media.media_type === "image") {
    return (
      <figure className={`c1h-media ${className}`.trim()}>
        <img
          src={media.url}
          alt={media.alt_text || "Published Chalin 03 media"}
          width={media.width || undefined}
          height={media.height || undefined}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
        />
        {media.caption || media.credit ? (
          <figcaption>{[media.caption, media.credit].filter(Boolean).join(" — ")}</figcaption>
        ) : null}
      </figure>
    );
  }
  const label = media.media_type === "document"
    ? media.original_name || "Open published document"
    : "Open published video";
  return (
    <a className="c1h-media-link" href={media.url} target="_blank" rel="noreferrer">
      <span aria-hidden="true">↗</span>{label}
    </a>
  );
}

function StructuredContent({ value, depth = 0 }) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number"].includes(typeof value)) return <p>{String(value)}</p>;
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="c1h-structured-list">
        {value.map((item, index) => (
          <li key={typeof item === "string" ? `${item}-${index}` : index}>
            <StructuredContent value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return (
        <>
          <p>{value.text}</p>
          {value.items ? <StructuredContent value={value.items} depth={depth + 1} /> : null}
        </>
      );
    }
    return (
      <div className="c1h-structured-object">
        {Object.entries(value)
          .filter(([, item]) => item !== undefined && item !== null && item !== "")
          .map(([key, item]) => (
            <section key={key}>
              {depth < 2 ? <h4>{humanize(key)}</h4> : null}
              <StructuredContent value={item} depth={depth + 1} />
            </section>
          ))}
      </div>
    );
  }
  return null;
}

function useHomepageMetadata(page, siteName) {
  const title = page?.seo?.title || page?.title || siteName || "CHALIN ONE";
  const description = page?.seo?.description || page?.summary || "";
  const image = page?.media?.media_type === "image" ? page.media.url : "";
  const robots = page?.seo?.robots || "index,follow";

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = title;

    const touched = [];
    function setMeta(selector, attributes) {
      let node = document.head.querySelector(selector);
      const created = !node;
      if (!node) {
        node = document.createElement("meta");
        document.head.appendChild(node);
      }
      const previous = {};
      for (const [key, value] of Object.entries(attributes)) {
        previous[key] = node.getAttribute(key);
        if (value) node.setAttribute(key, value);
        else node.removeAttribute(key);
      }
      touched.push({ node, created, previous });
    }

    setMeta('meta[name="description"]', { name: "description", content: description });
    setMeta('meta[name="robots"]', { name: "robots", content: robots });
    setMeta('meta[property="og:title"]', { property: "og:title", content: title });
    setMeta('meta[property="og:description"]', { property: "og:description", content: description });
    setMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    setMeta('meta[property="og:url"]', { property: "og:url", content: window.location.href.split(/[?#]/)[0] });
    if (image) setMeta('meta[property="og:image"]', { property: "og:image", content: image });
    setMeta('meta[name="twitter:card"]', { name: "twitter:card", content: image ? "summary_large_image" : "summary" });
    setMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
    setMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
    if (image) setMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });

    let canonical = document.head.querySelector('link[rel="canonical"]');
    const canonicalCreated = !canonical;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    const previousCanonical = canonical.getAttribute("href");
    canonical.setAttribute(
      "href",
      page?.seo?.canonical_url || window.location.href.split(/[?#]/)[0]
    );

    return () => {
      document.title = previousTitle;
      for (const { node, created, previous } of touched.reverse()) {
        if (created) {
          node.remove();
          continue;
        }
        for (const [key, value] of Object.entries(previous)) {
          if (value === null) node.removeAttribute(key);
          else node.setAttribute(key, value);
        }
      }
      if (canonicalCreated) canonical.remove();
      else if (previousCanonical === null) canonical.removeAttribute("href");
      else canonical.setAttribute("href", previousCanonical);
    };
  }, [description, image, page?.seo?.canonical_url, robots, title]);
}

function useHomepageData() {
  const [state, setState] = useState({
    loading: true,
    error: "",
    bootstrap: null,
    collections: {},
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const bootstrap = await getPublicBootstrap({ signal: controller.signal });
        const entries = Object.entries(COLLECTION_LIMITS);
        const settled = await Promise.allSettled(
          entries.map(([resource, limit]) =>
            listPublicResource(resource, { limit, offset: 0 }, { signal: controller.signal })
          )
        );
        if (!active || controller.signal.aborted) return;
        const collections = {};
        settled.forEach((result, index) => {
          const resource = entries[index][0];
          collections[resource] = result.status === "fulfilled" ? listFromResult(result.value) : [];
        });
        setState({ loading: false, error: "", bootstrap: bootstrap || {}, collections });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState({
          loading: false,
          error: publicWebsiteErrorMessage(error),
          bootstrap: null,
          collections: {},
        });
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return state;
}

function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <div className="c1h-section-heading">
      <div>
        {eyebrow ? <span className="pw-eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

function PublishedPageSections({ sections = [] }) {
  const visible = sections.filter((section) => section.type !== "hero");
  if (visible.length === 0) return null;
  return (
    <div className="c1h-governed-sections" aria-label="Published homepage content">
      {visible.map((section) => (
        <section
          key={section.key}
          className={`c1h-governed-section c1h-section-${section.type || "text"}`}
          style={section.background_media?.url ? {
            backgroundImage: `linear-gradient(rgba(4,20,39,.88),rgba(7,35,67,.84)),url(${section.background_media.url})`,
          } : undefined}
        >
          <div>
            {section.heading ? <h2>{section.heading}</h2> : null}
            {section.subheading ? <p className="c1h-section-subheading">{section.subheading}</p> : null}
            <StructuredContent value={section.content} />
          </div>
          <PublishedMedia media={section.primary_media} />
        </section>
      ))}
    </div>
  );
}

function NewsTicker({ items }) {
  if (items.length === 0) return null;
  const tickerItems = items.slice(0, 5);
  return (
    <section className="c1h-news-ticker" aria-label="Latest published news">
      <div className="c1h-news-ticker-label"><span>LIVE</span> Latest</div>
      <div className="c1h-news-ticker-window">
        <div className="c1h-news-ticker-track">
          {[...tickerItems, ...tickerItems].map((item, index) => (
            <Link
              to={`${PUBLIC_ROOT}/news/${item.slug}`}
              key={`${item.key || item.slug}-${index}`}
              aria-hidden={index >= tickerItems.length ? "true" : undefined}
              tabIndex={index >= tickerItems.length ? -1 : undefined}
            >
              <b>{item.category?.name || "News"}</b>
              <span>{item.title}</span>
              <time>{formatDate(item.published_at)}</time>
            </Link>
          ))}
        </div>
      </div>
      <Link className="c1h-ticker-all" to={`${PUBLIC_ROOT}/news`}>All news</Link>
    </section>
  );
}

function LeadershipSpotlight({ items }) {
  const leader = items[0];
  if (!leader) return null;
  const media = leader.portrait || leader.media;
  return (
    <section className="c1h-leadership">
      <div className="c1h-leadership-copy">
        <span className="pw-eyebrow">Leadership</span>
        <h2>Leadership with operational responsibility</h2>
        <p>Meet the people accountable for governance, customer service and delivery across the group.</p>
        <div className="c1h-leader-name">
          <strong>{leader.full_name || leader.name}</strong>
          <span>{leader.position || leader.position_title || "Leadership"}</span>
        </div>
        {leader.professional_summary ? <p>{leader.professional_summary}</p> : null}
        <Link className="pw-button pw-button-secondary" to={`${PUBLIC_ROOT}/leadership`}>Meet our leadership</Link>
      </div>
      <div className="c1h-leadership-media">
        {media?.url ? <PublishedMedia media={media} /> : <div className="c1h-leader-monogram" aria-hidden="true">{String(leader.full_name || leader.name || "C").charAt(0)}</div>}
      </div>
    </section>
  );
}

function ProjectGrid({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="c1h-section">
      <SectionHeading
        eyebrow="Projects"
        title="Work you can see"
        description="Published projects and operational delivery across CHALIN ONE businesses."
        action={<Link className="c1h-text-link" to={`${PUBLIC_ROOT}/projects`}>View all projects →</Link>}
      />
      <div className="c1h-project-grid">
        {items.slice(0, 3).map((item, index) => (
          <Link className={`c1h-project-card c1h-project-card-${index + 1}`} to={`${PUBLIC_ROOT}/projects/${item.slug}`} key={item.key || item.slug}>
            <PublishedMedia media={item.media} />
            <div>
              <span>{item.division?.name || humanize(item.status || item.operational_status || "Project")}</span>
              <h3>{item.title}</h3>
              <p>{item.summary || item.location || item.location_text || ""}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EquipmentGrid({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="c1h-section c1h-equipment-section">
      <SectionHeading
        eyebrow="Equipment"
        title="Equipment ready for business"
        description="Published equipment available for sale, hire or structured finance."
        action={<Link className="c1h-text-link" to={`${PUBLIC_ROOT}/equipment`}>Explore catalogue →</Link>}
      />
      <div className="c1h-equipment-grid">
        {items.slice(0, 4).map((item) => {
          const money = formatMoney(item.price);
          return (
            <Link className="c1h-equipment-card" to={`${PUBLIC_ROOT}/equipment/${item.slug}`} key={item.key || item.slug}>
              <PublishedMedia media={item.media} />
              <div>
                <span className="c1h-kicker">{item.category || item.manufacturer || "Equipment"}</span>
                <h3>{item.name}</h3>
                <p>{item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ")}</p>
                <div className="c1h-equipment-meta">
                  <span>{humanize(item.availability || item.availability_status || "Published")}</span>
                  {money ? <strong>{money}</strong> : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function LocationStrip({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="c1h-section">
      <SectionHeading
        eyebrow="Where we work"
        title="Find CHALIN ONE"
        description="Published offices, yards, sites and operating locations."
        action={<Link className="c1h-text-link" to={`${PUBLIC_ROOT}/locations`}>All locations →</Link>}
      />
      <div className="c1h-location-grid">
        {items.slice(0, 3).map((item) => (
          <article key={item.key || item.name}>
            <span aria-hidden="true">⌖</span>
            <div>
              <h3>{item.name}</h3>
              <p>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</p>
              {item.phone ? <PublicLink target={`tel:${item.phone}`}>{item.phone}</PublicLink> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function PublicHomepageExperience({ page }) {
  const request = useHomepageData();
  const [menuOpen, setMenuOpen] = useState(false);
  const bootstrap = request.bootstrap || {};
  const settings = bootstrap.settings || {};
  const siteName = settingValue(settings, "site.name", "CHALIN ONE");
  const tagline = settingValue(settings, "site.tagline", page?.subtitle || "Integrated business solutions");
  const description = page?.summary || settingValue(settings, "site.description", "Equipment, mining, hire, finance and operational support.");
  const collections = request.collections || {};
  const news = collections.news || [];
  const leadership = collections.leadership || [];
  const projects = collections.projects || [];
  const equipment = collections.equipment || [];
  const locations = collections.locations || [];
  const heroMedia = page?.media;

  const divisions = useMemo(() => (bootstrap.divisions || []).slice(0, 6), [bootstrap.divisions]);
  const statistics = useMemo(() => (bootstrap.statistics || []).slice(0, 4), [bootstrap.statistics]);
  useHomepageMetadata(page, siteName);

  if (request.loading) {
    return <main className="pw-unavailable" role="status" aria-live="polite"><div><img className="c1h-loading-logo" src="/chalin03-logo.png" alt="" /><h1>Opening CHALIN ONE…</h1><p>Loading the latest approved public information.</p></div></main>;
  }
  if (request.error) {
    return <main className="pw-unavailable" role="alert"><div><span className="pw-brand-mark" aria-hidden="true">C1</span><h1>Homepage unavailable</h1><p>{request.error}</p></div></main>;
  }

  return (
    <div className="pw-shell c1h-shell">
      {(bootstrap.announcements || []).slice(0, 2).map((announcement) => (
        <div className={`pw-announcement pw-announcement-${announcement.style || "info"}`} key={announcement.key}>
          <div><strong>{announcement.title}</strong><span>{announcement.body}</span></div>
          {announcement.link_url ? <PublicLink target={announcement.link_url}>{announcement.link_label || "Learn more"}</PublicLink> : null}
        </div>
      ))}

      <header className="pw-header c1h-header">
        <Link className="pw-brand c1h-brand" to={PUBLIC_ROOT} aria-label={`${siteName} homepage`}>
          <img src="/chalin03-logo.png" alt="" className="c1h-brand-logo" />
          <span><strong>{siteName}</strong><small>{tagline}</small></span>
        </Link>
        <button
          type="button"
          className="pw-menu-button"
          aria-expanded={menuOpen}
          aria-controls="public-website-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span /><span /><b>Menu</b>
        </button>
        <PublicNavigation items={bootstrap.navigation || []} menuOpen={menuOpen} onMenuClose={() => setMenuOpen(false)} />
        <Link className="c1h-staff-link" to="/login">Staff portal</Link>
      </header>

      <main className="c1h-main">
        <section className={`c1h-hero${heroMedia?.url ? " c1h-hero-has-media" : ""}`}>
          {heroMedia?.url && heroMedia.media_type === "image" ? (
            <div className="c1h-hero-background" style={{ backgroundImage: `linear-gradient(90deg,rgba(3,18,35,.95) 0%,rgba(3,18,35,.72) 54%,rgba(3,18,35,.25) 100%),url(${heroMedia.url})` }} aria-hidden="true" />
          ) : null}
          <div className="c1h-hero-content">
            <span className="pw-eyebrow">CHALIN 03 COMPANY LIMITED</span>
            <h1>{page?.title || tagline}</h1>
            {page?.subtitle ? <h2>{page.subtitle}</h2> : null}
            <p>{description}</p>
            <div className="pw-actions">
              <Link className="pw-button pw-button-primary" to={`${PUBLIC_ROOT}/equipment`}>Explore equipment</Link>
              <Link className="pw-button pw-button-secondary" to={`${PUBLIC_ROOT}/forms/contact`}>Contact the company</Link>
            </div>
            <div className="c1h-hero-proof">
              <span><b>01</b> Equipment</span>
              <span><b>02</b> Mining</span>
              <span><b>03</b> Hire & Finance</span>
            </div>
          </div>
          {!heroMedia?.url ? (
            <div className="c1h-hero-brand-panel">
              <img src="/chalin03-logo.png" alt="" />
              <span>One governed business platform</span>
              <strong>{siteName}</strong>
              <p>Published information is reviewed, approved and version controlled before public release.</p>
            </div>
          ) : null}
        </section>

        <NewsTicker items={news} />

        {statistics.length > 0 ? (
          <section className="c1h-stat-grid" aria-label="Company statistics">
            {statistics.map((statistic) => (
              <article key={statistic.key}>
                <strong>{statistic.prefix}{statistic.display_value}{statistic.suffix}</strong>
                <span>{statistic.label}</span>
                {statistic.source_note ? <small>{statistic.source_note}</small> : null}
              </article>
            ))}
          </section>
        ) : null}

        {divisions.length > 0 ? (
          <section className="c1h-section">
            <SectionHeading eyebrow="Our businesses" title="One group. Specialist operations." description="Explore the published divisions delivering equipment, mining, commercial and operational services." action={<Link className="c1h-text-link" to={`${PUBLIC_ROOT}/divisions`}>Explore divisions →</Link>} />
            <div className="c1h-division-grid">
              {divisions.map((division, index) => (
                <Link className="c1h-division-card" to={`${PUBLIC_ROOT}/divisions/${division.slug}`} key={division.key || division.slug}>
                  <span className="c1h-division-number">0{index + 1}</span>
                  <PublishedMedia media={division.media} />
                  <div><h3>{division.name}</h3><p>{division.short_description}</p><span className="c1h-text-link">Explore →</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <LeadershipSpotlight items={leadership} />
        <ProjectGrid items={projects} />
        <EquipmentGrid items={equipment} />
        <PublishedPageSections sections={page?.sections || []} />
        <LocationStrip items={locations} />

        <section className="c1h-final-cta">
          <div>
            <span className="pw-eyebrow">Start a conversation</span>
            <h2>Need equipment, operational support or commercial information?</h2>
            <p>Use the governed public enquiry channel or explore current published opportunities.</p>
          </div>
          <div className="pw-actions">
            <Link className="pw-button pw-button-secondary" to={`${PUBLIC_ROOT}/forms/contact`}>Contact CHALIN ONE</Link>
            <Link className="pw-button pw-button-primary" to={`${PUBLIC_ROOT}/tenders`}>View tenders</Link>
          </div>
        </section>
      </main>

      <footer className="pw-footer c1h-footer">
        <div className="c1h-footer-brand"><img src="/chalin03-logo.png" alt="" /><div><strong>{siteName}</strong><p>{settingValue(settings, "site.description", tagline)}</p></div></div>
        <nav aria-label="Footer navigation">
          <PublicFooterNavigation items={bootstrap.navigation || []} />
          <Link to={`${PUBLIC_ROOT}/locations`}>Locations</Link>
          <Link to={`${PUBLIC_ROOT}/vacancies`}>Careers</Link>
          <Link to="/login">Staff sign in</Link>
        </nav>
        <small>Published information is controlled through CHALIN ONE Content Studio.</small>
      </footer>
    </div>
  );
}
