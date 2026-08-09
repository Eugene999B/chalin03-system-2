import { useCallback, useEffect, useMemo, useState } from "react";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { getWebsiteControlIntelligence } from "./contentStudioWebsiteControlApi";
import {
  PUBLIC_METADATA_CAPABILITIES,
  healthScoreTone,
  issueCount,
  matchesWebsiteControlQuery,
  normalizeWebsiteControl,
  rowHasSeverity,
  websiteControlTone,
} from "./contentStudioWebsiteControlModel";
import "./contentStudioWebsiteControlCenter.css";

const TABS = ["overview", "seo", "navigation", "orphans", "redirects"];
const TAB_LABELS = { overview: "Overview", seo: "SEO health", navigation: "Navigation", orphans: "Orphan pages", redirects: "Redirect intelligence" };

function Empty({ title, message }) {
  return <div className="cs-empty-state cs-wcc-empty"><strong>{title}</strong><span>{message}</span></div>;
}

function Issues({ items = [] }) {
  if (!items.length) return <div className="cs-wcc-clear"><strong>✓ No blocking record issues detected.</strong></div>;
  return <div className="cs-wcc-issues">{items.map((item, index) => <div key={`${item.code}-${index}`} className={`is-${websiteControlTone(item.severity)}`}><span className={`cs-status-chip cs-status-${websiteControlTone(item.severity)}`}>{item.severity}</span><p><strong>{String(item.code || "issue").replaceAll("_", " ")}</strong><small>{item.message}</small></p></div>)}</div>;
}

