import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { listPublicResource } from "./publicWebsiteApi";
import "./publicVisualSections.css";

const COLLECTION_RESOURCES = Object.freeze({
  divisions: "divisions",
  leadership: "leadership",
  projects: "projects",
  equipment: "equipment",
  news: "news",
});

const SAFE_THEMES = new Set(["light", "dark", "paper", "accent"]);
const SAFE_LAYOUTS = new Set([
  "contained",
  "wide",
  "full",
  "split",
  "cards",
  "rail",
  "band",
  "metrics",
  "accordion",
  "grid",
]);

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sectionType(section) {
  return String(section?.type || section?.section_type || "custom").trim().toLowerCase();
}

function mediaUrl(media) {
  return String(media?.url || media?.public_url || "").trim();
}

function safeActionUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeTheme(value) {
  const theme = String(value || "light").toLowerCase();
  return SAFE_THEMES.has(theme) ? theme : "light";
}

function safeLayout(value) {
  const layout = String(value || "contained").toLowerCase();
  return SAFE_LAYOUTS.has(layout) ? layout : "contained";
}

function ActionLink({ to, children, className = "" }) {
  const safe = safeActionUrl(to);
  if (!safe) return null;
  if (safe.startsWith("/")) {
    return <Link className={className} to={safe}>{children}</Link>;
  }
  return <a className={className} href={safe} target="_blank" rel="noreferrer">{children}</a>;
}

function RichContent({ value, depth = 0 }) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number"].includes(typeof value)) return <p>{String(value)}</p>;
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="c1-vsr-rich-list">
        {value.map((item, index) => (
          <li key={typeof item === "string" ? `${item}-${index}` : index}>
            <RichContent value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([key, item]) => key !== "items" && item !== undefined && item !== null && item !== ""
    );
    return (
      <div className="c1-vsr-rich-object">
        {entries.map(([key, item]) => (
          <section key={key}>
            {key !== "text" && depth < 2 ? <h3>{humanize(key)}</h3> : null}
            <RichContent value={item} depth={depth + 1} />
          </section>
        ))}
      </div>
    );
  }
  return null;
}

function VisualMedia({ media, label = "Published CHALIN ONE media", background = false }) {
  const url = mediaUrl(media);
  if (!url) return null;
  const type = String(media?.media_type || "image").toLowerCase();
  if (type === "image") {
    if (background) {
      return (
        <div
          className="c1-vsr-background-media"
          style={{ backgroundImage: `url(${url})` }}
          role="img"
          aria-label={media?.alt_text || label}
        />
      );
    }
    return (
      <figure className="c1-vsr-media">
        <img src={url} alt={media?.alt_text || label} loading="lazy" decoding="async" />
        {media?.caption || media?.credit ? (
          <figcaption>{[media.caption, media.credit].filter(Boolean).join(" — ")}</figcaption>
        ) : null}
      </figure>
    );
  }
  const safe = safeActionUrl(url);
  return safe ? (
    <a className="c1-vsr-media-link" href={safe} target="_blank" rel="noreferrer">
      Open published {type === "video" ? "video" : "media"} ↗
    </a>
  ) : null;
}

function SectionHeading({ section, index, eyebrow }) {
  return (
    <header className="c1-vsr-heading">
      <span>{eyebrow || `${String(index + 1).padStart(2, "0")} / ${humanize(sectionType(section)).toUpperCase()}`}</span>
      {section.heading ? <h2>{section.heading}</h2> : null}
      {section.subheading ? <p>{section.subheading}</p> : null}
    </header>
  );
}

function collectionTitle(resource, item) {
  if (resource === "leadership") return item.full_name || item.name || "Leadership profile";
  if (resource === "equipment") return item.name || item.title || "Equipment";
  if (resource === "divisions") return item.name || item.title || "Business";
  return item.title || item.name || "Published record";
}

function collectionSummary(resource, item) {
  if (resource === "leadership") return item.position || item.position_title || item.professional_summary || "";
  if (resource === "equipment") return item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ");
  return item.excerpt || item.summary || item.short_description || item.description || "";
}

function collectionTarget(resource, item) {
  if (resource === "divisions" && item.slug) return `/businesses/${item.slug}`;
  if (resource === "leadership") return "/leadership";
  if (["projects", "equipment", "news"].includes(resource) && item.slug) return `/${resource}/${item.slug}`;
  return "";
}

