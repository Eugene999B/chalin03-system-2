import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { getPage, listPages } from "./contentStudioPageApi";
import { listMedia } from "./contentStudioOperationsApi";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import { getVisualSectionDefinition } from "./contentStudioVisualBuilderModel";
import {
  compareReleaseMetadata,
  compareReleaseSections,
  evaluatePageReleaseReadiness,
  selectReleaseVersions,
} from "./contentStudioReleaseReadinessModel";
import "./contentStudioReleaseReadiness.css";

function displayStatus(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function versionLabel(version) {
  if (!version) return "No version";
  return `v${version.version_number || "—"} · ${displayStatus(version.version_status)}`;
}

function readinessLabel(state) {
  if (state === "ready") return "READY";
  if (state === "ready_with_warnings") return "READY / REVIEW WARNINGS";
  if (state === "blocked") return "BLOCKED";
  return "NOT READY";
}

function ChangeBadge({ status }) {
  return <span className={`cs-rr-change is-${status}`}>{status}</span>;
}

function IssueGroup({ severity, issues }) {
  const filtered = issues.filter((item) => item.severity === severity);
  if (!filtered.length) return null;
  return (
    <section className={`cs-rr-issues is-${severity}`}>
      <header>
        <span>{severity === "blocker" ? "RELEASE BLOCKERS" : severity === "warning" ? "REVIEW WARNINGS" : "RELEASE CONTEXT"}</span>
        <strong>{filtered.length}</strong>
      </header>
      <div>
        {filtered.map((item, index) => (
          <article key={`${item.code}-${item.sectionKey}-${index}`}>
            <span>{severity === "blocker" ? "!" : severity === "warning" ? "△" : "i"}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              {item.sectionKey ? <small>Section: {item.sectionKey}</small> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionChangeList({ comparison, hasPublished }) {
  const visible = comparison.changes.filter((change) => change.status !== "unchanged");
  return (
    <section className="cs-rr-compare-panel">
      <header>
        <div><span>STRUCTURE DIFF</span><strong>{hasPublished ? "Candidate vs published" : "First-publication structure"}</strong></div>
        <div className="cs-rr-diff-counts">
          <b>+{comparison.counts.added}</b>
          <b>~{comparison.counts.changed + comparison.counts.moved}</b>
          <b>-{comparison.counts.removed}</b>
        </div>
      </header>
      <div className="cs-rr-change-list">
        {visible.map((change) => {
          const definition = getVisualSectionDefinition(change.type);
          return (
            <article key={`${change.key}-${change.status}`}>
              <span className="cs-rr-section-badge">{definition.badge}</span>
              <div><small>{change.key}</small><strong>{definition.label}</strong></div>
              <ChangeBadge status={change.status} />
              <small className="cs-rr-position">
                {change.beforeIndex === null ? "new" : `${change.beforeIndex + 1}`}
                {" → "}
                {change.afterIndex === null ? "removed" : `${change.afterIndex + 1}`}
              </small>
            </article>
          );
        })}
        {!visible.length ? (
          <div className="cs-rr-empty"><strong>No structural/content section changes detected.</strong><span>The candidate section canvas matches the published baseline.</span></div>
        ) : null}
      </div>
    </section>
  );
}

function MetadataChangeList({ metadata, hasPublished }) {
  const changed = metadata.filter((item) => item.changed);
  return (
    <section className="cs-rr-compare-panel">
      <header><div><span>PAGE + SEO DIFF</span><strong>{hasPublished ? `${changed.length} changed fields` : "First-publication metadata"}</strong></div></header>
      <div className="cs-rr-meta-list">
        {changed.map((item) => (
          <article key={item.key}>
            <strong>{item.label}</strong>
            <div><span>Published</span><p>{String(item.before || "—")}</p></div>
            <div><span>Candidate</span><p>{String(item.after || "—")}</p></div>
          </article>
        ))}
        {!changed.length ? <div className="cs-rr-empty"><strong>No metadata changes detected.</strong><span>Page and SEO fields match the published baseline.</span></div> : null}
      </div>
    </section>
  );
}

export default function ContentStudioReleaseReadiness() {
  const auth = useAuth();
  const canViewMedia = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.mediaView);
  const [pages, setPages] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [mediaAudit, setMediaAudit] = useState({ available: false, complete: false, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const versions = useMemo(() => selectReleaseVersions(details || {}), [details]);
  const comparison = useMemo(
    () => compareReleaseSections(versions.candidate, versions.published),
    [versions.candidate, versions.published]
  );
  const metadata = useMemo(
    () => compareReleaseMetadata(versions.candidate || {}, versions.published || {}),
    [versions.candidate, versions.published]
  );
  const readiness = useMemo(
    () => evaluatePageReleaseReadiness({
      page: details?.page || {},
      candidate: versions.candidate,
      published: versions.published,
      mediaAudit,
    }),
    [details?.page, mediaAudit, versions.candidate, versions.published]
  );

  const loadPages = useCallback(async ({ signal } = {}) => {
    try {
      const result = await listPages({ search, limit: 100, offset: 0 }, { signal });
      if (!signal?.aborted) setPages(Array.isArray(result?.items) ? result.items : []);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, [search]);

  const loadMediaAudit = useCallback(async ({ signal } = {}) => {
    if (!canViewMedia) {
      setMediaAudit({ available: false, complete: false, items: [] });
      return;
    }
    try {
      const result = await listMedia({ limit: 500, offset: 0 }, { signal });
      if (signal?.aborted) return;
      const items = Array.isArray(result?.items) ? result.items : [];
      const total = Number(result?.total ?? items.length);
      setMediaAudit({ available: true, complete: total <= items.length, items });
    } catch (requestError) {
      if (!signal?.aborted) {
        setMediaAudit({ available: false, complete: false, items: [] });
        setError(contentStudioErrorMessage(requestError));
      }
    }
  }, [canViewMedia]);

  const openPage = useCallback(async (pageId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const next = await getPage(pageId, { signal });
      if (!signal?.aborted) {
        setSelectedId(next?.page?.id || pageId);
        setDetails(next);
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPages({ signal: controller.signal });
    return () => controller.abort();
  }, [loadPages]);

  useEffect(() => {
    const controller = new AbortController();
    loadMediaAudit({ signal: controller.signal });
    return () => controller.abort();
  }, [loadMediaAudit]);

  return (
    <section className="cs-rr-shell">
      <header className="cs-rr-command">
        <div className="cs-rr-mark">RR</div>
        <div>
          <span>PHASE 2E / RELEASE READINESS</span>
          <h2>Know exactly what will change before review or publication.</h2>
          <p>Compare the release candidate to the current published version, inspect structural and SEO changes, and resolve public-readiness blockers without giving this desk any publish or approval authority.</p>
        </div>
        <div className="cs-rr-safety"><strong>READ ONLY</strong><small>No approval · no publish</small></div>
      </header>

      {error ? <div className="cs-rr-alert" role="alert"><strong>Release audit could not complete</strong><span>{error}</span><button type="button" onClick={() => setError("")}>Close</button></div> : null}

      <div className="cs-rr-layout">
        <aside className="cs-rr-pages">
          <header><span>RELEASE TARGET</span><strong>Choose a governed page</strong></header>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages" aria-label="Search release readiness pages" />
          <div>
            {pages.map((page) => (
              <button type="button" key={page.id} className={Number(page.id) === Number(selectedId) ? "is-active" : ""} onClick={() => openPage(page.id)}>
                <span><strong>{page.latest_title || page.menu_title || page.slug}</strong><small>/{page.slug}</small></span>
                <b>{displayStatus(page.publication_status)}</b>
              </button>
            ))}
            {pages.length === 0 ? <div className="cs-rr-empty"><strong>No pages match this search.</strong></div> : null}
          </div>
        </aside>

        <main className="cs-rr-desk" aria-busy={loading ? "true" : "false"}>
          {!details ? (
            <div className="cs-rr-zero"><span>PRE-PUBLICATION DESK</span><strong>Select a page to compare its release candidate.</strong><p>The audit does not mutate versions, approvals or publication state.</p></div>
          ) : (
            <>
              <section className={`cs-rr-verdict is-${readiness.state}`}>
                <div>
                  <span>{details.page?.is_homepage ? "HOMEPAGE RELEASE" : `/${details.page?.slug || "page"}`}</span>
                  <h3>{versions.candidate?.title || details.page?.menu_title || "Untitled page"}</h3>
                  <small>Candidate {versionLabel(versions.candidate)} · Published {versionLabel(versions.published)}</small>
                </div>
                <div className="cs-rr-verdict-state">
                  <strong>{readinessLabel(readiness.state)}</strong>
                  <span>{readiness.blockers} blockers · {readiness.warnings} warnings</span>
                </div>
              </section>

              <section className="cs-rr-scoreboard">
                <article><span>BLOCKERS</span><strong>{readiness.blockers}</strong><small>must resolve</small></article>
                <article><span>WARNINGS</span><strong>{readiness.warnings}</strong><small>review deliberately</small></article>
                <article><span>SECTIONS</span><strong>{comparison.candidate.length}</strong><small>candidate blocks</small></article>
                <article><span>CHANGES</span><strong>{comparison.changes.filter((item) => item.status !== "unchanged").length}</strong><small>vs published</small></article>
                <article><span>MEDIA AUDIT</span><strong>{mediaAudit.available ? (mediaAudit.complete ? "FULL" : "PART") : "N/A"}</strong><small>{mediaAudit.available ? `${mediaAudit.items.length} assets visible` : "role/API unavailable"}</small></article>
              </section>

              <div className="cs-rr-comparisons">
                <SectionChangeList comparison={comparison} hasPublished={Boolean(versions.published)} />
                <MetadataChangeList metadata={metadata} hasPublished={Boolean(versions.published)} />
              </div>

              <section className="cs-rr-checklist-head">
                <div><span>RELEASE CHECKLIST</span><strong>Resolve blockers; review every warning.</strong></div>
                <p>This desk is evidence for Editor, Reviewer and Publisher. Governance decisions remain in the normal approval workflow.</p>
              </section>
              <div className="cs-rr-checklist">
                <IssueGroup severity="blocker" issues={readiness.issues} />
                <IssueGroup severity="warning" issues={readiness.issues} />
                <IssueGroup severity="info" issues={readiness.issues} />
                {!readiness.issues.length ? <div className="cs-rr-all-clear"><span>✓</span><div><strong>No release-readiness issues detected.</strong><p>The candidate can proceed to the normal governed review/publish workflow.</p></div></div> : null}
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
