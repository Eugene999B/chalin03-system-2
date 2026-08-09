import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  getPage,
  listPages,
  updatePageDraft,
} from "./contentStudioPageApi";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import {
  getVisualSectionDefinition,
  visualSectionForSave,
  visualSectionFromRecord,
} from "./contentStudioVisualBuilderModel";
import {
  VISUAL_PAGE_TEMPLATES,
  getVisualPageTemplate,
  visualTemplatesForContext,
} from "./contentStudioPageTemplateModel";
import {
  REVISION_APPLICATION_MODES,
  analyzeTemplateApplication,
  revisionSequencesEqual,
  revisionSnapshot,
} from "./contentStudioRevisionModel";
import "./contentStudioRevisionIntelligence.css";

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function pageDraftState(details) {
  const page = details?.page || {};
  const versions = Array.isArray(details?.versions) ? details.versions : [];
  const version = versions.find((item) => item.version_status === "draft") || versions[0] || null;
  return {
    page,
    version,
    sections: Array.isArray(version?.sections)
      ? version.sections.map(visualSectionFromRecord)
      : [],
  };
}

function pagePayload(details, version, sections) {
  const page = details?.page || {};
  return {
    page_key: page.page_key || "",
    slug: page.slug || "",
    page_type: page.page_type || "standard",
    template_key: page.template_key || "standard",
    menu_title: page.menu_title || version?.title || "",
    title: version?.title || "",
    subtitle: version?.subtitle || "",
    summary: version?.summary || "",
    body: version?.body_json || version?.body || {},
    seo_title: version?.seo_title || "",
    meta_description: version?.meta_description || "",
    canonical_url: version?.canonical_url || "",
    robots_directive: version?.robots_directive || "index,follow",
    primary_media_asset_id: version?.primary_media_asset_id || null,
    is_homepage: page.is_homepage === true,
    show_in_search: page.show_in_search !== false,
    show_in_sitemap: page.show_in_sitemap !== false,
    change_summary: "Revision Intelligence template composition",
    sections: revisionSnapshot(sections).map(visualSectionForSave),
  };
}

function Sequence({ sections = [], title }) {
  return (
    <div className="cs-ri-sequence-block">
      <div className="cs-ri-sequence-head"><span>{title}</span><strong>{sections.length} blocks</strong></div>
      <div className="cs-ri-sequence" aria-label={title}>
        {sections.map((section, index) => {
          const type = section.section_type || section.type || "custom";
          const definition = getVisualSectionDefinition(type);
          return (
            <div key={`${section.section_key || type}-${index}`}>
              <span>{definition.badge}</span>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <strong>{definition.label}</strong>
            </div>
          );
        })}
        {sections.length === 0 ? <div className="is-empty"><strong>Empty canvas</strong><small>No governed blocks.</small></div> : null}
      </div>
    </div>
  );
}

function HistoryControls({ index, total, onUndo, onRedo, onReset, dirty }) {
  return (
    <div className="cs-ri-history" aria-label="Revision history controls">
      <div><span>SESSION HISTORY</span><strong>{index + 1} / {Math.max(total, 1)}</strong><small>{dirty ? "Unsaved staged structure" : "Matches loaded draft"}</small></div>
      <div>
        <button type="button" onClick={onUndo} disabled={index <= 0}>Undo</button>
        <button type="button" onClick={onRedo} disabled={index >= total - 1}>Redo</button>
        <button type="button" onClick={onReset} disabled={!dirty}>Reset</button>
      </div>
    </div>
  );
}