function CollectionRail({ resource, items }) {
  if (!items.length) {
    return (
      <div className="c1-vsr-collection-empty">
        <span>PUBLICATION READY</span>
        <strong>No approved {humanize(resource).toLowerCase()} record is available for this section yet.</strong>
      </div>
    );
  }
  return (
    <div className="c1-vsr-collection-rail" aria-label={`Published ${resource}`}>
      {items.slice(0, 8).map((item, index) => {
        const target = collectionTarget(resource, item);
        const media = item.media || item.portrait;
        const card = (
          <>
            <div className="c1-vsr-card-media">
              {mediaUrl(media) ? <VisualMedia media={media} label={collectionTitle(resource, item)} /> : <span>{String(index + 1).padStart(2, "0")}</span>}
            </div>
            <div className="c1-vsr-card-copy">
              <small>{item.division?.name || item.category?.name || humanize(resource)}</small>
              <strong>{collectionTitle(resource, item)}</strong>
              {collectionSummary(resource, item) ? <p>{collectionSummary(resource, item)}</p> : null}
              {target ? <b>Open published record ↗</b> : null}
            </div>
          </>
        );
        return target ? (
          <Link className="c1-vsr-collection-card" to={target} key={item.key || item.slug || item.id || index}>{card}</Link>
        ) : (
          <article className="c1-vsr-collection-card" key={item.key || item.slug || item.id || index}>{card}</article>
        );
      })}
    </div>
  );
}

function StatisticsSection({ content }) {
  const items = Array.isArray(content.items) ? content.items : [];
  if (!items.length) return null;
  return (
    <div className="c1-vsr-metrics">
      {items.slice(0, 8).map((item, index) => (
        <article key={`${item.label || "metric"}-${index}`}>
          <strong>{item.value || "—"}</strong>
          <span>{item.label || "Metric"}</span>
          {item.note ? <small>{item.note}</small> : null}
        </article>
      ))}
    </div>
  );
}

