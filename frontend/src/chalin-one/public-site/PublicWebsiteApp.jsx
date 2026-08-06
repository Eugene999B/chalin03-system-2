import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  Outlet,
  Route,
  Routes,
  useParams,
} from "react-router";
import {
  getPublicBootstrap,
  getPublicForm,
  getPublicPage,
  getPublicResource,
  listPublicResource,
  publicWebsiteErrorMessage,
  submitPublicForm,
} from "./publicWebsiteApi";
import {
  PublicFooterNavigation,
  PublicNavigation,
} from "./PublicNavigation";
import "./publicWebsite.css";

const PUBLIC_ROOT = "/website";
const PublicWebsiteContext = createContext(null);

const COLLECTION_CONFIG = Object.freeze({
  news: {
    eyebrow: "Newsroom",
    title: "Latest news",
    description: "Published company news, updates and operational stories.",
    detail: true,
    label(item) {
      return item.title || "News article";
    },
    summary(item) {
      return item.excerpt || item.summary || "";
    },
  },
  divisions: {
    eyebrow: "CHALIN ONE",
    title: "Business divisions",
    description: "Explore the specialist businesses operating across the group.",
    detail: true,
    label(item) {
      return item.name || "Business division";
    },
    summary(item) {
      return item.short_description || "";
    },
  },
  leadership: {
    eyebrow: "Company",
    title: "Leadership",
    description: "Meet the professionals responsible for governance and delivery.",
    detail: false,
    label(item) {
      return item.full_name || item.name || "Leadership profile";
    },
    summary(item) {
      return item.position || item.position_title || item.professional_summary || "";
    },
  },
  projects: {
    eyebrow: "Delivery",
    title: "Projects",
    description: "Current and completed work across our operating divisions.",
    detail: true,
    label(item) {
      return item.title || "Project";
    },
    summary(item) {
      return item.summary || item.location || "";
    },
  },
  equipment: {
    eyebrow: "Equipment",
    title: "Public equipment catalogue",
    description: "Equipment available for sale, hire or structured finance.",
    detail: true,
    label(item) {
      return item.name || "Equipment";
    },
    summary(item) {
      return item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ");
    },
  },
  locations: {
    eyebrow: "Company",
    title: "Locations",
    description: "Find our offices, yards, sites and operating locations.",
    detail: false,
    label(item) {
      return item.name || "Location";
    },
    summary(item) {
      return [item.address, item.city, item.region, item.country]
        .filter(Boolean)
        .join(", ");
    },
  },
  vacancies: {
    eyebrow: "Careers",
    title: "Current vacancies",
    description: "Published opportunities to join the CHALIN ONE team.",
    detail: true,
    label(item) {
      return item.title || "Vacancy";
    },
    summary(item) {
      return item.summary || item.employment_type || "";
    },
  },
  tenders: {
    eyebrow: "Procurement",
    title: "Open tenders",
    description: "Published procurement opportunities and submission information.",
    detail: true,
    label(item) {
      return item.title || "Tender";
    },
    summary(item) {
      return item.summary || item.reference_number || "";
    },
  },
  testimonials: {
    eyebrow: "Customers",
    title: "Testimonials",
    description: "Published customer experiences and verified feedback.",
    detail: false,
    label(item) {
      return item.customer_name || item.name || "Customer";
    },
    summary(item) {
      return item.quote || item.quote_text || "";
    },
  },
});

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function settingValue(settings, key, fallback = "") {
  const value = settings?.[key];
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    return String(value.text || value.name || value.label || value.value || fallback);
  }
  return fallback;
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^(mailto:|tel:)/i.test(raw) && !/\s/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publicPath(rawValue) {
  const raw = String(rawValue || "").trim();
  const external = safeExternalUrl(raw);
  if (external) return { external: true, href: external };
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  const [pathname, suffix = ""] = raw.split(/(?=[?#])/);
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  if (!clean) return { external: false, href: PUBLIC_ROOT };
  if (clean.startsWith("website/")) {
    return { external: false, href: `/${clean}${suffix}` };
  }

  const first = clean.split("/")[0];
  const directResources = new Set([
    "news",
    "divisions",
    "leadership",
    "projects",
    "equipment",
    "locations",
    "faqs",
    "vacancies",
    "tenders",
    "testimonials",
    "forms",
  ]);
  const target = directResources.has(first)
    ? `${PUBLIC_ROOT}/${clean}`
    : `${PUBLIC_ROOT}/pages/${clean}`;
  return { external: false, href: `${target}${suffix}` };
}

function formatPublicMoney(price) {
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

function formatPublicDate(value, includeTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return includeTime
    ? date.toLocaleString("en-GH")
    : date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function usePublicRequest(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");

    Promise.resolve(loader(controller.signal))
      .then((value) => {
        if (active && !controller.signal.aborted) setData(value);
      })
      .catch((requestError) => {
        if (active && !controller.signal.aborted) {
          setError(publicWebsiteErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, dependencies);

  return { data, loading, error };
}

function useDocumentMetadata(title, description = "") {
  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") || "";
    if (title) document.title = title;
    if (meta && description) meta.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      if (meta) meta.setAttribute("content", previousDescription);
    };
  }, [description, title]);
}

function PublicState({ loading, error, empty, children }) {
  if (loading) {
    return <div className="pw-state" role="status">Loading published information…</div>;
  }
  if (error) {
    return <div className="pw-state pw-state-error" role="alert"><strong>Information unavailable</strong><span>{error}</span></div>;
  }
  if (empty) {
    return <div className="pw-state"><strong>No published information yet</strong><span>This area will appear when approved content is published.</span></div>;
  }
  return children;
}

function PublicMedia({ media, className = "" }) {
  if (!media?.url) return null;
  if (media.media_type === "image") {
    return (
      <figure className={`pw-media ${className}`.trim()}>
        <img
          src={media.url}
          alt={media.alt_text || "Published CHALIN ONE media"}
          width={media.width || undefined}
          height={media.height || undefined}
          loading="lazy"
          decoding="async"
        />
        {media.caption || media.credit ? (
          <figcaption>{[media.caption, media.credit].filter(Boolean).join(" — ")}</figcaption>
        ) : null}
      </figure>
    );
  }
  const label =
    media.media_type === "document"
      ? media.original_name || "Open published document"
      : "Open published video";
  return (
    <a className="pw-video-link" href={media.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function StructuredContent({ value, depth = 0 }) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number"].includes(typeof value)) {
    return <p>{String(value)}</p>;
  }
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="pw-structured-list">
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
      <div className="pw-structured-object">
        {Object.entries(value)
          .filter(([, item]) => item !== undefined && item !== null && item !== "")
          .map(([key, item]) => (
            <section key={key}>
              {depth < 3 ? <h4>{humanize(key)}</h4> : null}
              <StructuredContent value={item} depth={depth + 1} />
            </section>
          ))}
      </div>
    );
  }
  return null;
}

function PublicLink({ target, children, className = "" }) {
  const descriptor = publicPath(target);
  if (!descriptor) return <span className={className}>{children}</span>;
  if (descriptor.external) {
    return <a className={className} href={descriptor.href} target={descriptor.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{children}</a>;
  }
  return <Link className={className} to={descriptor.href}>{children}</Link>;
}

function PublicWebsiteLayout() {
  const request = usePublicRequest(
    (signal) => getPublicBootstrap({ signal }),
    []
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const bootstrap = request.data || {};
  const settings = bootstrap.settings || {};
  const navigation = bootstrap.navigation || [];
  const siteName = settingValue(settings, "site.name", "CHALIN ONE");
  const tagline = settingValue(
    settings,
    "site.tagline",
    "Integrated equipment, mining and commercial solutions"
  );

  useDocumentMetadata(siteName, settingValue(settings, "site.description", tagline));

  return (
    <PublicWebsiteContext.Provider value={{ ...bootstrap, loading: request.loading, error: request.error }}>
      <div className="pw-shell">
        {(bootstrap.announcements || []).slice(0, 2).map((announcement) => (
          <div className={`pw-announcement pw-announcement-${announcement.style || "info"}`} key={announcement.key}>
            <div><strong>{announcement.title}</strong><span>{announcement.body}</span></div>
            {announcement.link_url ? <PublicLink target={announcement.link_url}>{announcement.link_label || "Learn more"}</PublicLink> : null}
          </div>
        ))}

        <header className="pw-header">
          <Link className="pw-brand" to={PUBLIC_ROOT} aria-label={`${siteName} homepage`}>
            <span className="pw-brand-mark" aria-hidden="true">C1</span>
            <span><strong>{siteName}</strong><small>{tagline}</small></span>
          </Link>
          <button
            type="button"
            className="pw-menu-button"
            aria-expanded={menuOpen}
            aria-controls="public-website-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
            <b>Menu</b>
          </button>
          <PublicNavigation
            items={navigation}
            menuOpen={menuOpen}
            onMenuClose={() => setMenuOpen(false)}
          />
        </header>

        <main className="pw-main">
          <PublicState loading={request.loading} error={request.error}>
            <Outlet />
          </PublicState>
        </main>

        <footer className="pw-footer">
          <div><strong>{siteName}</strong><p>{settingValue(settings, "site.description", tagline)}</p></div>
          <nav aria-label="Footer navigation">
            <PublicFooterNavigation items={navigation} />
            <Link to={`${PUBLIC_ROOT}/locations`}>Locations</Link>
            <Link to={`${PUBLIC_ROOT}/vacancies`}>Careers</Link>
            <Link to="/login">Staff sign in</Link>
          </nav>
          <small>Published information is controlled through CHALIN ONE Content Studio.</small>
        </footer>
      </div>
    </PublicWebsiteContext.Provider>
  );
}

function usePublicWebsite() {
  return useContext(PublicWebsiteContext) || {};
}

function PublicHomePage() {
  const { settings = {}, divisions = [], statistics = [] } = usePublicWebsite();
  const siteName = settingValue(settings, "site.name", "CHALIN ONE");
  const tagline = settingValue(settings, "site.tagline", "Professional solutions for demanding operations");
  const description = settingValue(settings, "site.description", "A unified group delivering equipment, mining, hire, finance and operational support.");

  return (
    <>
      <section className="pw-hero">
        <div>
          <span className="pw-eyebrow">CHALIN ONE GROUP</span>
          <h1>{tagline}</h1>
          <p>{description}</p>
          <div className="pw-actions">
            <Link className="pw-button pw-button-primary" to={`${PUBLIC_ROOT}/equipment`}>Explore equipment</Link>
            <Link className="pw-button pw-button-secondary" to={`${PUBLIC_ROOT}/projects`}>View projects</Link>
          </div>
        </div>
        <div className="pw-hero-card">
          <span>One governed public platform</span>
          <strong>{siteName}</strong>
          <p>Published content is reviewed, approved and version controlled before public release.</p>
        </div>
      </section>

      {statistics.length > 0 ? (
        <section className="pw-stat-grid" aria-label="Company statistics">
          {statistics.map((statistic) => (
            <article key={statistic.key}>
              <strong>{statistic.prefix}{statistic.display_value}{statistic.suffix}</strong>
              <span>{statistic.label}</span>
              {statistic.source_note ? <small>{statistic.source_note}</small> : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="pw-section">
        <div className="pw-section-heading"><span className="pw-eyebrow">Our businesses</span><h2>Built around operational delivery</h2><p>Each division operates with its own specialist capabilities while sharing group governance and customer service.</p></div>
        <div className="pw-card-grid">
          {divisions.slice(0, 6).map((division) => (
            <article className="pw-card" key={division.key}>
              <PublicMedia media={division.media} />
              <div><h3>{division.name}</h3><p>{division.short_description}</p><Link to={`${PUBLIC_ROOT}/divisions/${division.slug}`}>Explore division</Link></div>
            </article>
          ))}
          {divisions.length === 0 ? <div className="pw-state"><span>Approved business division profiles will appear here.</span></div> : null}
        </div>
      </section>

      <section className="pw-callout">
        <div><span className="pw-eyebrow">Published opportunities</span><h2>Work with CHALIN ONE</h2><p>Review current equipment, careers, tenders and project information.</p></div>
        <div className="pw-actions"><Link className="pw-button pw-button-primary" to={`${PUBLIC_ROOT}/vacancies`}>Careers</Link><Link className="pw-button pw-button-secondary" to={`${PUBLIC_ROOT}/tenders`}>Tenders</Link></div>
      </section>
    </>
  );
}

function PublicCollectionPage({ resource }) {
  const config = COLLECTION_CONFIG[resource];
  const request = usePublicRequest(
    (signal) => listPublicResource(resource, { limit: 60, offset: 0 }, { signal }),
    [resource]
  );
  const items = listFromResult(request.data);
  useDocumentMetadata(`${config.title} | CHALIN ONE`, config.description);

  return (
    <section className="pw-section pw-page-section">
      <div className="pw-section-heading"><span className="pw-eyebrow">{config.eyebrow}</span><h1>{config.title}</h1><p>{config.description}</p></div>
      <PublicState loading={request.loading} error={request.error} empty={!request.loading && !request.error && items.length === 0}>
        <div className="pw-card-grid">
          {items.map((item, index) => {
            const money = formatPublicMoney(item.price);
            const status = item.status || item.availability;
            return (
              <article className="pw-card" key={item.key || item.slug || index}>
                <PublicMedia media={item.media || item.portrait || item.document} />
                <div>
                  {item.division?.name ? <span className="pw-card-kicker">{item.division.name}</span> : null}
                  <h2>{config.label(item)}</h2>
                  <p>{config.summary(item)}</p>
                  {status ? <span className="pw-card-kicker">{humanize(status)}</span> : null}
                  {money ? <strong>{money}</strong> : null}
                  {item.rating ? <span className="pw-rating" aria-label={`${item.rating} out of 5 stars`}>{"★".repeat(Math.max(0, Math.min(5, Number(item.rating))))}</span> : null}
                  {config.detail && item.slug ? <Link to={`${PUBLIC_ROOT}/${resource}/${item.slug}`}>View details</Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      </PublicState>
    </section>
  );
}

function PublicFaqPage() {
  const request = usePublicRequest(
    (signal) => listPublicResource("faqs", {}, { signal }),
    []
  );
  const items = listFromResult(request.data);
  useDocumentMetadata("Frequently asked questions | CHALIN ONE");
  return (
    <section className="pw-section pw-page-section">
      <div className="pw-section-heading"><span className="pw-eyebrow">Help</span><h1>Frequently asked questions</h1><p>Published answers to common customer and supplier questions.</p></div>
      <PublicState loading={request.loading} error={request.error} empty={!request.loading && !request.error && items.length === 0}>
        <div className="pw-faq-list">{items.map((item, index) => <details key={item.key || index}><summary>{item.question}</summary><StructuredContent value={item.answer} /></details>)}</div>
      </PublicState>
    </section>
  );
}

function PublicPageDetail() {
  const { slug } = useParams();
  const request = usePublicRequest((signal) => getPublicPage(slug, { signal }), [slug]);
  const page = request.data;
  useDocumentMetadata(page ? `${page.seo?.title || page.title} | CHALIN ONE` : "Page | CHALIN ONE", page?.seo?.description || "");

  return (
    <PublicState loading={request.loading} error={request.error} empty={!request.loading && !request.error && !page}>
      {page ? (
        <article className={`pw-detail pw-template-${page.template || "standard"}`}>
          <header className="pw-detail-header"><span className="pw-eyebrow">{humanize(page.page_type)}</span><h1>{page.title}</h1>{page.subtitle ? <h2>{page.subtitle}</h2> : null}{page.summary ? <p>{page.summary}</p> : null}<PublicMedia media={page.media} className="pw-detail-media" /></header>
          <StructuredContent value={page.body} />
          <div className="pw-page-sections">{(page.sections || []).map((section) => <section className={`pw-content-section pw-content-${section.type}`} key={section.key} style={section.background_media?.url ? { backgroundImage: `linear-gradient(rgba(7,26,51,.82),rgba(7,26,51,.82)),url(${section.background_media.url})` } : undefined}><div>{section.heading ? <h2>{section.heading}</h2> : null}{section.subheading ? <p className="pw-section-subheading">{section.subheading}</p> : null}<StructuredContent value={section.content} /></div><PublicMedia media={section.primary_media} /></section>)}</div>
        </article>
      ) : null}
    </PublicState>
  );
}

function PublicDetailContent({ item }) {
  const primary = item.body || item.details || item.description;
  return (
    <>
      <StructuredContent value={primary} />
      {item.specifications ? (
        <section>
          <h2>Specifications</h2>
          <StructuredContent value={item.specifications} />
        </section>
      ) : null}
      {item.features ? (
        <section>
          <h2>Features</h2>
          <StructuredContent value={item.features} />
        </section>
      ) : null}
      <StructuredContent value={item.requirements} />
      <StructuredContent value={item.application_instructions || item.submission_instructions} />
    </>
  );
}

function PublicDetailPage({ resource }) {
  const { slug } = useParams();
  const config = COLLECTION_CONFIG[resource];
  const request = usePublicRequest(
    (signal) => getPublicResource(resource, slug, { signal }),
    [resource, slug]
  );
  const item = request.data;
  const title = item ? config.label(item) : config.title;
  const location = item?.location?.name || item?.location || item?.location_text;
  const status = item?.status || item?.operational_status;
  const availability = item?.availability || item?.availability_status;
  const category =
    item?.category?.name ||
    (typeof item?.category === "string" ? item.category : "");
  const money = formatPublicMoney(item?.price);
  useDocumentMetadata(`${title} | CHALIN ONE`, item ? config.summary(item) : config.description);

  return (
    <PublicState loading={request.loading} error={request.error} empty={!request.loading && !request.error && !item}>
      {item ? (
        <article className="pw-detail">
          <header className="pw-detail-header"><span className="pw-eyebrow">{config.eyebrow}</span><h1>{config.label(item)}</h1>{config.summary(item) ? <p>{config.summary(item)}</p> : null}<PublicMedia media={item.media || item.document} className="pw-detail-media" /></header>
          <div className="pw-detail-grid">
            <div>
              <PublicDetailContent item={item} />
            </div>
            <aside className="pw-detail-aside">
              {item.division?.name ? <p><strong>Division</strong><span>{item.division.name}</span></p> : null}
              {category ? <p><strong>Category</strong><span>{category}</span></p> : null}
              {location ? <p><strong>Location</strong><span>{location}</span></p> : null}
              {status ? <p><strong>Status</strong><span>{humanize(status)}</span></p> : null}
              {availability ? <p><strong>Availability</strong><span>{humanize(availability)}</span></p> : null}
              {money ? <p><strong>Published price</strong><span>{money}</span></p> : null}
              {item.manufacturer ? <p><strong>Manufacturer</strong><span>{item.manufacturer}</span></p> : null}
              {item.model ? <p><strong>Model</strong><span>{item.model}</span></p> : null}
              {item.year ? <p><strong>Model year</strong><span>{item.year}</span></p> : null}
              {item.condition ? <p><strong>Condition</strong><span>{item.condition}</span></p> : null}
              {item.author ? <p><strong>Author</strong><span>{item.author}</span></p> : null}
              {formatPublicDate(item.published_at, true) ? <p><strong>Published</strong><span>{formatPublicDate(item.published_at, true)}</span></p> : null}
              {formatPublicDate(item.start_date) ? <p><strong>Starts</strong><span>{formatPublicDate(item.start_date)}</span></p> : null}
              {formatPublicDate(item.end_date) ? <p><strong>Ends</strong><span>{formatPublicDate(item.end_date)}</span></p> : null}
              {item.employment_type ? <p><strong>Employment type</strong><span>{item.employment_type}</span></p> : null}
              {item.vacancies_count ? <p><strong>Open positions</strong><span>{item.vacancies_count}</span></p> : null}
              {formatPublicDate(item.opens_at, true) ? <p><strong>Opens</strong><span>{formatPublicDate(item.opens_at, true)}</span></p> : null}
              {formatPublicDate(item.closes_at, true) ? <p><strong>Closes</strong><span>{formatPublicDate(item.closes_at, true)}</span></p> : null}
              {item.hire_available ? <p><strong>Hire</strong><span>Available</span></p> : null}
              {item.finance_available ? <p><strong>Finance</strong><span>Available</span></p> : null}
              {item.reference_number ? <p><strong>Reference</strong><span>{item.reference_number}</span></p> : null}
              {item.contact?.phone ? <p><strong>Phone</strong><PublicLink target={`tel:${item.contact.phone}`}>{item.contact.phone}</PublicLink></p> : null}
              {item.contact?.email ? <p><strong>Email</strong><PublicLink target={`mailto:${item.contact.email}`}>{item.contact.email}</PublicLink></p> : null}
              {item.application_url ? <PublicLink className="pw-button pw-button-primary" target={item.application_url}>Apply securely</PublicLink> : null}
              {item.document?.url ? <PublicLink className="pw-button pw-button-secondary" target={item.document.url}>Open tender document</PublicLink> : null}
            </aside>
          </div>
          {Array.isArray(item.gallery) && item.gallery.length > 0 ? <div className="pw-gallery">{item.gallery.map((media, index) => <PublicMedia media={media.media || media} key={media.asset_key || index} />)}</div> : null}
        </article>
      ) : null}
    </PublicState>
  );
}

function responseDefault(field) {
  if (["multiselect", "checkbox_group"].includes(field.type)) return [];
  if (["checkbox", "boolean"].includes(field.type)) return false;
  return "";
}

function PublicFormField({ field, value, onChange }) {
  const common = {
    id: `public-field-${field.key}`,
    name: field.key,
    required: field.required,
    disabled: false,
  };
  if (field.type === "textarea") {
    return <textarea {...common} rows="5" placeholder={field.placeholder} value={value || ""} maxLength={field.validation?.max_length || undefined} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.type === "select") {
    return <select {...common} value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (field.type === "multiselect") {
    return <select {...common} multiple value={Array.isArray(value) ? value : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (["radio", "checkbox_group"].includes(field.type)) {
    const values = Array.isArray(value) ? value : [];
    return <div className="pw-choice-grid">{(field.options || []).map((option) => <label key={option}><input type={field.type === "radio" ? "radio" : "checkbox"} name={field.key} value={option} checked={field.type === "radio" ? value === option : values.includes(option)} onChange={(event) => field.type === "radio" ? onChange(option) : onChange(event.target.checked ? [...values, option] : values.filter((item) => item !== option))} />{option}</label>)}</div>;
  }
  if (["checkbox", "boolean"].includes(field.type)) {
    return <label className="pw-checkbox"><input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{field.placeholder || "Yes"}</label>;
  }
  return <input {...common} type={field.type === "number" ? "number" : field.type} placeholder={field.placeholder} value={value ?? ""} maxLength={field.validation?.max_length || undefined} min={field.validation?.minimum ?? undefined} max={field.validation?.maximum ?? undefined} onChange={(event) => onChange(event.target.value)} />;
}

function PublicFormPage() {
  const { slug } = useParams();
  const request = usePublicRequest((signal) => getPublicForm(slug, { signal }), [slug]);
  const form = request.data;
  const [contact, setContact] = useState({ full_name: "", email: "", phone: "", company_name: "", consent_given: false, website: "" });
  const [responses, setResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!form) return;
    setResponses(Object.fromEntries((form.fields || []).map((field) => [field.key, responseDefault(field)])));
    setSuccess(null);
    setSubmitError("");
  }, [form]);
  useDocumentMetadata(form ? `${form.name} | CHALIN ONE` : "Public form | CHALIN ONE", form?.description || "");

  async function submit(event) {
    event.preventDefault();
    if (!form || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await submitPublicForm(form.slug, {
        ...contact,
        consent_text_version: form.settings?.consent_text_version || "privacy-v1",
        source_page_slug: form.slug,
        source_url: window.location.href,
        responses,
      });
      setSuccess(result);
    } catch (error) {
      setSubmitError(publicWebsiteErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PublicState loading={request.loading} error={request.error} empty={!request.loading && !request.error && !form}>
      {form ? (
        <section className="pw-form-page">
          <div className="pw-section-heading"><span className="pw-eyebrow">Secure public form</span><h1>{form.name}</h1><p>{form.description}</p></div>
          {success ? <div className="pw-form-success" role="status"><strong>Submission received</strong><p>{success.confirmation_message || form.confirmation_message}</p>{success.reference_code ? <span>Reference: {success.reference_code}</span> : null}</div> : (
            <form className="pw-form" onSubmit={submit}>
              {submitError ? <div className="pw-state pw-state-error" role="alert">{submitError}</div> : null}
              <div className="pw-form-grid">
                <label><span>Full name</span><input value={contact.full_name} onChange={(event) => setContact((current) => ({ ...current, full_name: event.target.value }))} /></label>
                <label><span>Email</span><input type="email" value={contact.email} onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))} /></label>
                <label><span>Phone</span><input type="tel" value={contact.phone} onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label><span>Company</span><input value={contact.company_name} onChange={(event) => setContact((current) => ({ ...current, company_name: event.target.value }))} /></label>
              </div>
              <label className="pw-honeypot" aria-hidden="true">Website<input tabIndex="-1" autoComplete="off" value={contact.website} onChange={(event) => setContact((current) => ({ ...current, website: event.target.value }))} /></label>
              {(form.fields || []).map((field) => <label className="pw-form-field" key={field.key} htmlFor={`public-field-${field.key}`}><span>{field.label}{field.required ? " *" : ""}</span><PublicFormField field={field} value={responses[field.key]} onChange={(value) => setResponses((current) => ({ ...current, [field.key]: value }))} />{field.help_text ? <small>{field.help_text}</small> : null}</label>)}
              {form.settings?.require_consent !== false ? <label className="pw-checkbox pw-consent"><input type="checkbox" required checked={contact.consent_given} onChange={(event) => setContact((current) => ({ ...current, consent_given: event.target.checked }))} />I consent to the use of this information for responding to my enquiry.</label> : null}
              <button className="pw-button pw-button-primary" type="submit" disabled={submitting}>{submitting ? "Submitting…" : form.settings?.submit_label || "Submit"}</button>
            </form>
          )}
        </section>
      ) : null}
    </PublicState>
  );
}

function PublicNotFound() {
  useDocumentMetadata("Page not found | CHALIN ONE");
  return <section className="pw-state pw-not-found" role="status" aria-live="polite"><h1>Published page not found</h1><span>The address may be incorrect or the content is not currently published.</span><Link className="pw-button pw-button-primary" to={PUBLIC_ROOT}>Return home</Link></section>;
}

export function PublicWebsiteUnavailable() {
  return <main className="pw-unavailable"><div><span className="pw-brand-mark" aria-hidden="true">C1</span><h1>Public website is not enabled</h1><p>This CHALIN ONE public experience remains safely disabled in this environment.</p><Link to="/login">Staff sign in</Link></div></main>;
}

export default function PublicWebsiteApp() {
  return (
    <Routes>
      <Route element={<PublicWebsiteLayout />}>
        <Route index element={<PublicHomePage />} />
        <Route path="pages/:slug" element={<PublicPageDetail />} />
        <Route path="news" element={<PublicCollectionPage resource="news" />} />
        <Route path="news/:slug" element={<PublicDetailPage resource="news" />} />
        <Route path="divisions" element={<PublicCollectionPage resource="divisions" />} />
        <Route path="divisions/:slug" element={<PublicDetailPage resource="divisions" />} />
        <Route path="leadership" element={<PublicCollectionPage resource="leadership" />} />
        <Route path="projects" element={<PublicCollectionPage resource="projects" />} />
        <Route path="projects/:slug" element={<PublicDetailPage resource="projects" />} />
        <Route path="equipment" element={<PublicCollectionPage resource="equipment" />} />
        <Route path="equipment/:slug" element={<PublicDetailPage resource="equipment" />} />
        <Route path="locations" element={<PublicCollectionPage resource="locations" />} />
        <Route path="faqs" element={<PublicFaqPage />} />
        <Route path="vacancies" element={<PublicCollectionPage resource="vacancies" />} />
        <Route path="vacancies/:slug" element={<PublicDetailPage resource="vacancies" />} />
        <Route path="tenders" element={<PublicCollectionPage resource="tenders" />} />
        <Route path="tenders/:slug" element={<PublicDetailPage resource="tenders" />} />
        <Route path="testimonials" element={<PublicCollectionPage resource="testimonials" />} />
        <Route path="forms/:slug" element={<PublicFormPage />} />
        <Route path="*" element={<PublicNotFound />} />
      </Route>
    </Routes>
  );
}