function Kpi({ label, value, note, tone }) {
  return <article className={`cs-wcc-kpi is-${tone || "neutral"}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function PageCard({ page, onOpenSection }) {
  return <article className="cs-wcc-record"><header><div><span>{page.public_path}</span><h4>{page.title || page.page_key}</h4><small>{page.publication_status} · {page.latest_version_status || "no version"}</small></div><b>{issueCount(page)} issues</b></header><div className="cs-wcc-meta"><span><small>SEO title</small><strong>{page.seo_title || "Fallback only"}</strong></span><span><small>Canonical</small><strong>{page.canonical_url || "Not configured"}</strong></span><span><small>Robots</small><strong>{page.robots_directive || "index,follow"}</strong></span></div><Issues items={page.issues} /><footer><button type="button" onClick={() => onOpenSection?.("pages")}>Open Pages →</button></footer></article>;
}

function NavigationCard({ item, onOpenSection }) {
  return <article className="cs-wcc-record"><header><div><span>{item.navigation_location}</span><h4>{item.label || item.navigation_key}</h4><small>{item.publication_status} · {item.page_id ? `page #${item.page_id}` : item.url || "no target"}</small></div><b>{issueCount(item)} issues</b></header>{item.target_page ? <div className="cs-wcc-target"><small>Governed target</small><strong>{item.target_page.title}</strong><span>{item.target_page.public_path} · {item.target_page.publication_status}</span></div> : null}<Issues items={item.issues} /><footer><button type="button" onClick={() => onOpenSection?.("navigation")}>Open Navigation →</button></footer></article>;
}

export default function ContentStudioWebsiteControlCenter({ onOpenSection }) {
  const [data, setData] = useState(() => normalizeWebsiteControl());
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true); setError("");
    try {
      const result = await getWebsiteControlIntelligence({ signal });
      if (!signal?.aborted) setData(normalizeWebsiteControl(result || {}));
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { const controller = new AbortController(); load({ signal: controller.signal }); return () => controller.abort(); }, [load]);

  const pages = useMemo(() => data.pages.filter((row) => matchesWebsiteControlQuery(row, query) && rowHasSeverity(row, severity)), [data.pages, query, severity]);
  const navigation = useMemo(() => data.navigation.filter((row) => matchesWebsiteControlQuery(row, query) && rowHasSeverity(row, severity)), [data.navigation, query, severity]);
  const priorityPages = useMemo(() => data.pages.filter((row) => row.issues?.some((item) => ["critical", "warning"].includes(item.severity))).slice(0, 6), [data.pages]);
  const priorityNavigation = useMemo(() => data.navigation.filter((row) => row.issues?.some((item) => ["critical", "warning"].includes(item.severity))).slice(0, 6), [data.navigation]);
  const s = data.summary;

  return <div className="cs-wcc-shell">
    <section className="cs-wcc-hero"><div className="cs-wcc-mark">WC</div><div><span>WEBSITE / CONTROL CENTER</span><h2>Website Control Center</h2><p>Audit governed pages and navigation before release. This desk diagnoses SEO, indexing, navigation and redirect risks without changing published content.</p></div><div className={`cs-wcc-score is-${healthScoreTone(s.healthScore)}`}><strong>{s.healthScore}</strong><span>health score</span><small>{data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-GH") : "Waiting for audit"}</small></div></section>
    {error ? <div className="cs-alert cs-alert-danger" role="alert"><div><strong>Website audit not completed</strong><span>{error}</span></div><button type="button" onClick={() => setError("")}>Close</button></div> : null}

    <section className="cs-wcc-capabilities"><header><div><span>PUBLIC RENDERER</span><h3>Metadata capability coverage</h3><p>Platform gaps are tracked separately from editor content quality.</p></div><button type="button" className="cs-button cs-button-secondary" onClick={() => load()} disabled={loading}>{loading ? "Auditing…" : "Run fresh audit"}</button></header><div>{PUBLIC_METADATA_CAPABILITIES.map((item) => <article key={item.key} className={`is-${item.status}`}><span>{item.status === "active" ? "ACTIVE" : "PHASE 2H NEXT"}</span><strong>{item.label}</strong><small>{item.note}</small></article>)}</div></section>

    <section className="cs-wcc-kpis"><Kpi label="Healthy pages" value={`${s.healthyPages}/${s.totalPages}`} note="No critical or warning record issues" tone={s.attentionPages ? "warning" : "success"} /><Kpi label="Page issues" value={s.pageIssues.total} note={`${s.pageIssues.critical} critical · ${s.pageIssues.warning} warnings`} tone={s.pageIssues.critical ? "danger" : s.pageIssues.warning ? "warning" : "success"} /><Kpi label="Navigation issues" value={s.navigationIssues.total} note={`${s.navigationItems} governed items checked`} tone={s.navigationIssues.critical ? "danger" : s.navigationIssues.warning ? "warning" : "success"} /><Kpi label="Orphan pages" value={s.orphanPages} note="Outside governed Navigation" tone={s.orphanPages ? "warning" : "success"} /><Kpi label="Redirect candidates" value={s.redirectCandidates} note="Review in Redirect Manager" tone={s.redirectCandidates ? "warning" : "success"} /></section>

    <nav className="cs-wcc-tabs" aria-label="Website Control Center views">{TABS.map((key) => <button type="button" key={key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{TAB_LABELS[key]}</button>)}</nav>

    {tab === "overview" ? <div className="cs-wcc-overview"><section><header><div><span>PAGE PRIORITY</span><h3>Content records needing attention</h3></div><button type="button" onClick={() => setTab("seo")}>View all →</button></header>{priorityPages.length ? <div className="cs-wcc-grid">{priorityPages.map((page) => <PageCard key={page.id} page={page} onOpenSection={onOpenSection} />)}</div> : <Empty title="Page records are clear." message="No critical or warning page-record issues were detected." />}</section><section><header><div><span>NAVIGATION PRIORITY</span><h3>Menu targets needing attention</h3></div><button type="button" onClick={() => setTab("navigation")}>View all →</button></header>{priorityNavigation.length ? <div className="cs-wcc-grid">{priorityNavigation.map((item) => <NavigationCard key={item.id} item={item} onOpenSection={onOpenSection} />)}</div> : <Empty title="Navigation targets are clear." message="No critical or warning target issues were detected." />}</section></div> : null}

    {tab === "seo" || tab === "navigation" ? <section className="cs-wcc-queue"><header><div><span>{tab === "seo" ? "SEO / INDEXING" : "NAVIGATION / ROUTES"}</span><h3>{tab === "seo" ? `${pages.length} page records` : `${navigation.length} menu items`}</h3></div></header><div className="cs-wcc-filters"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search record, path or issue" /><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></div><div className="cs-wcc-grid">{tab === "seo" ? pages.map((page) => <PageCard key={page.id} page={page} onOpenSection={onOpenSection} />) : navigation.map((item) => <NavigationCard key={item.id} item={item} onOpenSection={onOpenSection} />)}</div></section> : null}

    {tab === "orphans" ? <section className="cs-wcc-queue"><header><div><span>DISCOVERABILITY</span><h3>{data.orphanPages.length} pages outside governed Navigation</h3><p>They may still be reachable from contextual or hard-coded website links.</p></div><button type="button" onClick={() => onOpenSection?.("navigation")}>Open Navigation →</button></header>{data.orphanPages.length ? <div className="cs-wcc-simple-grid">{data.orphanPages.map((page) => <article key={page.id}><span>{page.public_path}</span><strong>{page.title}</strong><small>{page.publication_status}</small><p>{page.note}</p><button type="button" onClick={() => onOpenSection?.("pages")}>Review page →</button></article>)}</div> : <Empty title="No governed-navigation orphans." message="Every non-homepage page is represented in governed Navigation." />}</section> : null}

    {tab === "redirects" ? <section className="cs-wcc-queue"><header><div><span>REDIRECT INTELLIGENCE</span><h3>{data.redirectCandidates.length} review candidates</h3><p>Control Center remains advisory; approved redirect rules are created and activated in Redirect Manager.</p></div><button type="button" onClick={() => onOpenSection?.("redirects")}>Open Redirect Manager →</button></header>{data.redirectCandidates.length ? <div className="cs-wcc-simple-grid">{data.redirectCandidates.map((item, index) => <article key={`${item.kind}-${index}`}><span>{String(item.kind).replaceAll("_", " ")}</span><div className="cs-wcc-route"><strong>{item.source || "Unknown"}</strong><b>→</b><strong>{item.destination || "Confirm destination"}</strong></div><p>{item.note}</p><button type="button" onClick={() => onOpenSection?.("redirects")}>Prepare governed redirect →</button></article>)}</div> : <Empty title="No redirect candidates detected." message="Current page canonicals and governed internal navigation do not suggest a redirect review." />}</section> : null}

    <footer className="cs-wcc-note"><strong>Controlled handoff</strong><span>Control Center diagnoses. Pages, Navigation and Redirect Manager own the governed changes and publisher activation.</span></footer>
  </div>;
}
