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
  useNavigate,
  useParams,
  useSearchParams,
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
import PublicVisualSections from "./PublicVisualSectionRenderer";
import "./publicWebsite.css";
import "./publicCorporateWebsite.css";
import "./publicExperienceDepth.css";

const CorporateContext = createContext(null);

const BUSINESS_FALLBACKS = Object.freeze([
  Object.freeze({
    slug: "spare-parts",
    name: "Spare Parts",
    label: "Parts · Sales · Inventory",
    description: "Professional spare-parts sales, stock control and customer support across CHALIN 03 operations.",
    number: "01",
    symbol: "SP",
    pulse: "Availability · speed · accuracy",
    lanes: [
      ["Parts enquiries", "Move directly from a part requirement into the right sales conversation."],
      ["Store network", "Explore the published CHALIN 03 spare-parts locations and customer touchpoints."],
      ["Customer support", "Keep product, availability and service enquiries inside the Spare Parts context."],
    ],
  }),
  Object.freeze({
    slug: "mining-operations",
    name: "Mining Operations",
    label: "Sites · Production · Control",
    description: "A dedicated operating environment for mining-site activity, production oversight, equipment and field control.",
    number: "02",
    symbol: "MO",
    pulse: "Sites · people · production",
    lanes: [
      ["Operations", "Present approved mining capabilities and operating information without mixing other businesses."],
      ["Field projects", "Publish selected project stories and field evidence through the governed website."],
      ["Mining enquiries", "Route mining conversations directly to the appropriate business context."],
    ],
  }),
  Object.freeze({
    slug: "equipment-business",
    name: "Equipment Business",
    label: "Sales · Hire · Finance",
    description: "Equipment sales, hire, fleet operations and structured commercial services in one specialist business division.",
    number: "03",
    symbol: "EQ",
    pulse: "Machines · movement · value",
    lanes: [
      ["Equipment sales", "Explore approved equipment listings and continue into a commercial enquiry."],
      ["Equipment hire", "Start a hire conversation around the machine, work and timing required."],
      ["Commercial pathways", "Keep equipment-related sales, hire and approved finance information in one specialist world."],
    ],
  }),
]);

const TOP_NAV = Object.freeze([
  { to: "/about", label: "Company" },
  { to: "/businesses", label: "Businesses" },
  { to: "/projects", label: "Projects" },
  { to: "/equipment", label: "Equipment" },
  { to: "/news", label: "Newsroom" },
  { to: "/leadership", label: "Leadership" },
]);

const VISITOR_INTENTS = Object.freeze([
  { key: "parts", index: "01", title: "Find a part", text: "Route a spare-parts request to the right team with a clear service context.", action: "/contact?intent=parts", tag: "Spare Parts" },
  { key: "hire", index: "02", title: "Hire equipment", text: "Start an equipment-hire conversation around the machine, work and timing you need.", action: "/contact?intent=hire", tag: "Equipment" },
  { key: "buy", index: "03", title: "Buy equipment", text: "Explore published equipment first, then move directly into a commercial enquiry.", action: "/equipment", tag: "Sales" },
  { key: "mining", index: "04", title: "Mining enquiry", text: "Reach the mining team without mixing your request into another CHALIN business.", action: "/contact?intent=mining", tag: "Mining" },
  { key: "career", index: "05", title: "Work with us", text: "Discover published vacancies and company opportunities through a dedicated path.", action: "/careers", tag: "Careers" },
  { key: "supplier", index: "06", title: "Supplier or tender", text: "Move into published procurement opportunities or make a structured company enquiry.", action: "/tenders", tag: "Partners" },
]);

const COLLECTIONS = Object.freeze({
  news: { eyebrow: "Newsroom", title: "Signals from across the company", description: "Published stories, announcements and operational updates.", detail: true, label: (item) => item.title, summary: (item) => item.excerpt || item.summary || "" },
  projects: { eyebrow: "Projects", title: "Work with a visible footprint", description: "Published projects across CHALIN ONE businesses.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.location || "" },
  equipment: { eyebrow: "Equipment", title: "Equipment should be explored", description: "Published equipment available across the Equipment Business.", detail: true, label: (item) => item.name, summary: (item) => item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ") },
  leadership: { eyebrow: "Leadership", title: "Accountability has a face", description: "Published leadership profiles from Chalin 03 Company Limited.", detail: false, label: (item) => item.full_name || item.name, summary: (item) => item.position || item.position_title || item.professional_summary || "" },
  vacancies: { eyebrow: "Careers", title: "Build your next chapter with us", description: "Published opportunities to join CHALIN ONE businesses.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.employment_type || "" },
  locations: { eyebrow: "Locations", title: "The physical CHALIN network", description: "Published stores, offices, yards, sites and operating locations.", detail: false, label: (item) => item.name, summary: (item) => [item.address, item.city, item.region, item.country].filter(Boolean).join(", ") },
  tenders: { eyebrow: "Procurement", title: "Published opportunities", description: "Current procurement opportunities and tender information.", detail: true, label: (item) => item.title, summary: (item) => item.summary || item.reference_number || "" },
  testimonials: { eyebrow: "Customers", title: "Published customer voices", description: "Approved customer testimonials and feedback.", detail: false, label: (item) => item.customer_name || item.name || "Customer", summary: (item) => item.quote || item.quote_text || "" },
});

function listFromResult(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function settingValue(settings, key, fallback = "") {
  const value = settings?.[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") return String(value.text || value.name || value.label || value.value || fallback);
  return fallback;
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" });
}

function formatMoney(price) {
  if (!price || price.amount === undefined || price.amount === null) return "";
  const amount = Number(price.amount);
  if (!Number.isFinite(amount)) return "";
  const currency = /^[A-Z]{3}$/.test(String(price.currency || "").toUpperCase()) ? String(price.currency).toUpperCase() : "GHS";
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
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
      .then((data) => active && !controller.signal.aborted && setState({ loading: false, data, error: "" }))
      .catch((error) => active && !controller.signal.aborted && setState({ loading: false, data: null, error: publicWebsiteErrorMessage(error) }));
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
        <img src={media.url} alt={media.alt_text || "Published CHALIN ONE media"} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} decoding="async" />
        {media.caption || media.credit ? <figcaption>{[media.caption, media.credit].filter(Boolean).join(" — ")}</figcaption> : null}
      </figure>
    );
  }
  return <a className="c1-document-link" href={media.url} target="_blank" rel="noreferrer">Open published {media.media_type === "document" ? "document" : "video"} ↗</a>;
}

function StructuredContent({ value, depth = 0 }) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number"].includes(typeof value)) return <p>{String(value)}</p>;
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) return <ul className="c1-rich-list">{value.map((item, index) => <li key={typeof item === "string" ? `${item}-${index}` : index}><StructuredContent value={item} depth={depth + 1} /></li>)}</ul>;
  if (typeof value === "object") {
    if (typeof value.text === "string") return <><p>{value.text}</p>{value.items ? <StructuredContent value={value.items} depth={depth + 1} /> : null}</>;
    return <div className="c1-rich-object">{Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "").map(([key, item]) => <section key={key}>{depth < 2 ? <h3>{humanize(key)}</h3> : null}<StructuredContent value={item} depth={depth + 1} /></section>)}</div>;
  }
  return null;
}

function LoadingState({ label = "Loading published information…" }) {
  return <div className="c1-state" role="status" aria-live="polite"><span className="c1-state-orbit" aria-hidden="true" /><strong>{label}</strong></div>;
}

function ErrorState({ message }) {
  return <div className="c1-state c1-state-error" role="alert"><strong>Published information is temporarily unavailable.</strong><span>{message}</span></div>;
}

function EmptyState({ message = "Approved content will appear here when it is published." }) {
  return <div className="c1-state c1-state-empty"><span>CHALIN ONE / PUBLISHING SIGNAL</span><strong>Nothing published here yet.</strong><p>{message}</p></div>;
}