export default function ContentStudioRevisionIntelligence({ onCommitted }) {
  const auth = useAuth();
  const canEdit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.edit);
  const [pages, setPages] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [templateKey, setTemplateKey] = useState("corporate-profile");
  const [mode, setMode] = useState("fill_gaps");
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [serverSections, setServerSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const draft = useMemo(() => pageDraftState(details), [details]);
  const homepage = draft.page?.is_homepage === true;
  const editable = Boolean(draft.version) && draft.version.version_status === "draft" && canEdit;
  const workingSections = history[historyIndex] || [];
  const dirty = !revisionSequencesEqual(workingSections, serverSections);
  const templates = useMemo(() => visualTemplatesForContext({ homepage }), [homepage]);
  const selectedTemplate = getVisualPageTemplate(templateKey) || templates[0] || VISUAL_PAGE_TEMPLATES[0];
  const analysis = useMemo(
    () => analyzeTemplateApplication({ templateKey: selectedTemplate?.key, sections: workingSections, homepage, mode }),
    [homepage, mode, selectedTemplate?.key, workingSections]
  );

  const loadPages = useCallback(async ({ signal } = {}) => {
    try {
      const result = await listPages({ search, limit: 100, offset: 0 }, { signal });
      if (!signal?.aborted) setPages(Array.isArray(result?.items) ? result.items : []);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, [search]);

  const openPage = useCallback(async (pageId, { signal } = {}) => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const next = await getPage(pageId, { signal });
      if (signal?.aborted) return;
      const nextDraft = pageDraftState(next);
      const sections = revisionSnapshot(nextDraft.sections);
      setSelectedId(nextDraft.page?.id || pageId);
      setDetails(next);
      setServerSections(sections);
      setHistory([sections]);
      setHistoryIndex(0);
      setMode("fill_gaps");
      setTemplateKey(nextDraft.page?.is_homepage ? "homepage-orchestration" : "corporate-profile");
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

  function pushHistory(nextSections) {
    const next = revisionSnapshot(nextSections);
    setHistory((current) => [...current.slice(0, historyIndex + 1), next]);
    setHistoryIndex((current) => current + 1);
  }

  function stageTemplate() {
    if (!editable || !analysis.allowed) return;
    if (mode === "replace" && workingSections.length) {
      const confirmed = window.confirm("Stage a replacement of the entire current section canvas? This is still local and can be undone before committing.");
      if (!confirmed) return;
    }
    if (revisionSequencesEqual(analysis.planned, workingSections)) {
      setNotice("This template produces no structural change in the current mode.");
      return;
    }
    pushHistory(analysis.planned);
    setNotice(`${selectedTemplate.label} staged locally using ${REVISION_APPLICATION_MODES.find((item) => item.key === mode)?.label || mode}. Nothing has been written to the draft yet.`);
  }

  function undo() {
    setHistoryIndex((current) => Math.max(0, current - 1));
    setNotice("Undid the last staged structural change. The server draft is still unchanged.");
  }

  function redo() {
    setHistoryIndex((current) => Math.min(history.length - 1, current + 1));
    setNotice("Restored the next staged structural change. The server draft is still unchanged.");
  }

  function reset() {
    setHistory([revisionSnapshot(serverSections)]);
    setHistoryIndex(0);
    setNotice("Staged changes cleared. The workspace matches the loaded server draft again.");
  }

  async function commitDraft() {
    if (!editable || !selectedId || !draft.version?.id || !dirty || saving) return;
    const confirmed = window.confirm("Commit this staged section structure to the current draft? This does not approve or publish the page.");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updatePageDraft(selectedId, draft.version.id, pagePayload(details, draft.version, workingSections));
      const refreshed = await getPage(selectedId);
      const refreshedDraft = pageDraftState(refreshed);
      const sections = revisionSnapshot(refreshedDraft.sections);
      setDetails(refreshed);
      setServerSections(sections);
      setHistory([sections]);
      setHistoryIndex(0);
      setNotice("Revision committed to the governed draft. The public website remains unchanged until review and publication.");
      onCommitted?.();
      await loadPages();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cs-ri-shell">
      <header className="cs-ri-command">
        <div className="cs-ri-mark">RI</div>
        <div><span>PHASE 2D / REVISION INTELLIGENCE</span><h2>Apply templates to existing drafts—without guessing.</h2><p>Load a governed draft, inspect overlaps, preview the exact structural result, stage changes locally with undo/redo, then commit only when the composition is right.</p></div>
        <div className="cs-ri-safety"><strong>NO DIRECT PUBLISH</strong><small>Draft structure only</small></div>
      </header>

      {error ? <div className="cs-ri-alert is-error" role="alert"><strong>Revision action not completed</strong><span>{error}</span><button type="button" onClick={() => setError("")}>Close</button></div> : null}
      {notice ? <div className="cs-ri-alert" role="status"><strong>Revision workspace updated</strong><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}

      <div className="cs-ri-layout">
        <aside className="cs-ri-pages">
          <header><span>DRAFT TARGET</span><strong>Choose a governed page</strong></header>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages" aria-label="Search revision pages" />
          <div>
            {pages.map((page) => (
              <button type="button" key={page.id} className={Number(page.id) === Number(selectedId) ? "is-active" : ""} onClick={() => openPage(page.id)}>
                <span><strong>{page.latest_title || page.menu_title || page.slug}</strong><small>/{page.slug}</small></span>
                <b>{statusLabel(page.publication_status)}</b>
              </button>
            ))}
            {pages.length === 0 ? <div className="cs-ri-empty">No pages match this search.</div> : null}
          </div>
        </aside>

        <main className="cs-ri-workbench" aria-busy={loading ? "true" : "false"}>
          {!details ? (
            <div className="cs-ri-zero"><span>REVISION WORKBENCH</span><strong>Select a page to inspect its current draft structure.</strong><p>No template is applied automatically.</p></div>
          ) : (
            <>
              <div className="cs-ri-page-head">
                <div><span>{homepage ? "HOMEPAGE DRAFT" : `/${draft.page.slug || "page"}`}</span><h3>{draft.version?.title || draft.page.menu_title || "Untitled page"}</h3><small>Version {draft.version?.version_number || "—"} · {statusLabel(draft.version?.version_status)}</small></div>
                <div className={`cs-ri-edit-state${editable ? " is-ready" : ""}`}><strong>{editable ? "EDITABLE DRAFT" : "READ ONLY"}</strong><small>{editable ? "Local staging enabled" : "Create/open a draft version in Visual Builder first"}</small></div>
              </div>

              <HistoryControls index={historyIndex} total={history.length} onUndo={undo} onRedo={redo} onReset={reset} dirty={dirty} />

              <div className="cs-ri-template-controls">
                <label><span>Template</span><select value={selectedTemplate?.key || ""} onChange={(event) => setTemplateKey(event.target.value)} disabled={!editable}>{templates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</select><small>{homepage ? "Homepage is restricted to the dedicated orchestration template." : selectedTemplate?.note}</small></label>
                <div className="cs-ri-modes" role="radiogroup" aria-label="Template application mode">
                  {REVISION_APPLICATION_MODES.map((item) => (
                    <button type="button" role="radio" aria-checked={mode === item.key} className={mode === item.key ? "is-active" : ""} key={item.key} onClick={() => setMode(item.key)} disabled={!editable}><strong>{item.label}</strong><small>{item.description}</small></button>
                  ))}
                </div>
              </div>

              <div className="cs-ri-analysis">
                <div className="cs-ri-numbers">
                  <article><span>CURRENT</span><strong>{workingSections.length}</strong><small>staged blocks</small></article>
                  <article><span>ADD</span><strong>+{analysis.added}</strong><small>template blocks</small></article>
                  <article><span>REMOVE</span><strong>-{analysis.removed}</strong><small>in this mode</small></article>
                  <article><span>SKIP</span><strong>{analysis.skipped}</strong><small>duplicate types</small></article>
                </div>

                {analysis.overlaps.length ? <div className="cs-ri-overlaps"><span>OVERLAP DETECTED</span><div>{analysis.overlaps.map((item) => <b key={item.type}>{getVisualSectionDefinition(item.type).label} · {item.current} current / {item.template} template</b>)}</div></div> : <div className="cs-ri-overlaps is-clear"><span>NO TYPE OVERLAP</span><strong>The selected template introduces section types not currently present.</strong></div>}

                {analysis.warnings.length ? <div className="cs-ri-warnings">{analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
              </div>

              <div className="cs-ri-compare">
                <Sequence sections={workingSections} title="CURRENT STAGED STRUCTURE" />
                <div className="cs-ri-arrow" aria-hidden="true">→</div>
                <Sequence sections={analysis.planned} title="IF TEMPLATE IS STAGED" />
              </div>

              <div className="cs-ri-actions">
                <div><strong>{dirty ? "You have unsaved staged structural changes." : "The revision workspace matches the loaded draft."}</strong><small>Staging a template changes only this browser session. Commit writes to the draft version; review and publication remain separate.</small></div>
                <div>
                  <button type="button" onClick={stageTemplate} disabled={!editable || !analysis.allowed}>Stage template</button>
                  <button type="button" className="is-primary" onClick={commitDraft} disabled={!editable || !dirty || saving}>{saving ? "Committing draft…" : "Commit to draft →"}</button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
