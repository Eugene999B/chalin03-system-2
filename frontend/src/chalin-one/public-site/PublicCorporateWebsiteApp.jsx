import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import {
  getPublicBootstrap,
  getPublicForm,
  getPublicHomepage,
  getPublicPage,
  getPublicResource,
  listPublicResource,
  publicWebsiteErrorMessage,
  submitPublicForm,
} from "./publicWebsiteApi";
import "./publicWebsite.css";
import "./publicCorporateWebsite.css";

const CorporateContext = createContext(null);

const BUSINESS_FALLBACKS = Object.freeze([
  Object.freeze({
    slug: "spare-parts",
    name: "Spare Parts",
    label: "Parts · Sales · Inventory",
    description:
      "Professional spare-parts sales, stock control and customer support across CHALIN 03 operations.",
    number: "01",
    symbol: "SP",
  }),
  Object.freeze({
    slug: "mining",
    name: "Mining Operations",
    label: "Sites · Production · Control",
    description:
      "A dedicated operating environment for mining-site activity, production oversight, equipment and field control.",
    number: "02",
    symbol: "MO",
  }),
  Object.freeze({
    slug: "equipment",
    name: "Equipment Business",
    label: "Sales · Hire · Finance",
    description:
      "Equipment sales, hire, fleet operations and structured commercial services in one specialist business division.",
    number: "03",
    symbol: "EQ",
  }),
]);

const TOP_NAV = Object.freeze([
  { to: "/about", label: "About" },
  { to: "/businesses", label: "Businesses" },
  { to: "/projects", label: "Projects" },
  { to: "/equipment", label: "Equipment" },
  { to: "/news", label: "News" },
  { to: "/leadership", label: "Leadership" },
  { to: "/media", label: "Media" },
  { to: "/careers", label: "Careers" },
]);

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