function TestimonialsSection({ content }) {
  const items = Array.isArray(content.items) ? content.items : [];
  if (!items.length) return null;
  return (
    <div className="c1-vsr-testimonials">
      {items.slice(0, 6).map((item, index) => (
        <blockquote key={`${item.name || "quote"}-${index}`}>
          <span>“</span>
          <p>{item.quote || ""}</p>
          <footer>
            <strong>{item.name || "Published voice"}</strong>
            {item.role ? <small>{item.role}</small> : null}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}

function FaqSection({ content }) {
  const items = Array.isArray(content.items) ? content.items : [];
  if (!items.length) return null;
  return (
    <div className="c1-vsr-faqs">
      {items.slice(0, 12).map((item, index) => (
        <details key={`${item.question || "question"}-${index}`}>
          <summary>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{item.question || "Question"}</strong>
            <b>+</b>
          </summary>
          <p>{item.answer || ""}</p>
        </details>
      ))}
    </div>
  );
}

function ActionBand({ content, contact = false }) {
  const primaryLabel = content.primary_label || content.action_label || content.link_label || (contact ? "Contact CHALIN ONE" : "Continue");
  const primaryUrl = content.primary_url || content.action_url || content.link_url || (contact ? "/contact" : "");
  return (
    <div className="c1-vsr-actions">
      <ActionLink className="c1-vsr-action-primary" to={primaryUrl}>{primaryLabel} ↗</ActionLink>
      {content.secondary_label ? (
        <ActionLink className="c1-vsr-action-secondary" to={content.secondary_url}>{content.secondary_label}</ActionLink>
      ) : null}
    </div>
  );
}

function PublicVisualSection({ section, index, collections }) {
  const type = sectionType(section);
  const content = normalizeObject(section.content || section.content_json);
  const settings = normalizeObject(section.settings || section.settings_json);
  const theme = safeTheme(settings.theme);
  const layout = safeLayout(settings.layout);
  const primaryMedia = section.primary_media || null;
  const backgroundMedia = section.background_media || null;
  const collectionResource = COLLECTION_RESOURCES[type];
  const className = `c1-vsr-section is-${type} theme-${theme} layout-${layout}`;

  if (type === "statistics") {
    return (
      <section className={className}>
        <div className="c1-vsr-inner">
          <SectionHeading section={section} index={index} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <StatisticsSection content={content} />
        </div>
      </section>
    );
  }

  if (type === "testimonials") {
    return (
      <section className={className}>
        <div className="c1-vsr-inner">
          <SectionHeading section={section} index={index} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <TestimonialsSection content={content} />
        </div>
      </section>
    );
  }

  if (type === "faq") {
    return (
      <section className={className}>
        <div className="c1-vsr-inner">
          <SectionHeading section={section} index={index} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <FaqSection content={content} />
        </div>
      </section>
    );
  }

  if (collectionResource) {
    return (
      <section className={className}>
        <div className="c1-vsr-inner">
          <SectionHeading section={section} index={index} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <CollectionRail resource={collectionResource} items={collections[collectionResource] || []} />
        </div>
      </section>
    );
  }

  if (type === "cta" || type === "contact") {
    return (
      <section className={className}>
        {backgroundMedia ? <VisualMedia media={backgroundMedia} background label={section.heading || "CHALIN ONE action"} /> : null}
        <div className="c1-vsr-shade" />
        <div className="c1-vsr-inner c1-vsr-action-band">
          <SectionHeading section={section} index={index} eyebrow={content.eyebrow} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <ActionBand content={content} contact={type === "contact"} />
        </div>
      </section>
    );
  }

  if (type === "form") {
    const key = String(content.form_key || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
    return (
      <section className={className}>
        <div className="c1-vsr-inner c1-vsr-form-placement">
          <div>
            <SectionHeading section={section} index={index} />
            {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          </div>
          {key ? <Link className="c1-vsr-form-card" to={`/forms/${key}`}><span>GOVERNED FORM</span><strong>{key}</strong><b>Open form ↗</b></Link> : <div className="c1-vsr-form-card is-empty"><span>FORM PLACEMENT</span><strong>No published form key configured.</strong></div>}
        </div>
      </section>
    );
  }

  if (type === "hero") {
    return (
      <section className={className}>
        {backgroundMedia || primaryMedia ? <VisualMedia media={backgroundMedia || primaryMedia} background label={section.heading || "CHALIN ONE visual stage"} /> : null}
        <div className="c1-vsr-shade" />
        <div className="c1-vsr-inner c1-vsr-hero-copy">
          <SectionHeading section={section} index={index} eyebrow={content.eyebrow} />
          {content.text ? <p className="c1-vsr-intro">{content.text}</p> : null}
          <ActionBand content={content} />
        </div>
      </section>
    );
  }

  if (["image", "video", "gallery"].includes(type)) {
    return (
      <section className={className}>
        <div className="c1-vsr-inner">
          <SectionHeading section={section} index={index} />
          <div className="c1-vsr-media-feature">
            <VisualMedia media={primaryMedia || backgroundMedia} label={section.heading || humanize(type)} />
            <div>
              {content.text ? <p>{content.text}</p> : null}
              {content.caption ? <small>{content.caption}</small> : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const split = type === "split" || layout === "split";
  return (
    <section className={className}>
      <div className={`c1-vsr-inner${split ? " c1-vsr-split" : ""}`}>
        <div>
          <SectionHeading section={section} index={index} eyebrow={content.eyebrow} />
          <RichContent value={content} />
          {type === "split" && content.link_label ? <ActionLink className="c1-vsr-inline-link" to={content.link_url}>{content.link_label} ↗</ActionLink> : null}
        </div>
        {split && (primaryMedia || backgroundMedia) ? <VisualMedia media={primaryMedia || backgroundMedia} label={section.heading || "Published section media"} /> : null}
      </div>
    </section>
  );
}

export default function PublicVisualSections({ sections = [], excludeTypes = [], seedCollections = {} }) {
  const visibleSections = useMemo(() => {
    const excluded = new Set(excludeTypes.map((value) => String(value).toLowerCase()));
    return (Array.isArray(sections) ? sections : [])
      .filter((section) => section?.is_enabled !== false)
      .filter((section) => !excluded.has(sectionType(section)));
  }, [excludeTypes, sections]);

  const requiredResources = useMemo(
    () => [...new Set(visibleSections.map((section) => COLLECTION_RESOURCES[sectionType(section)]).filter(Boolean))],
    [visibleSections]
  );
  const requiredKey = requiredResources.join("|");
  const [loadedCollections, setLoadedCollections] = useState({});

  useEffect(() => {
    const missing = requiredResources.filter((resource) => !Array.isArray(seedCollections?.[resource]));
    if (!missing.length) {
      setLoadedCollections({});
      return undefined;
    }
    const controller = new AbortController();
    Promise.allSettled(
      missing.map((resource) => listPublicResource(resource, { limit: 12, offset: 0 }, { signal: controller.signal }))
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next = {};
      missing.forEach((resource, index) => {
        next[resource] = results[index]?.status === "fulfilled" ? listFromResult(results[index].value) : [];
      });
      setLoadedCollections(next);
    });
    return () => controller.abort();
  }, [requiredKey, seedCollections]);

  if (!visibleSections.length) return null;
  const collections = { ...loadedCollections, ...seedCollections };

  return (
    <div className="c1-vsr-stack" aria-label="Published governed page sections">
      {visibleSections.map((section, index) => (
        <PublicVisualSection
          section={section}
          index={index}
          collections={collections}
          key={section.key || section.section_key || `${sectionType(section)}-${index}`}
        />
      ))}
    </div>
  );
}