function ScrollSignal() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <div className="c1-scroll-signal" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>;
}

function ExperienceNavigator({ open, onClose }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => event.key === "Escape" && onClose();
    document.body.dataset.c1NavigatorOpen = "true";
    window.addEventListener("keydown", handler);
    return () => {
      delete document.body.dataset.c1NavigatorOpen;
      window.removeEventListener("keydown", handler);
    };
  }, [onClose, open]);
  if (!open) return null;
  const go = (target) => {
    onClose();
    navigate(target);
  };
  return (
    <div className="c1-navigator" role="dialog" aria-modal="true" aria-label="CHALIN ONE navigator">
      <button className="c1-navigator-backdrop" aria-label="Close navigator" onClick={onClose} />
      <section className="c1-navigator-panel">
        <div className="c1-navigator-head"><div><span>CHALIN ONE / NAVIGATOR</span><h2>What are you here to do?</h2></div><button type="button" onClick={onClose} aria-label="Close navigator">Close ×</button></div>
        <div className="c1-navigator-grid">{VISITOR_INTENTS.map((intent) => <button type="button" key={intent.key} onClick={() => go(intent.action)}><span>{intent.index}</span><small>{intent.tag}</small><strong>{intent.title}</strong><p>{intent.text}</p><b>Continue ↗</b></button>)}</div>
        <div className="c1-navigator-foot"><button type="button" onClick={() => go("/businesses")}>Explore the whole group</button><button type="button" onClick={() => go("/contact")}>General company enquiry</button><span>ESC to close</span></div>
      </section>
    </div>
  );
}

function MobilePublicDock({ onStart }) {
  const location = useLocation();
  const active = (path) => location.pathname === path || (path !== "/" && location.pathname.startsWith(`${path}/`));
  return (
    <nav className="c1-mobile-public-dock" aria-label="Quick public navigation">
      <Link className={active("/") ? "is-primary" : ""} to="/"><b>⌂</b><span>Home</span></Link>
      <Link className={active("/businesses") ? "is-primary" : ""} to="/businesses"><b>03</b><span>Business</span></Link>
      <button className="is-primary" type="button" onClick={onStart}><b>+</b><span>Start</span></button>
      <Link className={active("/news") ? "is-primary" : ""} to="/news"><b>●</b><span>News</span></Link>
      <Link to="/login"><b>↗</b><span>Staff</span></Link>
    </nav>
  );
}