function useRequest(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ loading: true, data: null, error: "" });

    Promise.resolve(loader(controller.signal))
      .then((data) => {
        if (active && !controller.signal.aborted) {
          setState({ loading: false, data, error: "" });
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setState({
            loading: false,
            data: null,
            error: publicWebsiteErrorMessage(error),
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, dependencies);

  return state;
}

function useMetadata(title, description = "") {
  useEffect(() => {
    const previousTitle = document.title;
    const descriptionNode = document.head.querySelector('meta[name="description"]');
    const previousDescription = descriptionNode?.getAttribute("content") || "";
    if (title) document.title = title;
    if (descriptionNode && description) descriptionNode.setAttribute("content", description);
    return () => {
      document.title = previousTitle;
      if (descriptionNode) descriptionNode.setAttribute("content", previousDescription);
    };
  }, [description, title]);
}

function CorporateMedia({ media, className = "", eager = false }) {
  if (!media?.url) return null;
  if (media.media_type === "image") {
    return (
      <figure className={`c1-media ${className}`.trim()}>
        <img
          src={media.url}
          alt={media.alt_text || "Published CHALIN ONE media"}
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
  return (
    <a className="c1-document-link" href={media.url} target="_blank" rel="noreferrer">
      Open published {media.media_type === "document" ? "document" : "video"} ↗
    </a>
  );
}

function StructuredContent({ value, depth = 0 }) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number"].includes(typeof value)) return <p>{String(value)}</p>;
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="c1-rich-list">
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
      <div className="c1-rich-object">
        {Object.entries(value)
          .filter(([, item]) => item !== undefined && item !== null && item !== "")
          .map(([key, item]) => (
            <section key={key}>
              {depth < 2 ? <h3>{humanize(key)}</h3> : null}
              <StructuredContent value={item} depth={depth + 1} />
            </section>
          ))}
      </div>
    );
  }
  return null;
}

function LoadingState({ label = "Loading published information…" }) {
  return (
    <div className="c1-state" role="status" aria-live="polite">
      <span className="c1-state-orbit" aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="c1-state c1-state-error" role="alert">
      <strong>Published information is temporarily unavailable.</strong>
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ message = "Approved content will appear here when it is published." }) {
  return (
    <div className="c1-state">
      <strong>Nothing published here yet.</strong>
      <span>{message}</span>
    </div>
  );
}

function CorporateLayout() {
  const request = useRequest((signal) => getPublicBootstrap({ signal }), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const bootstrap = request.data || {};
  const settings = bootstrap.settings || {};
  const siteName = settingValue(settings, "site.name", "CHALIN ONE");
  const tagline = settingValue(
    settings,
    "site.tagline",
    "One company. Three specialist businesses."
  );
  const description = settingValue(
    settings,
    "site.description",
    "Spare Parts, Mining Operations and Equipment Business under one professional group platform."
  );

  useMetadata(`${siteName} | Chalin 03 Company Limited`, description);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <CorporateContext.Provider
      value={{ ...bootstrap, settings, siteName, tagline, description, loading: request.loading }}
    >
      <div className="c1-site">
        {(bootstrap.announcements || []).slice(0, 1).map((announcement) => (
          <div className="c1-announcement" key={announcement.key || announcement.title}>
            <span>CHALIN ONE</span>
            <strong>{announcement.title}</strong>
            <p>{announcement.body}</p>
            {announcement.link_url ? (
              <a href={announcement.link_url}>{announcement.link_label || "Read update"} →</a>
            ) : null}
          </div>
        ))}

        <header className="c1-header">
          <Link className="c1-brand" to="/" aria-label={`${siteName} home`}>
            <img src="/chalin03-logo.png" alt="" />
            <span>
              <b>{siteName}</b>
              <small>CHALIN 03 COMPANY LIMITED</small>
            </span>
          </Link>

          <button
            type="button"
            className="c1-menu-button"
            aria-label="Open website menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <i />
            <i />
            <i />
          </button>

          <nav className="c1-nav" data-open={menuOpen ? "true" : "false"} aria-label="Main website navigation">
            {TOP_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`) ? "is-active" : ""}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="c1-access-links">
            <Link className="c1-access-studio" to="/content-studio">Content Studio</Link>
            <Link className="c1-access-staff" to="/login">
              <span>Staff portal</span>
              <b>→</b>
            </Link>
          </div>
        </header>

        {request.loading ? (
          <main className="c1-page c1-page-loading">
            <LoadingState label="Opening CHALIN ONE…" />
          </main>
        ) : request.error ? (
          <main className="c1-page">
            <ErrorState message={request.error} />
          </main>
        ) : (
          <Outlet />
        )}

        <footer className="c1-footer">
          <div className="c1-footer-top">
            <div className="c1-footer-brand">
              <img src="/chalin03-logo.png" alt="" />
              <div>
                <span>CHALIN 03 COMPANY LIMITED</span>
                <strong>{siteName}</strong>
                <p>{description}</p>
              </div>
            </div>
            <div className="c1-footer-grid">
              <div>
                <strong>Company</strong>
                <Link to="/about">About</Link>
                <Link to="/leadership">Leadership</Link>
                <Link to="/news">Newsroom</Link>
                <Link to="/careers">Careers</Link>
              </div>
              <div>
                <strong>Businesses</strong>
                <Link to="/businesses/spare-parts">Spare Parts</Link>
                <Link to="/businesses/mining">Mining Operations</Link>
                <Link to="/businesses/equipment">Equipment Business</Link>
                <Link to="/projects">Projects</Link>
              </div>
              <div>
                <strong>Explore</strong>
                <Link to="/equipment">Equipment</Link>
                <Link to="/media">Media centre</Link>
                <Link to="/locations">Locations</Link>
                <Link to="/contact">Contact</Link>
              </div>
              <div>
                <strong>Secure access</strong>
                <Link to="/login">Staff portal</Link>
                <Link to="/content-studio">Content Studio</Link>
                <Link to="/faqs">FAQs</Link>
                <Link to="/tenders">Tenders</Link>
              </div>
            </div>
          </div>
          <div className="c1-footer-bottom">
            <span>© {new Date().getFullYear()} Chalin 03 Company Limited.</span>
            <span>Published through the governed CHALIN ONE platform.</span>
          </div>
        </footer>
      </div>
    </CorporateContext.Provider>
  );
}

function useCorporate() {
  return useContext(CorporateContext) || {};
}

function SectionHeading({ index, eyebrow, title, text, action }) {
  return (
    <div className="c1-section-heading">
      <span className="c1-section-index">{index}</span>
      <div>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
        {text ? <p>{text}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

function HomePage() {
  const { settings = {}, siteName, tagline, description, divisions = [], statistics = [] } = useCorporate();
  const request = useRequest(async (signal) => {
    const [homepageResult, newsResult, leadershipResult, projectResult, equipmentResult, locationResult] =
      await Promise.allSettled([
        getPublicHomepage({ signal }),
        listPublicResource("news", { limit: 6, offset: 0 }, { signal }),
        listPublicResource("leadership", { limit: 4, offset: 0 }, { signal }),
        listPublicResource("projects", { limit: 6, offset: 0 }, { signal }),
        listPublicResource("equipment", { limit: 6, offset: 0 }, { signal }),
        listPublicResource("locations", { limit: 4, offset: 0 }, { signal }),
      ]);
    return {
      page: homepageResult.status === "fulfilled" ? homepageResult.value : null,
      news: newsResult.status === "fulfilled" ? listFromResult(newsResult.value) : [],
      leadership: leadershipResult.status === "fulfilled" ? listFromResult(leadershipResult.value) : [],
      projects: projectResult.status === "fulfilled" ? listFromResult(projectResult.value) : [],
      equipment: equipmentResult.status === "fulfilled" ? listFromResult(equipmentResult.value) : [],
      locations: locationResult.status === "fulfilled" ? listFromResult(locationResult.value) : [],
    };
  }, []);

  const data = request.data || {};
  const page = data.page;
  const heroMedia = page?.media?.media_type === "image" ? page.media : null;
  const businessItems = divisions.length > 0 ? divisions.slice(0, 3) : BUSINESS_FALLBACKS;
  const news = data.news || [];
  const projects = data.projects || [];
  const equipment = data.equipment || [];
  const leadership = data.leadership || [];
  const locations = data.locations || [];
  const heroTitle = page?.title || tagline || "Built to move business forward.";
  const heroSubtitle = page?.subtitle || description;

  useMetadata(
    page?.seo?.title || `${siteName || "CHALIN ONE"} | Chalin 03 Company Limited`,
    page?.seo?.description || page?.summary || description
  );

  return (
    <main className="c1-home">
      <section className={`c1-hero${heroMedia ? " has-image" : ""}`}>
        {heroMedia ? (
          <div
            className="c1-hero-image"
            style={{ backgroundImage: `url(${heroMedia.url})` }}
            role="img"
            aria-label={heroMedia.alt_text || "CHALIN ONE operations"}
          />
        ) : (
          <div className="c1-hero-visual" aria-hidden="true">
            <span className="c1-orbit c1-orbit-a" />
            <span className="c1-orbit c1-orbit-b" />
            <span className="c1-orbit c1-orbit-c" />
            <b>C1</b>
          </div>
        )}
        <div className="c1-hero-shade" aria-hidden="true" />
        <div className="c1-hero-grid" aria-hidden="true" />
        <div className="c1-hero-copy">
          <div className="c1-hero-kicker"><span>CHALIN 03 COMPANY LIMITED</span><i /> GHANA</div>
          <h1>{heroTitle}</h1>
          <p>{heroSubtitle}</p>
          <div className="c1-hero-actions">
            <Link className="c1-button c1-button-gold" to="/businesses">Explore our businesses <b>↗</b></Link>
            <Link className="c1-button c1-button-ghost" to="/contact">Start a conversation</Link>
          </div>
          <div className="c1-hero-business-line">
            <span>Spare Parts</span><i />
            <span>Mining Operations</span><i />
            <span>Equipment Business</span>
          </div>
        </div>
        <div className="c1-hero-side">
          <span>THE GROUP</span>
          <strong>One company.<br />Three engines of growth.</strong>
          <p>Connected by professional governance. Separated by operational purpose.</p>
          <Link to="/about">Discover CHALIN ONE →</Link>
        </div>
        <div className="c1-scroll-cue"><span>Scroll to explore</span><i /></div>
      </section>

      {news.length > 0 ? (
        <section className="c1-newsline" aria-label="Latest company news">
          <div><span>LIVE</span><strong>CHALIN ONE Newsroom</strong></div>
          <div className="c1-newsline-track">
            {news.slice(0, 4).map((item) => (
              <Link to={`/news/${item.slug}`} key={item.key || item.slug}>
                <b>{item.category?.name || "Update"}</b>
                <span>{item.title}</span>
                <time>{formatDate(item.published_at)}</time>
              </Link>
            ))}
          </div>
          <Link to="/news">All news →</Link>
        </section>
      ) : null}

      {statistics.length > 0 ? (
        <section className="c1-stats" aria-label="Published company statistics">
          {statistics.slice(0, 4).map((stat) => (
            <article key={stat.key}>
              <strong>{stat.prefix}{stat.display_value}{stat.suffix}</strong>
              <span>{stat.label}</span>
              {stat.source_note ? <small>{stat.source_note}</small> : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="c1-section c1-business-section">
        <SectionHeading
          index="01"
          eyebrow="Our businesses"
          title="Different missions. One standard."
          text="CHALIN ONE brings three specialist operating businesses together without losing the separation each business needs to perform professionally."
          action={<Link className="c1-text-link" to="/businesses">View all businesses →</Link>}
        />
        <div className="c1-business-grid">
          {businessItems.map((business, index) => {
            const fallback = BUSINESS_FALLBACKS[index] || BUSINESS_FALLBACKS[0];
            const slug = business.slug || fallback.slug;
            const media = business.media;
            return (
              <Link className="c1-business-card" to={`/businesses/${slug}`} key={business.key || slug}>
                {media?.url ? <CorporateMedia media={media} /> : <div className="c1-business-art"><b>{business.symbol || fallback.symbol}</b></div>}
                <div className="c1-business-overlay" />
                <span className="c1-business-number">{business.number || `0${index + 1}`}</span>
                <div className="c1-business-copy">
                  <small>{business.label || "CHALIN ONE BUSINESS"}</small>
                  <h3>{business.name}</h3>
                  <p>{business.short_description || business.description || fallback.description}</p>
                  <span>Explore business <b>↗</b></span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="c1-operating-model">
        <div className="c1-operating-intro">
          <span>02 / HOW WE OPERATE</span>
          <h2>Built for work in the real world.</h2>
          <p>Public information, operational systems and management control connect through one governed platform while business records stay inside their proper operating boundaries.</p>
        </div>
        <div className="c1-operating-panels">
          <article><span>01</span><strong>Operate</strong><p>Each business keeps its own workspaces, locations, people and operational context.</p></article>
          <article><span>02</span><strong>Control</strong><p>Management sees the information needed to govern performance, responsibility and delivery.</p></article>
          <article><span>03</span><strong>Communicate</strong><p>Approved company information reaches customers, partners and the public through CHALIN ONE.</p></article>
        </div>
      </section>

      {projects.length > 0 ? (
        <section className="c1-section">
          <SectionHeading
            index="03"
            eyebrow="Projects"
            title="Work with a visible footprint."
            text="Published projects and delivery stories from across the group."
            action={<Link className="c1-text-link" to="/projects">Project archive →</Link>}
          />
          <div className="c1-project-showcase">
            {projects.slice(0, 3).map((project, index) => (
              <Link className={`c1-project c1-project-${index + 1}`} to={`/projects/${project.slug}`} key={project.key || project.slug}>
                {project.media?.url ? <CorporateMedia media={project.media} /> : <div className="c1-project-fallback" />}
                <div className="c1-project-shade" />
                <div>
                  <span>{project.division?.name || humanize(project.status || "Project")}</span>
                  <h3>{project.title}</h3>
                  <p>{project.summary || project.location || project.location_text || ""}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {equipment.length > 0 ? (
        <section className="c1-equipment-band">
          <div className="c1-equipment-band-head">
            <div><span>04 / EQUIPMENT</span><h2>Machines that mean business.</h2></div>
            <Link to="/equipment">Explore equipment →</Link>
          </div>
          <div className="c1-equipment-strip">
            {equipment.slice(0, 4).map((item) => (
              <Link to={`/equipment/${item.slug}`} key={item.key || item.slug}>
                {item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-equipment-fallback">EQ</div>}
                <div>
                  <small>{item.category || item.manufacturer || "Equipment"}</small>
                  <strong>{item.name}</strong>
                  <p>{item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ")}</p>
                  <span>{formatMoney(item.price) || humanize(item.availability || "Published")}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {leadership.length > 0 ? (
        <section className="c1-leadership-feature">
          <div className="c1-leadership-image">
            {(leadership[0].portrait || leadership[0].media)?.url ? (
              <CorporateMedia media={leadership[0].portrait || leadership[0].media} />
            ) : (
              <div className="c1-leadership-monogram">{String(leadership[0].full_name || leadership[0].name || "C").charAt(0)}</div>
            )}
          </div>
          <div className="c1-leadership-copy">
            <span>05 / LEADERSHIP</span>
            <h2>Responsibility has a face.</h2>
            <p>Meet the people accountable for governance, customer service and operational delivery across Chalin 03 Company Limited.</p>
            <div><strong>{leadership[0].full_name || leadership[0].name}</strong><small>{leadership[0].position || leadership[0].position_title || "Leadership"}</small></div>
            <Link className="c1-button c1-button-dark" to="/leadership">Meet our leadership →</Link>
          </div>
        </section>
      ) : null}

      {page?.sections?.length ? (
        <section className="c1-governed-sections">
          {page.sections.filter((section) => section.type !== "hero").map((section, index) => (
            <article className="c1-governed-block" key={section.key || index}>
              <div>
                <span>CHALIN ONE</span>
                {section.heading ? <h2>{section.heading}</h2> : null}
                {section.subheading ? <p className="c1-governed-subtitle">{section.subheading}</p> : null}
                <StructuredContent value={section.content} />
              </div>
              <CorporateMedia media={section.primary_media} />
            </article>
          ))}
        </section>
      ) : null}

      <section className="c1-section c1-news-section">
        <SectionHeading
          index="06"
          eyebrow="Newsroom"
          title="What is moving across CHALIN ONE."
          text="Company announcements, operational stories and published updates."
          action={<Link className="c1-text-link" to="/news">Enter newsroom →</Link>}
        />
        {news.length > 0 ? (
          <div className="c1-news-grid">
            {news.slice(0, 3).map((item, index) => (
              <Link to={`/news/${item.slug}`} className={index === 0 ? "is-featured" : ""} key={item.key || item.slug}>
                {item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-news-fallback" />}
                <div><span>{item.category?.name || "Company news"}</span><h3>{item.title}</h3><p>{item.excerpt || item.summary || ""}</p><time>{formatDate(item.published_at)}</time></div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState message="The newsroom is ready for the first approved CHALIN ONE story." />
        )}
      </section>

      {locations.length > 0 ? (
        <section className="c1-location-band">
          <div><span>07 / WHERE WE WORK</span><h2>Find CHALIN ONE.</h2><p>Published offices, stores, yards, sites and operating locations.</p></div>
          <div className="c1-location-list">
            {locations.slice(0, 4).map((item) => (
              <article key={item.key || item.name}><span>⌖</span><div><strong>{item.name}</strong><p>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</p></div></article>
            ))}
          </div>
          <Link to="/locations">View all locations →</Link>
        </section>
      ) : null}

      <section className="c1-final-stage">
        <div className="c1-final-stage-grid" aria-hidden="true" />
        <span>CHALIN 03 COMPANY LIMITED</span>
        <h2>Let’s build what comes next.</h2>
        <p>Explore the group, discuss equipment and operations, or reach the right CHALIN ONE team.</p>
        <div>
          <Link className="c1-button c1-button-gold" to="/contact">Contact CHALIN ONE ↗</Link>
          <Link className="c1-button c1-button-ghost" to="/businesses">Explore the group</Link>
        </div>
      </section>
    </main>
  );
}

function PageHero({ eyebrow, title, text, media }) {
  return (
    <header className={`c1-page-hero${media?.url ? " has-media" : ""}`}>
      {media?.url ? <CorporateMedia media={media} eager /> : <div className="c1-page-hero-art" aria-hidden="true"><span>C1</span></div>}
      <div className="c1-page-hero-shade" />
      <div className="c1-page-hero-copy"><span>{eyebrow}</span><h1>{title}</h1>{text ? <p>{text}</p> : null}</div>
    </header>
  );
}

function AboutPage() {
  const request = useRequest(async (signal) => {
    try {
      return await getPublicPage("about", { signal });
    } catch (error) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }, []);
  const page = request.data;
  useMetadata(page?.seo?.title || "About | CHALIN ONE", page?.seo?.description || page?.summary || "About Chalin 03 Company Limited and CHALIN ONE.");

  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;

  return (
    <main className="c1-page">
      <PageHero eyebrow="About CHALIN ONE" title={page?.title || "One company. Built around real operations."} text={page?.summary || "CHALIN ONE is the public company platform connecting Chalin 03 Company Limited’s three specialist businesses: Spare Parts, Mining Operations and Equipment Business."} media={page?.media} />
      <section className="c1-editorial-grid">
        <div><span>WHO WE ARE</span><h2>One group identity. Clear operating boundaries.</h2></div>
        <div><StructuredContent value={page?.body || "The group is designed so each business can operate with its own context while management, public communication and governance stay connected through one professional company platform."} /></div>
      </section>
      <section className="c1-principles">
        <article><span>01</span><strong>Operational clarity</strong><p>Each business keeps the context, records and responsibilities that belong to its work.</p></article>
        <article><span>02</span><strong>Professional governance</strong><p>Company information and management controls are structured for accountability and review.</p></article>
        <article><span>03</span><strong>One public standard</strong><p>Customers, partners and visitors meet one coherent CHALIN ONE company experience.</p></article>
      </section>
      {(page?.sections || []).map((section, index) => (
        <section className="c1-content-split" key={section.key || index}>
          <div><span>{section.type ? humanize(section.type) : "Company"}</span><h2>{section.heading || section.subheading}</h2><StructuredContent value={section.content} /></div>
          <CorporateMedia media={section.primary_media || section.background_media} />
        </section>
      ))}
    </main>
  );
}

function BusinessesPage() {
  const { divisions = [] } = useCorporate();
  const items = divisions.length > 0 ? divisions : BUSINESS_FALLBACKS;
  useMetadata("Businesses | CHALIN ONE", "Explore Spare Parts, Mining Operations and Equipment Business across Chalin 03 Company Limited.");
  return (
    <main className="c1-page">
      <PageHero eyebrow="Our businesses" title="Three specialist businesses. One CHALIN standard." text="Explore the operating businesses behind Chalin 03 Company Limited." />
      <section className="c1-business-directory">
        {items.map((business, index) => {
          const fallback = BUSINESS_FALLBACKS[index] || BUSINESS_FALLBACKS[0];
          const slug = business.slug || fallback.slug;
          return (
            <Link to={`/businesses/${slug}`} key={business.key || slug}>
              <span>{fallback.number}</span>
              {business.media?.url ? <CorporateMedia media={business.media} /> : <div className="c1-directory-art">{fallback.symbol}</div>}
              <div><small>{business.label || fallback.label}</small><h2>{business.name}</h2><p>{business.short_description || business.description || fallback.description}</p><b>Enter business →</b></div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}

function businessFallbackForSlug(slug) {
  const clean = String(slug || "").toLowerCase();
  if (clean.includes("spare") || clean.includes("parts")) return BUSINESS_FALLBACKS[0];
  if (clean.includes("mining") || clean.includes("mine")) return BUSINESS_FALLBACKS[1];
  if (clean.includes("equipment") || clean.includes("hire") || clean.includes("sales")) return BUSINESS_FALLBACKS[2];
  return null;
}

function BusinessDetailPage() {
  const { slug } = useParams();
  const fallback = businessFallbackForSlug(slug);
  const request = useRequest(async (signal) => {
    try {
      return await getPublicResource("divisions", slug, { signal });
    } catch (error) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }, [slug]);
  const item = request.data || fallback;
  useMetadata(`${item?.name || "Business"} | CHALIN ONE`, item?.short_description || item?.description || "CHALIN ONE business division.");
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (!item) return <NotFoundPage />;
  return (
    <main className="c1-page">
      <PageHero eyebrow="CHALIN ONE business" title={item.name} text={item.short_description || item.description} media={item.media} />
      <section className="c1-editorial-grid">
        <div><span>THE BUSINESS</span><h2>{fallback?.label || "Specialist operations"}</h2></div>
        <div><StructuredContent value={item.body || item.details || item.description || fallback?.description} /></div>
      </section>
      {item.capabilities ? <section className="c1-content-panel"><span>Capabilities</span><StructuredContent value={item.capabilities} /></section> : null}
      {Array.isArray(item.gallery) && item.gallery.length > 0 ? <section className="c1-media-mosaic">{item.gallery.map((entry, index) => <CorporateMedia media={entry.media || entry} key={entry.asset_key || index} />)}</section> : null}
      <section className="c1-business-cta"><div><span>WORK WITH {String(item.name || "CHALIN ONE").toUpperCase()}</span><h2>Talk to the right team.</h2></div><Link className="c1-button c1-button-gold" to="/contact">Contact CHALIN ONE →</Link></section>
    </main>
  );
}

const COLLECTIONS = Object.freeze({
  news: { eyebrow: "Newsroom", title: "News & updates", description: "Published stories, announcements and operational updates.", detail: true, label: (item) => item.title, summary: (item) => item.excerpt || item.summary || "" },
  projects: { eyebrow: "Projects", title: "Work with a visible footprint", description: "Published projects across CHALIN ONE businesses.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.location || "" },
  equipment: { eyebrow: "Equipment", title: "Equipment for serious work", description: "Published equipment available across the Equipment Business.", detail: true, label: (item) => item.name, summary: (item) => item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ") },
  leadership: { eyebrow: "Leadership", title: "People accountable for delivery", description: "Published leadership profiles from Chalin 03 Company Limited.", detail: false, label: (item) => item.full_name || item.name, summary: (item) => item.position || item.position_title || item.professional_summary || "" },
  vacancies: { eyebrow: "Careers", title: "Build your next chapter with us", description: "Published opportunities to join CHALIN ONE businesses.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.employment_type || "" },
  locations: { eyebrow: "Locations", title: "Where CHALIN ONE works", description: "Published stores, offices, yards, sites and operating locations.", detail: false, label: (item) => item.name, summary: (item) => [item.address, item.city, item.region, item.country].filter(Boolean).join(", ") },
  tenders: { eyebrow: "Procurement", title: "Published tenders", description: "Current procurement opportunities and tender information.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.reference_number || "" },
  testimonials: { eyebrow: "Customers", title: "Published customer voices", description: "Approved customer testimonials and feedback.", detail: false, label: (item) => item.customer_name || item.name || "Customer", summary: (item) => item.quote || item.quote_text || "" },
});

function CollectionPage({ resource, titleOverride }) {
  const config = COLLECTIONS[resource];
  const request = useRequest((signal) => listPublicResource(resource, { limit: 60, offset: 0 }, { signal }), [resource]);
  const items = listFromResult(request.data);
  const title = titleOverride || config.title;
  useMetadata(`${title} | CHALIN ONE`, config.description);
  return (
    <main className="c1-page">
      <PageHero eyebrow={config.eyebrow} title={title} text={config.description} />
      <section className="c1-collection">
        {request.loading ? <LoadingState /> : request.error ? <ErrorState message={request.error} /> : items.length === 0 ? <EmptyState /> : (
          <div className="c1-collection-grid">
            {items.map((item, index) => {
              const label = config.label(item);
              const media = item.media || item.portrait || item.document;
              const targetResource = resource === "vacancies" ? "careers" : resource;
              const content = (
                <>
                  {media?.url ? <CorporateMedia media={media} /> : <div className="c1-card-art"><span>{String(index + 1).padStart(2, "0")}</span></div>}
                  <div><small>{item.division?.name || humanize(item.status || item.category?.name || config.eyebrow)}</small><h2>{label}</h2><p>{config.summary(item)}</p>{formatMoney(item.price) ? <strong>{formatMoney(item.price)}</strong> : null}{item.published_at ? <time>{formatDate(item.published_at)}</time> : null}<span className="c1-card-arrow">Explore ↗</span></div>
                </>
              );
              return config.detail && item.slug ? <Link className="c1-collection-card" to={`/${targetResource}/${item.slug}`} key={item.key || item.slug || index}>{content}</Link> : <article className="c1-collection-card" key={item.key || item.slug || index}>{content}</article>;
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function DetailPage({ resource }) {
  const { slug } = useParams();
  const request = useRequest((signal) => getPublicResource(resource, slug, { signal }), [resource, slug]);
  const item = request.data;
  const config = COLLECTIONS[resource] || COLLECTIONS.news;
  useMetadata(`${item ? config.label(item) : config.title} | CHALIN ONE`, item ? config.summary(item) : config.description);
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (!item) return <NotFoundPage />;
  return (
    <main className="c1-page">
      <PageHero eyebrow={config.eyebrow} title={config.label(item)} text={config.summary(item)} media={item.media || item.document} />
      <section className="c1-detail-layout">
        <article>
          <StructuredContent value={item.body || item.details || item.description} />
          {item.specifications ? <section><h2>Specifications</h2><StructuredContent value={item.specifications} /></section> : null}
          {item.features ? <section><h2>Features</h2><StructuredContent value={item.features} /></section> : null}
          <StructuredContent value={item.requirements} />
          <StructuredContent value={item.application_instructions || item.submission_instructions} />
        </article>
        <aside>
          {item.division?.name ? <p><span>Division</span><strong>{item.division.name}</strong></p> : null}
          {item.location?.name || item.location || item.location_text ? <p><span>Location</span><strong>{item.location?.name || item.location || item.location_text}</strong></p> : null}
          {item.status ? <p><span>Status</span><strong>{humanize(item.status)}</strong></p> : null}
          {item.availability ? <p><span>Availability</span><strong>{humanize(item.availability)}</strong></p> : null}
          {formatMoney(item.price) ? <p><span>Published price</span><strong>{formatMoney(item.price)}</strong></p> : null}
          {item.manufacturer ? <p><span>Manufacturer</span><strong>{item.manufacturer}</strong></p> : null}
          {item.model ? <p><span>Model</span><strong>{item.model}</strong></p> : null}
          {item.reference_number ? <p><span>Reference</span><strong>{item.reference_number}</strong></p> : null}
          {item.published_at ? <p><span>Published</span><strong>{formatDate(item.published_at)}</strong></p> : null}
          {item.application_url ? <a className="c1-button c1-button-gold" href={item.application_url}>Apply securely ↗</a> : null}
          <Link className="c1-button c1-button-dark" to="/contact">Contact CHALIN ONE</Link>
        </aside>
      </section>
      {Array.isArray(item.gallery) && item.gallery.length > 0 ? <section className="c1-media-mosaic">{item.gallery.map((entry, index) => <CorporateMedia media={entry.media || entry} key={entry.asset_key || index} />)}</section> : null}
    </main>
  );
}

function MediaPage() {
  const request = useRequest(async (signal) => {
    const resources = ["news", "projects", "equipment", "leadership"];
    const settled = await Promise.allSettled(resources.map((resource) => listPublicResource(resource, { limit: 20, offset: 0 }, { signal })));
    return settled.flatMap((result) => result.status === "fulfilled" ? listFromResult(result.value) : []).map((item) => item.media || item.portrait).filter((media) => media?.url);
  }, []);
  const media = request.data || [];
  useMetadata("Media centre | CHALIN ONE", "Published CHALIN ONE photography and visual stories.");
  return (
    <main className="c1-page">
      <PageHero eyebrow="Media centre" title="See the work. See the company." text="A visual collection drawn from published CHALIN ONE businesses, projects, equipment and leadership stories." />
      <section className="c1-media-mosaic c1-media-mosaic-page">
        {request.loading ? <LoadingState /> : request.error ? <ErrorState message={request.error} /> : media.length === 0 ? <EmptyState message="Published images will automatically build the CHALIN ONE media centre." /> : media.map((item, index) => <CorporateMedia media={item} key={item.asset_key || item.url || index} />)}
      </section>
    </main>
  );
}

function FaqPage() {
  const request = useRequest((signal) => listPublicResource("faqs", {}, { signal }), []);
  const items = listFromResult(request.data);
  useMetadata("Frequently asked questions | CHALIN ONE", "Published answers to common questions about CHALIN ONE.");
  return (
    <main className="c1-page">
      <PageHero eyebrow="Help" title="Questions, answered clearly." text="Published answers to common customer, supplier and company questions." />
      <section className="c1-faqs">
        {request.loading ? <LoadingState /> : request.error ? <ErrorState message={request.error} /> : items.length === 0 ? <EmptyState /> : items.map((item, index) => <details key={item.key || index}><summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}</summary><StructuredContent value={item.answer} /></details>)}
      </section>
    </main>
  );
}

function responseDefault(field) {
  if (["multiselect", "checkbox_group"].includes(field.type)) return [];
  if (["checkbox", "boolean"].includes(field.type)) return false;
  return "";
}

function PublicField({ field, value, onChange }) {
  if (field.type === "textarea") return <textarea rows="5" required={field.required} value={value || ""} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "select") return <select required={field.required} value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select>;
  if (["checkbox", "boolean"].includes(field.type)) return <label className="c1-check"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{field.placeholder || "Yes"}</label>;
  return <input type={field.type === "number" ? "number" : field.type || "text"} required={field.required} value={value ?? ""} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function ContactPage({ formSlug = "contact" }) {
  const locationRequest = useRequest((signal) => listPublicResource("locations", { limit: 8, offset: 0 }, { signal }), []);
  const formRequest = useRequest(async (signal) => {
    try {
      return await getPublicForm(formSlug, { signal });
    } catch (error) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }, [formSlug]);
  const form = formRequest.data;
  const locations = listFromResult(locationRequest.data);
  const [contact, setContact] = useState({ full_name: "", email: "", phone: "", company_name: "", consent_given: false, website: "" });
  const [responses, setResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(null);
  useMetadata("Contact | CHALIN ONE", "Contact Chalin 03 Company Limited through CHALIN ONE.");

  useEffect(() => {
    if (!form) return;
    setResponses(Object.fromEntries((form.fields || []).map((field) => [field.key, responseDefault(field)])));
  }, [form]);

  async function submit(event) {
    event.preventDefault();
    if (!form || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await submitPublicForm(form.slug, {
        ...contact,
        consent_text_version: form.settings?.consent_text_version || "privacy-v1",
        source_page_slug: "contact",
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
    <main className="c1-page">
      <PageHero eyebrow="Contact" title="Start the right conversation." text="Equipment, operations, partnerships, careers or general company enquiries — reach CHALIN ONE through the published company channel." />
      <section className="c1-contact-layout">
        <div className="c1-contact-locations">
          <span>WHERE WE WORK</span><h2>Published locations</h2>
          {locationRequest.loading ? <LoadingState /> : locations.length === 0 ? <EmptyState /> : locations.map((item) => <article key={item.key || item.name}><b>⌖</b><div><strong>{item.name}</strong><p>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</p>{item.phone ? <a href={`tel:${item.phone}`}>{item.phone}</a> : null}</div></article>)}
        </div>
        <div className="c1-contact-form-wrap">
          <span>ENQUIRY DESK</span><h2>{form?.name || "Contact CHALIN ONE"}</h2><p>{form?.description || "The public enquiry form will appear here as soon as it is published in Content Studio."}</p>
          {formRequest.loading ? <LoadingState /> : formRequest.error ? <ErrorState message={formRequest.error} /> : !form ? <EmptyState message="Publish the Contact form in Content Studio to activate public enquiries." /> : success ? <div className="c1-form-success"><strong>Submission received.</strong><p>{success.confirmation_message || form.confirmation_message}</p>{success.reference_code ? <span>Reference: {success.reference_code}</span> : null}</div> : (
            <form className="c1-contact-form" onSubmit={submit}>
              {submitError ? <ErrorState message={submitError} /> : null}
              <div className="c1-form-row"><label><span>Full name</span><input value={contact.full_name} onChange={(event) => setContact((current) => ({ ...current, full_name: event.target.value }))} /></label><label><span>Email</span><input type="email" value={contact.email} onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))} /></label></div>
              <div className="c1-form-row"><label><span>Phone</span><input value={contact.phone} onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))} /></label><label><span>Company</span><input value={contact.company_name} onChange={(event) => setContact((current) => ({ ...current, company_name: event.target.value }))} /></label></div>
              <label className="c1-honeypot" aria-hidden="true">Website<input tabIndex="-1" value={contact.website} onChange={(event) => setContact((current) => ({ ...current, website: event.target.value }))} /></label>
              {(form.fields || []).map((field) => <label key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><PublicField field={field} value={responses[field.key]} onChange={(value) => setResponses((current) => ({ ...current, [field.key]: value }))} />{field.help_text ? <small>{field.help_text}</small> : null}</label>)}
              {form.settings?.require_consent !== false ? <label className="c1-check"><input type="checkbox" required checked={contact.consent_given} onChange={(event) => setContact((current) => ({ ...current, consent_given: event.target.checked }))} />I consent to the use of this information for responding to my enquiry.</label> : null}
              <button className="c1-button c1-button-gold" disabled={submitting}>{submitting ? "Sending…" : form.settings?.submit_label || "Send enquiry →"}</button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function PublishedPage() {
  const { slug } = useParams();
  const request = useRequest((signal) => getPublicPage(slug, { signal }), [slug]);
  const page = request.data;
  useMetadata(page ? `${page.seo?.title || page.title} | CHALIN ONE` : "CHALIN ONE", page?.seo?.description || page?.summary || "");
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (!page) return <NotFoundPage />;
  return (
    <main className="c1-page">
      <PageHero eyebrow={humanize(page.page_type || "Company")} title={page.title} text={page.subtitle || page.summary} media={page.media} />
      <section className="c1-published-body"><StructuredContent value={page.body} /></section>
      {(page.sections || []).map((section, index) => <section className="c1-content-split" key={section.key || index}><div><span>{humanize(section.type || "Section")}</span><h2>{section.heading}</h2>{section.subheading ? <p className="c1-governed-subtitle">{section.subheading}</p> : null}<StructuredContent value={section.content} /></div><CorporateMedia media={section.primary_media || section.background_media} /></section>)}
    </main>
  );
}

function LegacyWebsiteRedirect() {
  const { "*": rest = "" } = useParams();
  return <Navigate replace to={rest ? `/${rest}` : "/"} />;
}

function NotFoundPage() {
  useMetadata("Page not found | CHALIN ONE");
  return <main className="c1-page c1-not-found"><span>404</span><h1>This page is not part of the published CHALIN ONE website.</h1><p>The address may have changed, or the content may not be published yet.</p><Link className="c1-button c1-button-gold" to="/">Return to homepage →</Link></main>;
}

export function PublicCorporateWebsiteUnavailable() {
  return <main className="c1-unavailable"><img src="/chalin03-logo.png" alt="" /><span>CHALIN ONE</span><h1>Public website is currently unavailable.</h1><p>This environment has the public website feature disabled.</p><Link to="/login">Staff portal</Link></main>;
}

export default function PublicCorporateWebsiteApp() {
  return (
    <Routes>
      <Route element={<CorporateLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="businesses" element={<BusinessesPage />} />
        <Route path="businesses/:slug" element={<BusinessDetailPage />} />
        <Route path="projects" element={<CollectionPage resource="projects" />} />
        <Route path="projects/:slug" element={<DetailPage resource="projects" />} />
        <Route path="equipment" element={<CollectionPage resource="equipment" />} />
        <Route path="equipment/:slug" element={<DetailPage resource="equipment" />} />
        <Route path="news" element={<CollectionPage resource="news" />} />
        <Route path="news/:slug" element={<DetailPage resource="news" />} />
        <Route path="leadership" element={<CollectionPage resource="leadership" />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="careers" element={<CollectionPage resource="vacancies" titleOverride="Careers at CHALIN ONE" />} />
        <Route path="careers/:slug" element={<DetailPage resource="vacancies" />} />
        <Route path="locations" element={<CollectionPage resource="locations" />} />
        <Route path="tenders" element={<CollectionPage resource="tenders" />} />
        <Route path="tenders/:slug" element={<DetailPage resource="tenders" />} />
        <Route path="testimonials" element={<CollectionPage resource="testimonials" />} />
        <Route path="faqs" element={<FaqPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="forms/contact" element={<Navigate replace to="/contact" />} />
        <Route path="pages/:slug" element={<PublishedPage />} />
        <Route path="website/*" element={<LegacyWebsiteRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