function CorporateLayout() {
  const request = useRequest((signal) => getPublicBootstrap({ signal }), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const location = useLocation();
  const bootstrap = request.data || {};
  const settings = bootstrap.settings || {};
  const siteName = settingValue(settings, "site.name", "CHALIN ONE");
  const tagline = settingValue(settings, "site.tagline", "One company. Three specialist businesses.");
  const description = settingValue(settings, "site.description", "Spare Parts, Mining Operations and Equipment Business under one professional group platform.");
  useMetadata(`${siteName} | Chalin 03 Company Limited`, description);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        setNavigatorOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CorporateContext.Provider value={{ ...bootstrap, settings, siteName, tagline, description, loading: request.loading }}>
      <div className="c1-site">
        <ScrollSignal />
        <ExperienceNavigator open={navigatorOpen} onClose={() => setNavigatorOpen(false)} />
        <aside className="c1-compass" aria-hidden="true"><b>C1</b><span>03 BUSINESSES</span><i /><small>GH / WEST AFRICA</small></aside>
        {(bootstrap.announcements || []).slice(0, 1).map((announcement) => <div className="c1-announcement" key={announcement.key || announcement.title}><span>SIGNAL</span><strong>{announcement.title}</strong><p>{announcement.body}</p>{announcement.link_url ? <a href={announcement.link_url}>{announcement.link_label || "Open update"} ↗</a> : null}</div>)}
        <header className="c1-header">
          <Link className="c1-brand" to="/" aria-label={`${siteName} home`}><img src="/chalin03-logo.png" alt="" /><span><b>CHALIN ONE</b><small>CHALIN 03 COMPANY LIMITED</small></span></Link>
          <nav className="c1-nav" data-open={menuOpen ? "true" : "false"} aria-label="Main website navigation">{TOP_NAV.map((item) => <Link key={item.to} to={item.to} className={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`) ? "is-active" : ""}>{item.label}</Link>)}</nav>
          <div className="c1-access-links"><button className="c1-navigator-trigger" type="button" onClick={() => setNavigatorOpen(true)}><span>Explore</span><kbd>⌘K</kbd></button><Link className="c1-access-staff" to="/login"><span>Staff portal</span><b>↗</b></Link></div>
          <button type="button" className="c1-menu-button" aria-label="Open website menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><i /><i /><i /></button>
        </header>
        {request.loading ? <main className="c1-page c1-page-loading"><LoadingState label="Opening the CHALIN ONE universe…" /></main> : request.error ? <main className="c1-page"><ErrorState message={request.error} /></main> : <div className="c1-route-stage" key={location.pathname}><Outlet /></div>}
        <button className="c1-signal-dock" type="button" onClick={() => setNavigatorOpen(true)}><span>START HERE</span><b>+</b></button>
        <MobilePublicDock onStart={() => setNavigatorOpen(true)} />
        <footer className="c1-footer">
          <div className="c1-footer-statement"><span>CHALIN ONE</span><h2>Three businesses.<br />One signal to the world.</h2><Link to="/contact">Start a conversation ↗</Link></div>
          <div className="c1-footer-top">
            <div className="c1-footer-brand"><img src="/chalin03-logo.png" alt="" /><div><strong>CHALIN 03 COMPANY LIMITED</strong><p>{description}</p></div></div>
            <div className="c1-footer-grid">
              <div><strong>Company</strong><Link to="/about">About</Link><Link to="/leadership">Leadership</Link><Link to="/news">Newsroom</Link><Link to="/careers">Careers</Link></div>
              <div><strong>Businesses</strong><Link to="/businesses/spare-parts">Spare Parts</Link><Link to="/businesses/mining-operations">Mining Operations</Link><Link to="/businesses/equipment-business">Equipment Business</Link><Link to="/projects">Projects</Link></div>
              <div><strong>Explore</strong><Link to="/equipment">Equipment</Link><Link to="/media">Media centre</Link><Link to="/locations">Locations</Link><Link to="/contact">Contact</Link></div>
              <div><strong>Secure access</strong><Link to="/login">Staff portal</Link><Link to="/content-studio">Content Studio</Link><Link to="/faqs">FAQs</Link><Link to="/tenders">Tenders</Link></div>
            </div>
          </div>
          <div className="c1-footer-bottom"><span>© {new Date().getFullYear()} Chalin 03 Company Limited.</span><span>Published through the governed CHALIN ONE platform.</span></div>
        </footer>
      </div>
    </CorporateContext.Provider>
  );
}

function useCorporate() { return useContext(CorporateContext) || {}; }

function PageHero({ eyebrow, title, text, media, deep = false }) {
  return <header className={`c1-page-hero${media?.url ? " has-media" : ""}${deep ? " c1-page-hero-deep" : ""}`}>{media?.url ? <CorporateMedia media={media} eager /> : <div className="c1-page-hero-art" aria-hidden="true"><span>C1</span><i /><i /><i /></div>}<div className="c1-page-hero-shade" /><div className="c1-page-hero-copy"><span>{eyebrow}</span><h1>{title}</h1>{text ? <p>{text}</p> : null}</div><div className="c1-page-hero-index">CHALIN ONE / {humanize(eyebrow)}</div></header>;
}

function SectionHeading({ index, eyebrow, title, text, action }) {
  return <div className="c1-section-heading"><span className="c1-section-index">{index}</span><div><small>{eyebrow}</small><h2>{title}</h2>{text ? <p>{text}</p> : null}</div>{action || null}</div>;
}

function IntentMatrix() {
  return <section className="c1-intent-section"><div className="c1-intent-heading"><span>00 / START WITH PURPOSE</span><h2>Don’t browse.<br />Enter through your goal.</h2><p>Choose what you need and move directly into the right business context.</p></div><div className="c1-intent-grid">{VISITOR_INTENTS.map((intent) => <Link to={intent.action} key={intent.key}><span>{intent.index}</span><small>{intent.tag}</small><h3>{intent.title}</h3><p>{intent.text}</p><b>→</b></Link>)}</div></section>;
}

function HomePage() {
  const { siteName, tagline, description, divisions = [], statistics = [] } = useCorporate();
  const request = useRequest(async (signal) => {
    const [homepageResult, newsResult, leadershipResult, projectResult, equipmentResult, locationResult] = await Promise.allSettled([
      getPublicHomepage({ signal }),
      listPublicResource("news", { limit: 8, offset: 0 }, { signal }),
      listPublicResource("leadership", { limit: 4, offset: 0 }, { signal }),
      listPublicResource("projects", { limit: 8, offset: 0 }, { signal }),
      listPublicResource("equipment", { limit: 8, offset: 0 }, { signal }),
      listPublicResource("locations", { limit: 6, offset: 0 }, { signal }),
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
  const visualSeedCollections = useMemo(() => ({ divisions: businessItems, leadership, projects, equipment, news }), [businessItems, leadership, projects, equipment, news]);
  useMetadata(page?.seo?.title || `${siteName || "CHALIN ONE"} | Chalin 03 Company Limited`, page?.seo?.description || page?.summary || description);

  return (
    <main className="c1-home">
      <section className={`c1-hero${heroMedia ? " has-image" : ""}`}>
        {heroMedia ? <div className="c1-hero-image" style={{ backgroundImage: `url(${heroMedia.url})` }} role="img" aria-label={heroMedia.alt_text || "CHALIN ONE operations"} /> : null}
        <div className="c1-hero-shade" aria-hidden="true" />
        <div className="c1-hero-signal-field" aria-hidden="true"><div className="c1-signal-core"><span>C1</span></div><i className="c1-signal-ring ring-a" /><i className="c1-signal-ring ring-b" /><i className="c1-signal-ring ring-c" /><b className="c1-signal-word word-a">PARTS</b><b className="c1-signal-word word-b">MINING</b><b className="c1-signal-word word-c">EQUIPMENT</b></div>
        <div className="c1-hero-copy"><div className="c1-hero-kicker"><span>CHALIN 03 COMPANY LIMITED</span><i /> GHANA</div><h1>{page?.title || tagline || "Built to move business forward."}</h1><p>{page?.subtitle || description}</p><div className="c1-hero-actions"><Link className="c1-button c1-button-gold" to="/businesses">Enter CHALIN ONE <b>↗</b></Link><Link className="c1-button c1-button-ghost" to="/contact">Start with your need</Link></div></div>
        <div className="c1-hero-manifesto"><span>THE OPERATING UNIVERSE</span><p>One company identity outside. Clear operating boundaries inside.</p><div><b>03</b><small>specialist businesses</small></div></div>
        <div className="c1-scroll-cue"><span>SCROLL / DISCOVER</span><i /></div>
      </section>
      {news.length > 0 ? <section className="c1-newsline" aria-label="Latest company news"><div><span>LIVE</span><strong>CHALIN ONE SIGNAL</strong></div><div className="c1-newsline-track">{news.slice(0, 4).map((item) => <Link to={`/news/${item.slug}`} key={item.key || item.slug}><b>{item.category?.name || "Update"}</b><span>{item.title}</span><time>{formatDate(item.published_at)}</time></Link>)}</div><Link to="/news">All signals →</Link></section> : null}
      <IntentMatrix />
      {statistics.length > 0 ? <section className="c1-stats" aria-label="Published company statistics"><div className="c1-stats-intro"><span>PUBLIC FACTS</span><strong>Numbers that have passed publication control.</strong></div>{statistics.slice(0, 4).map((stat) => <article key={stat.key}><strong>{stat.prefix}{stat.display_value}{stat.suffix}</strong><span>{stat.label}</span>{stat.source_note ? <small>{stat.source_note}</small> : null}</article>)}</section> : null}
      <section className="c1-section c1-business-section"><SectionHeading index="01" eyebrow="Business worlds" title="Three businesses. Three identities. One standard." text="Each CHALIN business gets a distinct world instead of being flattened into a generic services list." action={<Link className="c1-text-link" to="/businesses">See the full group →</Link>} /><div className="c1-business-grid">{businessItems.map((business, index) => { const fallback = BUSINESS_FALLBACKS[index] || BUSINESS_FALLBACKS[0]; const slug = business.slug || fallback.slug; return <Link className={`c1-business-card world-${index + 1}`} to={`/businesses/${slug}`} key={business.key || slug}>{business.media?.url ? <CorporateMedia media={business.media} /> : <div className="c1-business-art"><b>{business.symbol || fallback.symbol}</b><span>{fallback.pulse}</span></div>}<div className="c1-business-overlay" /><span className="c1-business-number">{business.number || `0${index + 1}`}</span><div className="c1-business-copy"><small>{business.label || fallback.label}</small><h3>{business.name}</h3><p>{business.short_description || business.description || fallback.description}</p><span>Enter world <b>↗</b></span></div></Link>; })}</div></section>
      <section className="c1-operating-model"><div className="c1-operating-intro"><span>02 / THE CHALIN LOOP</span><h2>Operate.<br />Control.<br />Deliver.<br />Communicate.</h2><p>The public website is the visible edge of a deeper operating model.</p></div><div className="c1-operating-panels"><article><span>01</span><strong>Operate</strong><p>Business-specific workspaces keep each operation focused.</p><i /></article><article><span>02</span><strong>Control</strong><p>Governance connects responsibility, records and oversight.</p><i /></article><article><span>03</span><strong>Deliver</strong><p>Customer, equipment and field workflows move through clear paths.</p><i /></article><article><span>04</span><strong>Communicate</strong><p>Only approved information crosses into the public world.</p><i /></article></div></section>
      <section className="c1-section c1-project-section"><SectionHeading index="03" eyebrow="Field stories" title="Proof should feel bigger than a card grid." text="Projects become cinematic field stories when approved media exists." action={<Link className="c1-text-link" to="/projects">Project archive →</Link>} />{projects.length > 0 ? <div className="c1-project-showcase">{projects.slice(0, 4).map((project, index) => <Link className={`c1-project c1-project-${index + 1}`} to={`/projects/${project.slug}`} key={project.key || project.slug}>{project.media?.url ? <CorporateMedia media={project.media} /> : <div className="c1-project-fallback"><span>FIELD / {String(index + 1).padStart(2, "0")}</span></div>}<div className="c1-project-shade" /><div><span>{project.division?.name || humanize(project.status || "Project")}</span><h3>{project.title}</h3><p>{project.summary || project.location || project.location_text || ""}</p></div></Link>)}</div> : <div className="c1-project-showcase c1-project-empty-showcase">{["PROJECT STORIES", "FIELD MEDIA", "DELIVERY PROOF"].map((label, index) => <article key={label}><span>0{index + 1}</span><strong>{label}</strong><p>Reserved for independently approved CHALIN ONE project publishing.</p></article>)}</div>}</section>
      <section className="c1-equipment-band"><div className="c1-equipment-band-head"><div><span>04 / EQUIPMENT INTELLIGENCE</span><h2>Machines should be explored, not buried.</h2><p>A visual equipment stage ready for published availability, specifications and commercial information.</p></div><Link to="/equipment">Open equipment universe →</Link></div>{equipment.length > 0 ? <div className="c1-equipment-strip">{equipment.slice(0, 5).map((item, index) => <Link to={`/equipment/${item.slug}`} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-equipment-fallback">EQ / {String(index + 1).padStart(2, "0")}</div>}<div><small>{item.category?.name || item.manufacturer || "Equipment"}</small><strong>{item.name}</strong><p>{item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ")}</p><span>{formatMoney(item.price) || humanize(item.availability || "Explore")}</span></div></Link>)}</div> : <div className="c1-equipment-empty"><span>CATALOGUE SIGNAL OFFLINE</span><strong>Approved equipment will appear as an interactive visual catalogue.</strong><Link to="/contact?intent=hire">Make an equipment enquiry ↗</Link></div>}</section>
      <section className="c1-leadership-feature"><div className="c1-leadership-image">{leadership[0] && (leadership[0].portrait || leadership[0].media)?.url ? <CorporateMedia media={leadership[0].portrait || leadership[0].media} /> : <div className="c1-leadership-monogram">C1</div>}</div><div className="c1-leadership-copy"><span>05 / ACCOUNTABILITY</span><h2>Responsibility should have a face.</h2><p>Only approved public leadership profiles appear here.</p>{leadership[0] ? <div><strong>{leadership[0].full_name || leadership[0].name}</strong><small>{leadership[0].position || leadership[0].position_title || "Leadership"}</small></div> : <div><strong>Leadership publishing ready</strong><small>Awaiting approved profile content</small></div>}<Link className="c1-button c1-button-dark" to="/leadership">Meet leadership →</Link></div></section>
      <PublicVisualSections sections={page?.sections || []} excludeTypes={["hero"]} seedCollections={visualSeedCollections} />
      <section className="c1-section c1-news-section"><SectionHeading index="06" eyebrow="Newsroom" title="A company should have a pulse." text="Announcements and stories move through an editorial newsroom." action={<Link className="c1-text-link" to="/news">Enter newsroom →</Link>} />{news.length > 0 ? <div className="c1-news-grid">{news.slice(0, 4).map((item, index) => <Link to={`/news/${item.slug}`} className={index === 0 ? "is-featured" : ""} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-news-fallback"><span>NEWS / {String(index + 1).padStart(2, "0")}</span></div>}<div><span>{item.category?.name || "Company news"}</span><h3>{item.title}</h3><p>{item.excerpt || item.summary || ""}</p><time>{formatDate(item.published_at)}</time></div></Link>)}</div> : <EmptyState message="The newsroom is built and waiting for the first independently approved story." />}</section>
      <section className="c1-location-band"><div><span>07 / PHYSICAL WORLD</span><h2>Digital outside.<br />Real operations underneath.</h2><p>Published stores, offices, yards, sites and operating locations become part of the CHALIN ONE network.</p></div><div className="c1-location-list">{locations.length > 0 ? locations.slice(0, 5).map((item, index) => <article key={item.key || item.name}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.name}</strong><p>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</p></div><b>⌖</b></article>) : <article className="is-empty"><span>00</span><div><strong>Location network ready</strong><p>Approved public locations will appear here automatically.</p></div><b>⌖</b></article>}</div><Link to="/locations">Open location network →</Link></section>
      <section className="c1-final-stage"><div className="c1-final-stage-grid" aria-hidden="true" /><span>CHALIN 03 COMPANY LIMITED / CHALIN ONE</span><h2>Don’t just visit.<br />Start something.</h2><p>Find a part, discuss equipment, reach the mining team, explore a career or open a company conversation.</p><div><Link className="c1-button c1-button-gold" to="/contact">Start with your need ↗</Link><Link className="c1-button c1-button-ghost" to="/businesses">Explore the group</Link></div></section>
    </main>
  );
}

function AboutPage() {
  const { divisions = [] } = useCorporate();
  const request = useRequest(async (signal) => { try { return await getPublicPage("about", { signal }); } catch (error) { if (error?.response?.status === 404) return null; throw error; } }, []);
  const page = request.data;
  const businesses = divisions.length > 0 ? divisions.slice(0, 3) : BUSINESS_FALLBACKS;
  useMetadata(page?.seo?.title || "About | CHALIN ONE", page?.seo?.description || page?.summary || "About Chalin 03 Company Limited and CHALIN ONE.");
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  return (
    <main className="c1-page c1-deep-page">
      <PageHero deep eyebrow="Company story" title={page?.title || "One company. Built around real operations."} text={page?.summary || "CHALIN ONE connects Chalin 03 Company Limited’s specialist operating businesses through one public company identity."} media={page?.media} />
      <section className="c1-story-rail"><header><span>01 / WHO WE ARE</span><h2>Built to keep complexity clear.</h2></header><div className="c1-story-copy"><StructuredContent value={page?.body || "Chalin 03 Company Limited operates through specialist business contexts while presenting one professional company identity to customers, partners and the public."} /><p>CHALIN ONE is the public layer: one place to understand the company, enter the right business world and move into the correct next step.</p></div></section>
      <section className="c1-company-architecture"><header><span>02 / COMPANY ARCHITECTURE</span><h2>One group. Three operating worlds.</h2></header><div className="c1-company-grid">{businesses.map((business, index) => { const fallback = BUSINESS_FALLBACKS[index] || BUSINESS_FALLBACKS[0]; const slug = business.slug || fallback.slug; return <Link to={`/businesses/${slug}`} key={business.key || slug}><span>{fallback.number}</span><small>{business.label || fallback.label}</small><h3>{business.name || fallback.name}</h3><p>{business.short_description || business.description || fallback.description}</p><b>Enter business world ↗</b></Link>; })}</div></section>
      <section className="c1-values-stage"><header><span>03 / THE STANDARD</span><h2>How the company wants to show up.</h2></header><div className="c1-values-grid"><article><span>01</span><strong>Clarity</strong><p>Keep customers, staff and management inside the right business context.</p></article><article><span>02</span><strong>Accountability</strong><p>Published information should be controlled, reviewable and owned.</p></article><article><span>03</span><strong>Service</strong><p>Every public journey should make the next useful action obvious.</p></article><article><span>04</span><strong>Progress</strong><p>The company platform should keep improving as the businesses grow.</p></article></div></section>
      <section className="c1-timeline"><header><span>04 / COMPANY EVOLUTION</span><h2>A platform designed to grow with the business.</h2></header><div className="c1-timeline-track"><article><small>FOUNDATION</small><strong>Specialist operations</strong><p>Spare Parts, Mining Operations and Equipment Business keep the workflows that belong to their work.</p></article><article><small>CONNECTION</small><strong>One management standard</strong><p>Shared governance and company identity connect those operations without flattening them.</p></article><article><small>CHALIN ONE</small><strong>One public front door</strong><p>The website becomes the company’s controlled public experience for customers, partners, staff and opportunity seekers.</p></article></div></section>
      <PublicVisualSections sections={page?.sections || []} seedCollections={{ divisions: businesses }} />
      <DeepCta title="Understand the businesses next." primary="Explore businesses" primaryTo="/businesses" secondary="Meet leadership" secondaryTo="/leadership" />
    </main>
  );
}

function BusinessesPage() {
  const { divisions = [] } = useCorporate();
  const items = divisions.length > 0 ? divisions : BUSINESS_FALLBACKS;
  useMetadata("Businesses | CHALIN ONE", "Explore Spare Parts, Mining Operations and Equipment Business across Chalin 03 Company Limited.");
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Business worlds" title="Different missions deserve different worlds." text="Enter each specialist CHALIN business through its own visual, service and enquiry context." /><section className="c1-business-orbit">{items.map((business, index) => { const fallback = BUSINESS_FALLBACKS[index] || businessFallbackForSlug(business.slug) || BUSINESS_FALLBACKS[0]; const slug = business.slug || fallback.slug; return <Link to={`/businesses/${slug}`} key={business.key || slug}><span>{fallback.number}</span><h2>{business.name || fallback.name}</h2><p>{business.short_description || business.description || fallback.description}</p><b>↗</b></Link>; })}</section><section className="c1-values-stage"><header><span>HOW TO ENTER</span><h2>Start with the business—or start with your need.</h2></header><IntentMatrix /></section><DeepCta title="Not sure which business fits?" primary="Use the Navigator" primaryTo="/contact" secondary="General enquiry" secondaryTo="/contact" /></main>;
}

function businessFallbackForSlug(slug) {
  const clean = String(slug || "").toLowerCase();
  if (clean.includes("spare") || clean.includes("parts")) return BUSINESS_FALLBACKS[0];
  if (clean.includes("mining") || clean.includes("mine")) return BUSINESS_FALLBACKS[1];
  if (clean.includes("equipment") || clean.includes("hire") || clean.includes("sales")) return BUSINESS_FALLBACKS[2];
  return null;
}

function businessMatchesEntry(entry, item, fallback) {
  const division = entry?.division || {};
  const haystack = `${division.slug || ""} ${division.name || ""}`.toLowerCase();
  const candidates = [item?.slug, item?.name, fallback?.slug, fallback?.name].filter(Boolean).map((value) => String(value).toLowerCase());
  return candidates.some((candidate) => haystack.includes(candidate) || candidate.split(/[-\s]+/).some((part) => part.length > 4 && haystack.includes(part)));
}

function BusinessSubnav({ slug, section }) {
  const items = [["overview", "Overview"], ["capabilities", "Capabilities"], ["projects", "Projects"], ["gallery", "Media"], ["contact", "Enquire"]];
  return <nav className="c1-business-subnav" aria-label="Business mini-site navigation">{items.map(([key, label]) => <Link className={(section || "overview") === key ? "is-active" : ""} key={key} to={key === "overview" ? `/businesses/${slug}` : `/businesses/${slug}/${key}`}>{label}</Link>)}</nav>;
}

function BusinessDetailPage() {
  const { slug, section } = useParams();
  const fallback = businessFallbackForSlug(slug);
  const request = useRequest(async (signal) => {
    const [divisionResult, projectsResult, equipmentResult] = await Promise.allSettled([
      getPublicResource("divisions", slug, { signal }),
      listPublicResource("projects", { limit: 30, offset: 0 }, { signal }),
      listPublicResource("equipment", { limit: 30, offset: 0 }, { signal }),
    ]);
    return { item: divisionResult.status === "fulfilled" ? divisionResult.value : null, projects: projectsResult.status === "fulfilled" ? listFromResult(projectsResult.value) : [], equipment: equipmentResult.status === "fulfilled" ? listFromResult(equipmentResult.value) : [] };
  }, [slug]);
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error && !fallback) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  const item = request.data?.item || fallback;
  if (!item) return <NotFoundPage />;
  const world = fallback || businessFallbackForSlug(item.slug || item.name) || BUSINESS_FALLBACKS[0];
  const projects = (request.data?.projects || []).filter((entry) => businessMatchesEntry(entry, item, world));
  const equipment = (request.data?.equipment || []).filter((entry) => businessMatchesEntry(entry, item, world));
  const intent = world === BUSINESS_FALLBACKS[0] ? "parts" : world === BUSINESS_FALLBACKS[1] ? "mining" : "hire";
  const currentSection = section || "overview";
  useMetadata(`${item.name || world.name} | CHALIN ONE`, item.short_description || item.description || world.description);
  if (currentSection === "contact") return <Navigate replace to={`/contact?intent=${intent}`} />;
  return (
    <main className={`c1-page c1-deep-page c1-world-${world.symbol.toLowerCase()}`}>
      <PageHero deep eyebrow={`${world.number} / CHALIN ONE BUSINESS`} title={item.name || world.name} text={item.short_description || item.description || world.description} media={item.media} />
      <BusinessSubnav slug={slug} section={currentSection} />
      {currentSection === "overview" ? <><section className="c1-world-intro"><div>{world.symbol}</div><article><span>THE BUSINESS</span><h2>{world.label}</h2><StructuredContent value={item.body || item.details || item.description || world.description} /><p><strong>{world.pulse}</strong></p></article></section><ServiceLanes world={world} /><BusinessProof projects={projects} title="Published work from this business." />{world === BUSINESS_FALLBACKS[2] ? <BusinessEquipment equipment={equipment} /> : null}</> : null}
      {currentSection === "capabilities" ? <section className="c1-story-rail"><header><span>CAPABILITIES</span><h2>What this business is built to handle.</h2></header><div className="c1-story-copy">{item.capabilities ? <StructuredContent value={item.capabilities} /> : <><p>{world.description}</p>{world.lanes.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}</>}</div></section> : null}
      {currentSection === "projects" ? <BusinessProof projects={projects} title="Field work, when approved for publication." /> : null}
      {currentSection === "gallery" ? <section className="c1-proof-rail"><header><span>MEDIA / FIELD JOURNAL</span><h2>The visual record of this business.</h2></header>{Array.isArray(item.gallery) && item.gallery.length > 0 ? <div className="c1-media-mosaic">{item.gallery.map((entry, index) => <CorporateMedia media={entry.media || entry} key={entry.asset_key || index} />)}</div> : <EmptyState message="Approved business photography and field media will build this journal automatically." />}</section> : null}
      <DeepCta title={`Start with ${item.name || world.name}.`} primary="Open the right enquiry" primaryTo={`/contact?intent=${intent}`} secondary="Back to businesses" secondaryTo="/businesses" />
    </main>
  );
}

function ServiceLanes({ world }) { return <section className="c1-service-lanes"><header><span>SERVICE PATHWAYS</span><h2>Three clear ways into this business.</h2></header><div className="c1-lane-grid">{world.lanes.map(([title, text], index) => <article key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{text}</p></article>)}</div></section>; }
function BusinessProof({ projects, title }) { return <section className="c1-proof-rail"><header><span>PROJECT SIGNAL</span><h2>{title}</h2></header>{projects.length > 0 ? <div className="c1-proof-grid">{projects.slice(0, 5).map((project, index) => <Link className="c1-proof-card" to={`/projects/${project.slug}`} key={project.key || project.slug}>{project.media?.url ? <CorporateMedia media={project.media} /> : <div className="c1-card-placeholder">0{index + 1}</div>}<div><small>{project.division?.name || humanize(project.status || "Project")}</small><h3>{project.title}</h3><p>{project.summary || project.location || project.location_text || ""}</p></div></Link>)}</div> : <EmptyState message="Projects tied to this business will appear here after approval and publication." />}</section>; }
function BusinessEquipment({ equipment }) { return <section className="c1-equipment-lab"><header><span>EQUIPMENT SIGNAL</span><h2>Published machines inside this business world.</h2></header>{equipment.length > 0 ? <div className="c1-equipment-grid">{equipment.slice(0, 5).map((item, index) => <Link className="c1-equipment-card-deep" to={`/equipment/${item.slug}`} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-card-placeholder">EQ{index + 1}</div>}<div><small>{item.manufacturer || item.category?.name || "Equipment"}</small><h2>{item.name}</h2><p>{item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ")}</p></div></Link>)}</div> : <EmptyState message="Approved equipment linked to this business will appear here." />}</section>; }

function CollectionPage({ resource, titleOverride }) {
  const config = COLLECTIONS[resource];
  const request = useRequest((signal) => listPublicResource(resource, { limit: 60, offset: 0 }, { signal }), [resource]);
  const items = listFromResult(request.data);
  const title = titleOverride || config.title;
  useMetadata(`${title} | CHALIN ONE`, config.description);
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (resource === "projects") return <ProjectsExperience items={items} />;
  if (resource === "equipment") return <EquipmentExperience items={items} />;
  if (resource === "news") return <NewsExperience items={items} />;
  if (resource === "leadership") return <LeadershipExperience items={items} />;
  if (resource === "vacancies") return <CareersExperience items={items} />;
  if (resource === "locations") return <LocationsExperience items={items} />;
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow={config.eyebrow} title={title} text={config.description} /><section className="c1-collection">{items.length === 0 ? <EmptyState message={`The ${config.eyebrow.toLowerCase()} experience is ready for approved public content.`} /> : <div className="c1-collection-grid">{items.map((item, index) => { const label = config.label(item); const media = item.media || item.portrait || item.document; const content = <>{media?.url ? <CorporateMedia media={media} /> : <div className="c1-card-art"><span>{String(index + 1).padStart(2, "0")}</span><i>C1</i></div>}<div><small>{item.division?.name || humanize(item.status || item.category?.name || config.eyebrow)}</small><h2>{label}</h2><p>{config.summary(item)}</p>{formatMoney(item.price) ? <strong>{formatMoney(item.price)}</strong> : null}{item.published_at ? <time>{formatDate(item.published_at)}</time> : null}<span className="c1-card-arrow">Open signal ↗</span></div></>; return config.detail && item.slug ? <Link className="c1-collection-card" to={`/${resource}/${item.slug}`} key={item.key || item.slug || index}>{content}</Link> : <article className="c1-collection-card" key={item.key || item.slug || index}>{content}</article>; })}</div>}</section></main>;
}

function ProjectsExperience({ items }) { return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Projects" title="Work should leave a visible footprint." text="A field-story archive built from projects that have been approved for public release." /><section className="c1-proof-rail"><header><span>FIELD ARCHIVE</span><h2>Stories, not thumbnails.</h2></header>{items.length > 0 ? <div className="c1-proof-grid">{items.map((item, index) => <Link className="c1-proof-card" to={`/projects/${item.slug}`} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-card-placeholder">P{String(index + 1).padStart(2, "0")}</div>}<div><small>{item.division?.name || humanize(item.status || "Project")}</small><h3>{item.title}</h3><p>{item.summary || item.location || item.location_text || ""}</p></div></Link>)}</div> : <EmptyState message="The project archive is ready for the first approved field story." />}</section><DeepCta title="Have a project conversation?" primary="Contact CHALIN ONE" primaryTo="/contact" secondary="Explore businesses" secondaryTo="/businesses" /></main>; }

function EquipmentExperience({ items }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); if (!q) return items; return items.filter((item) => `${item.name || ""} ${item.manufacturer || ""} ${item.model || ""} ${item.category?.name || ""}`.toLowerCase().includes(q)); }, [items, query]);
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Equipment" title="Search the machine universe." text="A visual catalogue for equipment that has been approved for public display." /><div className="c1-filter-bar"><input aria-label="Search published equipment" placeholder="Search machine, manufacturer, model or category…" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{filtered.length} PUBLISHED</span></div><section className="c1-equipment-lab"><header><span>EQUIPMENT LAB</span><h2>{query ? "Filtered equipment signal." : "Machines, surfaced properly."}</h2></header>{filtered.length > 0 ? <div className="c1-equipment-grid">{filtered.map((item, index) => <Link className="c1-equipment-card-deep" to={`/equipment/${item.slug}`} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-card-placeholder">EQ{String(index + 1).padStart(2, "0")}</div>}<div><small>{item.category?.name || item.manufacturer || humanize(item.availability || "Equipment")}</small><h2>{item.name}</h2><p>{item.short_description || [item.manufacturer, item.model].filter(Boolean).join(" ")}</p><strong>{formatMoney(item.price) || humanize(item.availability || "Explore")}</strong></div></Link>)}</div> : <EmptyState message={query ? "No published equipment matches that search." : "The equipment catalogue is ready for approved listings."} />}</section><DeepCta title="Need a machine that is not listed?" primary="Equipment enquiry" primaryTo="/contact?intent=hire" secondary="Equipment Business" secondaryTo="/businesses/equipment-business" /></main>;
}

function NewsExperience({ items }) { return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Newsroom" title="A company should have a pulse." text="The CHALIN ONE newsroom turns approved company updates into an editorial signal, not a notice board." /><section className="c1-newsroom-layout">{items.length > 0 ? <div className="c1-editorial-feed">{items.map((item, index) => <Link className="c1-editorial-story" to={`/news/${item.slug}`} key={item.key || item.slug}>{item.media?.url ? <CorporateMedia media={item.media} /> : <div className="c1-card-placeholder">N{String(index + 1).padStart(2, "0")}</div>}<div><small>{item.category?.name || "Company signal"}</small><h2>{item.title}</h2><p>{item.excerpt || item.summary || ""}</p><time>{formatDate(item.published_at)}</time></div></Link>)}</div> : <EmptyState message="The newsroom is ready for the first approved story." />}</section><DeepCta title="Looking for something specific?" primary="Contact the company" primaryTo="/contact" secondary="Media centre" secondaryTo="/media" /></main>; }
function LeadershipExperience({ items }) { return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Leadership" title="Responsibility should have a face." text="Leadership appears here only when a public profile has passed the company publishing workflow." /><section className="c1-leadership-stage"><header><span>ACCOUNTABILITY</span><h2>The people publicly representing the company.</h2></header>{items.length > 0 ? <div className="c1-leader-grid">{items.map((item, index) => <article className="c1-leader-card" key={item.key || item.slug || index}>{(item.portrait || item.media)?.url ? <CorporateMedia media={item.portrait || item.media} /> : <div className="c1-card-placeholder">L{String(index + 1).padStart(2, "0")}</div>}<div><small>{item.position || item.position_title || "Leadership"}</small><h2>{item.full_name || item.name}</h2><p>{item.professional_summary || item.summary || ""}</p></div></article>)}</div> : <EmptyState message="Approved leadership profiles will build this accountability wall." />}</section><DeepCta title="Explore the company behind the profiles." primary="About CHALIN ONE" primaryTo="/about" secondary="Start a conversation" secondaryTo="/contact" /></main>; }
function CareersExperience({ items }) { return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Careers" title="Build your next chapter where the work is real." text="Published opportunities across CHALIN ONE businesses appear here with their proper business and location context." /><section className="c1-career-stage"><header><span>OPEN OPPORTUNITIES</span><h2>Roles with a clear place in the company.</h2></header>{items.length > 0 ? <div className="c1-career-grid">{items.map((item) => <Link className="c1-career-card" to={`/careers/${item.slug}`} key={item.key || item.slug}><span>{item.division?.name || humanize(item.employment_type || "Opportunity")}</span><h2>{item.title}</h2><p>{item.summary || item.location?.name || item.location || ""}</p><b>View opportunity ↗</b></Link>)}</div> : <EmptyState message="No vacancy is publicly listed right now. New approved opportunities will appear here automatically." />}</section><section className="c1-values-stage"><header><span>BEFORE YOU APPLY</span><h2>Know where you are entering.</h2></header><div className="c1-values-grid"><article><span>01</span><strong>Business context</strong><p>Every opportunity belongs to a real CHALIN business, not a generic talent pool.</p></article><article><span>02</span><strong>Clear information</strong><p>Published role requirements and application instructions come from the governed source.</p></article><article><span>03</span><strong>Secure application</strong><p>Use only the application pathway shown on the published opportunity.</p></article><article><span>04</span><strong>Company view</strong><p>Explore the business pages first to understand where the role fits.</p></article></div></section></main>; }
function LocationsExperience({ items }) { return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Locations" title="The physical CHALIN network." text="Published stores, offices, yards, sites and operating locations in one company view." /><section className="c1-network-stage"><header><span>OPERATING FOOTPRINT</span><h2>Digital front door. Physical places underneath.</h2></header>{items.length > 0 ? <div className="c1-network-grid">{items.map((item, index) => <article className="c1-network-card" key={item.key || item.name}><span>{String(index + 1).padStart(2, "0")} / ⌖</span><h2>{item.name}</h2><p>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</p></article>)}</div> : <EmptyState message="Approved public locations will build the CHALIN network here." />}</section><DeepCta title="Need directions or the right location?" primary="Contact CHALIN ONE" primaryTo="/contact" secondary="Explore businesses" secondaryTo="/businesses" /></main>; }

function DetailPage({ resource }) {
  const { slug } = useParams();
  const request = useRequest((signal) => getPublicResource(resource, slug, { signal }), [resource, slug]);
  const item = request.data;
  const config = COLLECTIONS[resource] || COLLECTIONS.news;
  useMetadata(`${item ? config.label(item) : config.title} | CHALIN ONE`, item ? config.summary(item) : config.description);
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (!item) return <NotFoundPage />;
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow={config.eyebrow} title={config.label(item)} text={config.summary(item)} media={item.media || item.document} /><section className="c1-detail-layout"><article><StructuredContent value={item.body || item.details || item.description} />{item.specifications ? <section><h2>Specifications</h2><StructuredContent value={item.specifications} /></section> : null}{item.features ? <section><h2>Features</h2><StructuredContent value={item.features} /></section> : null}<StructuredContent value={item.requirements} /><StructuredContent value={item.application_instructions || item.submission_instructions} /></article><aside>{item.division?.name ? <p><span>Division</span><strong>{item.division.name}</strong></p> : null}{item.location?.name || item.location || item.location_text ? <p><span>Location</span><strong>{item.location?.name || item.location || item.location_text}</strong></p> : null}{item.status ? <p><span>Status</span><strong>{humanize(item.status)}</strong></p> : null}{item.availability ? <p><span>Availability</span><strong>{humanize(item.availability)}</strong></p> : null}{formatMoney(item.price) ? <p><span>Published price</span><strong>{formatMoney(item.price)}</strong></p> : null}{item.manufacturer ? <p><span>Manufacturer</span><strong>{item.manufacturer}</strong></p> : null}{item.model ? <p><span>Model</span><strong>{item.model}</strong></p> : null}{item.reference_number ? <p><span>Reference</span><strong>{item.reference_number}</strong></p> : null}{item.published_at ? <p><span>Published</span><strong>{formatDate(item.published_at)}</strong></p> : null}{item.application_url ? <a className="c1-button c1-button-gold" href={item.application_url}>Apply securely ↗</a> : null}<Link className="c1-button c1-button-dark" to="/contact">Continue with CHALIN ONE</Link></aside></section>{Array.isArray(item.gallery) && item.gallery.length > 0 ? <section className="c1-media-mosaic">{item.gallery.map((entry, index) => <CorporateMedia media={entry.media || entry} key={entry.asset_key || index} />)}</section> : null}<DeepCta title="Continue from this story." primary="Start an enquiry" primaryTo="/contact" secondary="Back to the archive" secondaryTo={`/${resource === "vacancies" ? "careers" : resource}`} /></main>;
}

function MediaPage() {
  const request = useRequest(async (signal) => { const resources = ["news", "projects", "equipment", "leadership"]; const settled = await Promise.allSettled(resources.map((resource) => listPublicResource(resource, { limit: 20, offset: 0 }, { signal }))); return settled.flatMap((result) => result.status === "fulfilled" ? listFromResult(result.value) : []).map((item) => item.media || item.portrait).filter((media) => media?.url); }, []);
  const media = request.data || [];
  useMetadata("Media centre | CHALIN ONE", "Published CHALIN ONE photography and visual stories.");
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Media centre" title="See the company in motion." text="A visual field journal assembled automatically from approved CHALIN ONE publishing." /><section className="c1-media-mosaic c1-media-mosaic-page">{request.loading ? <LoadingState /> : request.error ? <ErrorState message={request.error} /> : media.length === 0 ? <EmptyState message="Published photography will automatically form this visual journal." /> : media.map((item, index) => <CorporateMedia media={item} key={item.asset_key || item.url || index} />)}</section></main>;
}

function FaqPage() {
  const request = useRequest((signal) => listPublicResource("faqs", {}, { signal }), []);
  const items = listFromResult(request.data);
  useMetadata("Frequently asked questions | CHALIN ONE", "Published answers to common questions about CHALIN ONE.");
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Help centre" title="Questions should disappear quickly." text="Published answers to common customer, supplier and company questions." /><section className="c1-faqs">{request.loading ? <LoadingState /> : request.error ? <ErrorState message={request.error} /> : items.length === 0 ? <EmptyState /> : items.map((item, index) => <details key={item.key || index}><summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}<b>+</b></summary><StructuredContent value={item.answer} /></details>)}</section></main>;
}

function responseDefault(field) {
  if (["multiselect", "checkbox_group"].includes(field.type)) return [];
  if (["checkbox", "boolean"].includes(field.type)) return false;
  return "";
}

function PublicField({ field, value, onChange }) {
  if (field.type === "textarea") return <textarea rows="5" required={field.required} value={value || ""} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "select") return <select required={field.required} value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multiselect") return <select multiple required={field.required} value={Array.isArray(value) ? value : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "radio") return <div className="c1-choice-row">{(field.options || []).map((option) => <label key={option}><input type="radio" name={field.key} value={option} checked={value === option} onChange={() => onChange(option)} /><span>{option}</span></label>)}</div>;
  if (field.type === "checkbox_group") return <div className="c1-choice-row">{(field.options || []).map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => onChange(event.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value : []).filter((entry) => entry !== option))} /><span>{option}</span></label>)}</div>;
  if (["checkbox", "boolean"].includes(field.type)) return <label className="c1-check"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{field.placeholder || "Yes"}</label>;
  return <input type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"} required={field.required} value={value ?? ""} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
}

const INTENT_TO_SERVICE = Object.freeze({ parts: "Spare Parts", hire: "Equipment Hire", buy: "Equipment Sales", mining: "Mining Operations", finance: "Installment Finance" });

function ContactPage({ formSlug = "contact" }) {
  const [searchParams] = useSearchParams();
  const intent = String(searchParams.get("intent") || "").toLowerCase();
  const locationRequest = useRequest((signal) => listPublicResource("locations", { limit: 8, offset: 0 }, { signal }), []);
  const formRequest = useRequest(async (signal) => { try { return await getPublicForm(formSlug, { signal }); } catch (error) { if (error?.response?.status === 404) return null; throw error; } }, [formSlug]);
  const form = formRequest.data;
  const locations = listFromResult(locationRequest.data);
  const [contact, setContact] = useState({ full_name: "", email: "", phone: "", company_name: "", consent_given: false, website: "" });
  const [responses, setResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(null);
  useMetadata("Contact | CHALIN ONE", "Contact Chalin 03 Company Limited through CHALIN ONE.");
  useEffect(() => { if (!form) return; const defaults = Object.fromEntries((form.fields || []).map((field) => [field.key, responseDefault(field)])); if (INTENT_TO_SERVICE[intent] && Object.prototype.hasOwnProperty.call(defaults, "service_interest")) defaults.service_interest = INTENT_TO_SERVICE[intent]; setResponses(defaults); }, [form, intent]);
  async function submit(event) { event.preventDefault(); if (!form || submitting) return; setSubmitting(true); setSubmitError(""); try { const result = await submitPublicForm(form.slug, { ...contact, consent_text_version: form.settings?.consent_text_version || "privacy-v1", source_page_slug: "contact", source_url: window.location.href, responses }); setSuccess(result); } catch (error) { setSubmitError(publicWebsiteErrorMessage(error)); } finally { setSubmitting(false); } }
  const selectedIntent = VISITOR_INTENTS.find((item) => item.key === intent);
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow="Start something" title={selectedIntent ? selectedIntent.title : "Tell us what you need."} text={selectedIntent ? selectedIntent.text : "A structured entry point into the right CHALIN ONE business team."} /><section className="c1-contact-layout"><div className="c1-contact-context"><span>YOUR ENTRY SIGNAL</span><h2>{selectedIntent ? selectedIntent.tag : "General company enquiry"}</h2><p>The form carries your intent so you do not start from zero.</p><div className="c1-contact-intents">{VISITOR_INTENTS.slice(0, 4).map((item) => <Link className={item.key === intent ? "is-active" : ""} to={`/contact?intent=${item.key}`} key={item.key}>{item.title}<span>↗</span></Link>)}</div>{locations.length > 0 ? <div className="c1-contact-locations"><strong>Published locations</strong>{locations.slice(0, 3).map((item) => <article key={item.key || item.name}><span>⌖</span><div><b>{item.name}</b><small>{[item.address, item.city, item.region, item.country].filter(Boolean).join(", ")}</small></div></article>)}</div> : null}</div><div className="c1-contact-form-shell">{formRequest.loading ? <LoadingState label="Preparing your enquiry route…" /> : formRequest.error ? <ErrorState message={formRequest.error} /> : !form ? <EmptyState message="The public contact form has not been published yet." /> : success ? <div className="c1-form-success"><span>ENQUIRY RECEIVED</span><h2>Your signal is in.</h2><p>{form.confirmation_message || "Thank you. Your enquiry has been received."}</p><strong>Reference: {success.reference_code || "Provided by the enquiry desk"}</strong><Link className="c1-button c1-button-dark" to="/">Return to CHALIN ONE</Link></div> : <form className="c1-contact-form" onSubmit={submit}><div className="c1-form-heading"><span>CHALIN ONE / ENQUIRY DESK</span><h2>{form.name}</h2><p>{form.description}</p></div><div className="c1-contact-basics"><label><span>Your name</span><input required value={contact.full_name} onChange={(event) => setContact((value) => ({ ...value, full_name: event.target.value }))} /></label><label><span>Company</span><input value={contact.company_name} onChange={(event) => setContact((value) => ({ ...value, company_name: event.target.value }))} /></label><label><span>Email</span><input type="email" value={contact.email} onChange={(event) => setContact((value) => ({ ...value, email: event.target.value }))} /></label><label><span>Phone</span><input type="tel" value={contact.phone} onChange={(event) => setContact((value) => ({ ...value, phone: event.target.value }))} /></label><label className="c1-honeypot" aria-hidden="true"><span>Website</span><input tabIndex="-1" autoComplete="off" value={contact.website} onChange={(event) => setContact((value) => ({ ...value, website: event.target.value }))} /></label></div><div className="c1-dynamic-fields">{(form.fields || []).map((field) => <label key={field.key}><span>{field.label}{field.required ? " *" : ""}</span>{field.help_text ? <small>{field.help_text}</small> : null}<PublicField field={field} value={responses[field.key]} onChange={(value) => setResponses((current) => ({ ...current, [field.key]: value }))} /></label>)}</div><label className="c1-consent"><input type="checkbox" required={form.settings?.require_consent !== false} checked={contact.consent_given} onChange={(event) => setContact((value) => ({ ...value, consent_given: event.target.checked }))} /><span>I agree that the information provided can be used to review and respond to this enquiry.</span></label>{submitError ? <div className="c1-inline-error" role="alert">{submitError}</div> : null}<button className="c1-button c1-button-gold" type="submit" disabled={submitting}>{submitting ? "Routing your enquiry…" : form.settings?.submit_label || "Send enquiry"}<b>↗</b></button></form>}</div></section></main>;
}

function PublishedPage() {
  const { slug } = useParams();
  const request = useRequest((signal) => getPublicPage(slug, { signal }), [slug]);
  const page = request.data;
  useMetadata(page?.seo?.title || `${page?.title || humanize(slug)} | CHALIN ONE`, page?.seo?.description || page?.summary || "Published CHALIN ONE company information.");
  if (request.loading) return <main className="c1-page"><LoadingState /></main>;
  if (request.error) return <main className="c1-page"><ErrorState message={request.error} /></main>;
  if (!page) return <NotFoundPage />;
  return <main className="c1-page c1-deep-page"><PageHero deep eyebrow={page.menu_title || "CHALIN ONE"} title={page.title} text={page.subtitle || page.summary} media={page.media} /><section className="c1-published-body"><StructuredContent value={page.body} /></section><PublicVisualSections sections={page.sections || []} /></main>;
}

function DeepCta({ title, primary, primaryTo, secondary, secondaryTo }) { return <section className="c1-deep-cta"><div><span>CHALIN ONE / NEXT MOVE</span><h2>{title}</h2></div><div><Link className="c1-button c1-button-gold" to={primaryTo}>{primary} ↗</Link><Link className="c1-button c1-button-dark" to={secondaryTo}>{secondary}</Link></div></section>; }
function NotFoundPage() { useMetadata("Not found | CHALIN ONE", "This CHALIN ONE public page is not available."); return <main className="c1-not-found"><div><span>404 / SIGNAL LOST</span><h1>You’ve moved beyond the published map.</h1><p>This page is not available in the public CHALIN ONE experience.</p><div><Link className="c1-button c1-button-gold" to="/">Return home</Link><Link className="c1-button c1-button-ghost" to="/contact">Ask CHALIN ONE</Link></div></div><b>C1</b></main>; }
function LegacyWebsiteRedirect() { const location = useLocation(); const suffix = location.pathname.replace(/^\/website\/?/, ""); return <Navigate replace to={suffix ? `/${suffix}${location.search}${location.hash}` : `/${location.search}${location.hash}`} />; }
export function PublicCorporateWebsiteUnavailable() { return <main className="c1-unavailable"><img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" /><span>CHALIN ONE</span><h1>Public website temporarily unavailable.</h1><p>The staff system remains separate and secure.</p><Link className="c1-button c1-button-dark" to="/login">Open Staff portal</Link></main>; }

export default function PublicCorporateWebsiteApp() {
  return (
    <Routes>
      <Route element={<CorporateLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="businesses" element={<BusinessesPage />} />
        <Route path="businesses/:slug" element={<BusinessDetailPage />} />
        <Route path="businesses/:slug/:section" element={<BusinessDetailPage />} />
        <Route path="projects" element={<CollectionPage resource="projects" />} />
        <Route path="projects/:slug" element={<DetailPage resource="projects" />} />
        <Route path="equipment" element={<CollectionPage resource="equipment" />} />
        <Route path="equipment/:slug" element={<DetailPage resource="equipment" />} />
        <Route path="news" element={<CollectionPage resource="news" />} />
        <Route path="news/:slug" element={<DetailPage resource="news" />} />
        <Route path="leadership" element={<CollectionPage resource="leadership" />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="careers" element={<CollectionPage resource="vacancies" />} />
        <Route path="careers/:slug" element={<DetailPage resource="vacancies" />} />
        <Route path="locations" element={<CollectionPage resource="locations" />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="faqs" element={<FaqPage />} />
        <Route path="tenders" element={<CollectionPage resource="tenders" />} />
        <Route path="tenders/:slug" element={<DetailPage resource="tenders" />} />
        <Route path="testimonials" element={<CollectionPage resource="testimonials" />} />
        <Route path="forms/:slug" element={<ContactPage />} />
        <Route path="pages/:slug" element={<PublishedPage />} />
        <Route path="website/*" element={<LegacyWebsiteRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
