import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  createPage,
  createPageVersion,
  getPage,
  listPages,
  submitPageVersion,
  updatePageDraft,
} from "./contentStudioPageApi";
import { listMedia } from "./contentStudioOperationsApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import {
  VISUAL_PREVIEW_DEVICES,
  VISUAL_SECTION_CATEGORIES,
  VISUAL_SECTION_LIBRARY,
  createVisualSection,
  duplicateVisualSection,
  getVisualSectionDefinition,
  normalizeVisualContent,
  reorderVisualSections,
  safeVisualActionUrl,
  visualSectionForSave,
  visualSectionFromRecord,
  visualSectionSummary,
} from "./contentStudioVisualBuilderModel";
import "./contentStudioVisualBuilder.css";

const EMPTY_CREATE = Object.freeze({
  page_key: "",
  slug: "",
  title: "",
  subtitle: "",
  summary: "",
  is_homepage: false,
});

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function pageFormFromDetails(details, version = null) {
  const page = details?.page || {};
  const selectedVersion = version || details?.versions?.[0] || {};
  return {
    page_key: page.page_key || "",
    slug: page.slug || "",
    page_type: page.page_type || "standard",
    template_key: page.template_key || "standard",
    menu_title: page.menu_title || selectedVersion.title || "",
    title: selectedVersion.title || "",
    subtitle: selectedVersion.subtitle || "",
    summary: selectedVersion.summary || "",
    body: selectedVersion.body_json || selectedVersion.body || {},
    seo_title: selectedVersion.seo_title || "",
    meta_description: selectedVersion.meta_description || "",
    canonical_url: selectedVersion.canonical_url || "",
    robots_directive: selectedVersion.robots_directive || "index,follow",
    primary_media_asset_id: selectedVersion.primary_media_asset_id || "",
    is_homepage: page.is_homepage === true,
    show_in_search: page.show_in_search !== false,
    show_in_sitemap: page.show_in_sitemap !== false,
    change_summary: selectedVersion.change_summary || "",
    sections: Array.isArray(selectedVersion.sections)
      ? selectedVersion.sections.map(visualSectionFromRecord)
      : [],
  };
}

function pagePayload(form) {
  return {
    page_key: form.page_key,
    slug: form.slug,
    page_type: form.page_type || "standard",
    template_key: form.template_key || "standard",
    menu_title: form.menu_title || form.title,
    title: form.title,
    subtitle: form.subtitle,
    summary: form.summary,
    body: form.body && typeof form.body === "object" ? form.body : {},
    seo_title: form.seo_title,
    meta_description: form.meta_description,
    canonical_url: form.canonical_url,
    robots_directive: form.robots_directive || "index,follow",
    primary_media_asset_id: cleanId(form.primary_media_asset_id),
    is_homepage: Boolean(form.is_homepage),
    show_in_search: form.show_in_search !== false,
    show_in_sitemap: form.show_in_sitemap !== false,
    change_summary: form.change_summary || "Visual Builder draft",
    sections: (form.sections || []).map(visualSectionForSave),
  };
}

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`cs-vb-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusChip({ value }) {
  return (
    <span className={`cs-status-chip cs-status-${contentStudioStatusTone(value)}`}>
      {statusLabel(value)}
    </span>
  );
}

function Notice({ error, notice, onClear }) {
  const value = error || notice;
  if (!value) return null;
  return (
    <div className={`cs-alert ${error ? "cs-alert-danger" : "cs-alert-success"}`} role={error ? "alert" : "status"}>
      <div>
        <strong>{error ? "Visual Builder action not completed" : "Visual Builder updated"}</strong>
        <span>{value}</span>
      </div>
      <button type="button" onClick={onClear}>Close</button>
    </div>
  );
}

function SectionLibrary({ open, onClose, onChoose }) {
  const [category, setCategory] = useState("All");
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  const items = category === "All"
    ? VISUAL_SECTION_LIBRARY
    : VISUAL_SECTION_LIBRARY.filter((item) => item.category === category);

  return (
    <div className="cs-vb-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-vb-library-title">
      <button type="button" className="cs-vb-dialog-backdrop" aria-label="Close section library" onClick={onClose} />
      <section className="cs-vb-library-panel">
        <header>
          <div>
            <span>SECTION LIBRARY / NO CODE</span>
            <h2 id="cs-vb-library-title">Add a visual section</h2>
            <p>Choose a governed building block. You can reorder, hide, duplicate or edit it after adding.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close section library">Close ×</button>
        </header>
        <div className="cs-vb-library-filters" aria-label="Section categories">
          {["All", ...VISUAL_SECTION_CATEGORIES].map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? "is-active" : ""}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="cs-vb-library-grid">
          {items.map((item) => (
            <button type="button" key={item.type} onClick={() => onChoose(item.type)}>
              <span>{item.badge}</span>
              <small>{item.category}</small>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              <b>Add section +</b>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MediaPicker({ open, assets, loading, error, onClose, onChoose, onRetry }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="cs-vb-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-vb-media-title">
      <button type="button" className="cs-vb-dialog-backdrop" aria-label="Close media picker" onClick={onClose} />
      <section className="cs-vb-media-panel">
        <header>
          <div>
            <span>MEDIA LIBRARY / PUBLISHED ASSETS</span>
            <h2 id="cs-vb-media-title">Choose approved media</h2>
            <p>Only public, ready assets are offered here so a visual draft cannot accidentally depend on private media.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close media picker">Close ×</button>
        </header>
        {error ? <div className="cs-vb-media-error"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div> : null}
        {loading ? <div className="cs-vb-media-empty">Loading approved media…</div> : null}
        {!loading && !error && assets.length === 0 ? (
          <div className="cs-vb-media-empty">
            <strong>No public ready media yet.</strong>
            <span>Use Media Library to upload/process an image or register a video, then mark it public.</span>
          </div>
        ) : null}
        <div className="cs-vb-media-grid">
          {assets.map((asset) => (
            <button type="button" key={asset.id} onClick={() => onChoose(asset)}>
              <div>
                {asset.media_type === "image" && asset.public_url ? (
                  <img src={asset.public_url} alt={asset.alt_text || asset.display_name || "Approved media"} loading="lazy" />
                ) : (
                  <span className="cs-vb-video-tile">{asset.media_type === "video" ? "VIDEO" : "MEDIA"}</span>
                )}
              </div>
              <strong>{asset.display_name || asset.original_filename || `Asset ${asset.id}`}</strong>
              <small>#{asset.id} · {asset.media_type}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function RepeaterEditor({ type, items, disabled, onChange }) {
  const safeItems = Array.isArray(items) ? items : [];
  const isFaq = type === "faq";
  const isStatistics = type === "statistics";
  const isTestimonials = type === "testimonials";
  if (!isFaq && !isStatistics && !isTestimonials) return null;

  function updateItem(index, key, value) {
    onChange(safeItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  function addItem() {
    if (isFaq) onChange([...safeItems, { question: "", answer: "" }]);
    else if (isStatistics) onChange([...safeItems, { value: "", label: "", note: "" }]);
    else onChange([...safeItems, { quote: "", name: "", role: "" }]);
  }

  return (
    <div className="cs-vb-repeater">
      <div className="cs-vb-repeater-head">
        <strong>{isFaq ? "Questions" : isStatistics ? "Metrics" : "Quotes"}</strong>
        {!disabled ? <button type="button" onClick={addItem}>Add item +</button> : null}
      </div>
      {safeItems.map((item, index) => (
        <article key={index}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          {isFaq ? (
            <>
              <input aria-label={`Question ${index + 1}`} placeholder="Question" value={item.question || ""} disabled={disabled} onChange={(event) => updateItem(index, "question", event.target.value)} />
              <textarea aria-label={`Answer ${index + 1}`} placeholder="Answer" rows="3" value={item.answer || ""} disabled={disabled} onChange={(event) => updateItem(index, "answer", event.target.value)} />
            </>
          ) : isStatistics ? (
            <>
              <input aria-label={`Metric value ${index + 1}`} placeholder="Value, e.g. 24/7" value={item.value || ""} disabled={disabled} onChange={(event) => updateItem(index, "value", event.target.value)} />
              <input aria-label={`Metric label ${index + 1}`} placeholder="Label" value={item.label || ""} disabled={disabled} onChange={(event) => updateItem(index, "label", event.target.value)} />
              <input aria-label={`Metric note ${index + 1}`} placeholder="Optional note" value={item.note || ""} disabled={disabled} onChange={(event) => updateItem(index, "note", event.target.value)} />
            </>
          ) : (
            <>
              <textarea aria-label={`Quote ${index + 1}`} placeholder="Approved quote" rows="3" value={item.quote || ""} disabled={disabled} onChange={(event) => updateItem(index, "quote", event.target.value)} />
              <input aria-label={`Name ${index + 1}`} placeholder="Name" value={item.name || ""} disabled={disabled} onChange={(event) => updateItem(index, "name", event.target.value)} />
              <input aria-label={`Role ${index + 1}`} placeholder="Role or company" value={item.role || ""} disabled={disabled} onChange={(event) => updateItem(index, "role", event.target.value)} />
            </>
          )}
          {!disabled ? (
            <button type="button" className="is-remove" onClick={() => onChange(safeItems.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
          ) : null}
        </article>
      ))}
      {safeItems.length === 0 ? <div className="cs-vb-repeater-empty">No items yet.</div> : null}
    </div>
  );
}

function SectionInspector({ section, index, editable, canViewMedia, onPatch, onContent, onSettings, onChooseMedia }) {
  if (!section) return <div className="cs-vb-inspector-empty">Choose a section on the canvas to edit it.</div>;
  const definition = getVisualSectionDefinition(section.section_type);
  const content = normalizeVisualContent(section.content_json);
  const settings = section.settings_json || {};
  const actionType = ["hero", "split", "cta", "contact"].includes(section.section_type);
  const secondaryAction = ["hero", "cta"].includes(section.section_type);

  return (
    <div className="cs-vb-inspector">
      <header>
        <span>{definition.badge}</span>
        <div><small>SECTION {String(index + 1).padStart(2, "0")}</small><h3>{definition.label}</h3></div>
        <i>{definition.category}</i>
      </header>
      <Field label="Section heading"><input value={section.heading || ""} disabled={!editable} onChange={(event) => onPatch({ heading: event.target.value })} /></Field>
      <Field label="Supporting line"><input value={section.subheading || ""} disabled={!editable} onChange={(event) => onPatch({ subheading: event.target.value })} /></Field>
      {["hero", "split"].includes(section.section_type) ? (
        <Field label="Eyebrow / kicker"><input value={content.eyebrow || ""} disabled={!editable} onChange={(event) => onContent("eyebrow", event.target.value)} /></Field>
      ) : null}
      <Field label="Body copy" hint="Safe structured content only. Raw HTML and scripts are never accepted here.">
        <textarea rows="5" value={content.text || ""} disabled={!editable} onChange={(event) => onContent("text", event.target.value)} />
      </Field>

      {actionType ? (
        <div className="cs-vb-action-fields">
          <Field label={section.section_type === "contact" ? "Action label" : "Primary button label"}>
            <input value={content.primary_label || content.action_label || content.link_label || ""} disabled={!editable} onChange={(event) => onContent(section.section_type === "contact" ? "action_label" : section.section_type === "split" ? "link_label" : "primary_label", event.target.value)} />
          </Field>
          <Field label="Action URL" hint="Use a site path like /contact or an HTTPS URL.">
            <input value={content.primary_url || content.action_url || content.link_url || ""} disabled={!editable} onChange={(event) => onContent(section.section_type === "contact" ? "action_url" : section.section_type === "split" ? "link_url" : "primary_url", event.target.value)} />
          </Field>
          {secondaryAction ? (
            <>
              <Field label="Secondary button label"><input value={content.secondary_label || ""} disabled={!editable} onChange={(event) => onContent("secondary_label", event.target.value)} /></Field>
              <Field label="Secondary URL"><input value={content.secondary_url || ""} disabled={!editable} onChange={(event) => onContent("secondary_url", event.target.value)} /></Field>
            </>
          ) : null}
        </div>
      ) : null}

      {section.section_type === "form" ? (
        <Field label="Published form key" hint="This is a governed form reference, not arbitrary embedded code."><input value={content.form_key || ""} disabled={!editable} onChange={(event) => onContent("form_key", event.target.value)} /></Field>
      ) : null}

      <RepeaterEditor
        type={section.section_type}
        items={content.items}
        disabled={!editable}
        onChange={(items) => onContent("items", items)}
      />

      <div className="cs-vb-appearance">
        <strong>Appearance</strong>
        <div className="cs-vb-mini-grid">
          <Field label="Theme">
            <select value={settings.theme || "light"} disabled={!editable} onChange={(event) => onSettings("theme", event.target.value)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="paper">Paper</option>
              <option value="accent">Accent</option>
            </select>
          </Field>
          <Field label="Layout">
            <select value={settings.layout || "contained"} disabled={!editable} onChange={(event) => onSettings("layout", event.target.value)}>
              <option value="contained">Contained</option>
              <option value="wide">Wide</option>
              <option value="full">Full stage</option>
              <option value="split">Split</option>
              <option value="cards">Cards</option>
              <option value="rail">Horizontal rail</option>
              <option value="band">Band</option>
              <option value="metrics">Metrics</option>
              <option value="accordion">Accordion</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="cs-vb-media-controls">
        <strong>Media</strong>
        <div>
          <button type="button" disabled={!editable || !canViewMedia} onClick={() => onChooseMedia("primary")}>{section.primary_media_asset_id ? `Primary #${section.primary_media_asset_id}` : "Choose primary media"}</button>
          <button type="button" disabled={!editable || !canViewMedia} onClick={() => onChooseMedia("background")}>{section.background_media_asset_id ? `Background #${section.background_media_asset_id}` : "Choose background"}</button>
        </div>
        {!canViewMedia ? <small>Your Studio role does not include Media Library access.</small> : null}
      </div>
    </div>
  );
}

function PreviewSection({ section, index }) {
  const definition = getVisualSectionDefinition(section.section_type);
  const content = normalizeVisualContent(section.content_json);
  const theme = section.settings_json?.theme || "light";
  const mediaUrl = section.primary_media_preview_url || section.background_media_preview_url || "";
  const items = Array.isArray(content.items) ? content.items : [];
  const primaryUrl = safeVisualActionUrl(content.primary_url || content.action_url || content.link_url);
  const secondaryUrl = safeVisualActionUrl(content.secondary_url);

  return (
    <section className={`cs-vb-preview-section is-${section.section_type} theme-${theme}`}>
      <div className="cs-vb-preview-section-copy">
        <span>{content.eyebrow || `${String(index + 1).padStart(2, "0")} / ${definition.label.toUpperCase()}`}</span>
        {section.heading ? <h3>{section.heading}</h3> : <h3>Untitled {definition.label}</h3>}
        {section.subheading ? <p className="is-subtitle">{section.subheading}</p> : null}
        {content.text ? <p>{content.text}</p> : null}
        {section.section_type === "statistics" && items.length ? (
          <div className="cs-vb-preview-metrics">
            {items.slice(0, 6).map((item, itemIndex) => <article key={itemIndex}><strong>{item.value || "—"}</strong><span>{item.label || "Metric"}</span>{item.note ? <small>{item.note}</small> : null}</article>)}
          </div>
        ) : null}
        {section.section_type === "faq" && items.length ? (
          <div className="cs-vb-preview-faq">
            {items.slice(0, 6).map((item, itemIndex) => <article key={itemIndex}><strong>{item.question || "Question"}</strong><p>{item.answer || "Answer"}</p></article>)}
          </div>
        ) : null}
        {section.section_type === "testimonials" && items.length ? (
          <div className="cs-vb-preview-quotes">
            {items.slice(0, 3).map((item, itemIndex) => <blockquote key={itemIndex}><p>{item.quote || "Approved quote"}</p><footer>{item.name || "Name"}{item.role ? ` · ${item.role}` : ""}</footer></blockquote>)}
          </div>
        ) : null}
        {["divisions", "leadership", "projects", "equipment", "news", "gallery"].includes(section.section_type) ? (
          <div className="cs-vb-preview-collection" aria-label={`${definition.label} collection preview`}>
            {[1, 2, 3].map((item) => <article key={item}><span>{definition.badge}</span><strong>Published record</strong><small>Governed collection placement</small></article>)}
          </div>
        ) : null}
        {content.form_key ? <div className="cs-vb-preview-form"><span>FORM</span><strong>{content.form_key}</strong><input disabled placeholder="Published form field" /><button type="button" disabled>Submit</button></div> : null}
        {(content.primary_label || content.action_label || content.link_label) ? (
          <div className="cs-vb-preview-actions">
            <span className={primaryUrl ? "" : "is-disabled"}>{content.primary_label || content.action_label || content.link_label}{primaryUrl ? " ↗" : ""}</span>
            {content.secondary_label ? <span className={secondaryUrl ? "is-secondary" : "is-secondary is-disabled"}>{content.secondary_label}</span> : null}
          </div>
        ) : null}
      </div>
      {mediaUrl ? <div className="cs-vb-preview-media"><img src={mediaUrl} alt="Selected approved media preview" /></div> : ["image", "video", "split", "hero", "gallery"].includes(section.section_type) ? <div className="cs-vb-preview-media is-placeholder"><span>{definition.badge}</span><small>Approved media</small></div> : null}
    </section>
  );
}

function LivePreview({ form, device }) {
  const enabled = (form.sections || []).filter((section) => section.is_enabled !== false);
  return (
    <div className={`cs-vb-device is-${device}`}>
      <div className="cs-vb-device-bar"><span /><span /><span /><b>CHALIN ONE / STUDIO PREVIEW</b></div>
      <div className="cs-vb-device-page">
        <header className="cs-vb-preview-header"><strong>C1</strong><span>CHALIN ONE</span><i>MENU</i></header>
        <section className="cs-vb-preview-page-hero">
          <span>{form.is_homepage ? "HOMEPAGE" : form.menu_title || "PAGE"}</span>
          <h2>{form.title || "Untitled page"}</h2>
          {form.subtitle ? <p>{form.subtitle}</p> : form.summary ? <p>{form.summary}</p> : null}
        </section>
        {enabled.map((section, index) => <PreviewSection key={`${section.section_key}-${index}`} section={section} index={index} />)}
        {enabled.length === 0 ? <div className="cs-vb-preview-empty"><strong>Your page canvas is empty.</strong><span>Add a section from the library to begin composing.</span></div> : null}
        <footer className="cs-vb-preview-footer"><span>CHALIN ONE</span><small>Governed website preview</small></footer>
      </div>
    </div>
  );
}

export default function ContentStudioVisualBuilder() {
  const auth = useAuth();
  const canCreate = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.create);
  const canEdit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.edit);
  const canSubmit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submit);
  const canViewMedia = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.mediaView);

  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [form, setForm] = useState(null);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(null);
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [mobileSurface, setMobileSurface] = useState("compose");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [dragIndex, setDragIndex] = useState(null);
  const [mediaTarget, setMediaTarget] = useState(null);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedVersion = useMemo(
    () => details?.versions?.find((item) => Number(item.id) === Number(selectedVersionId)) || null,
    [details, selectedVersionId]
  );
  const editable = Boolean(form) && selectedVersion?.version_status === "draft";
  const selectedSection = selectedSectionIndex === null ? null : form?.sections?.[selectedSectionIndex] || null;

  const loadPages = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    try {
      const result = await listPages({ search, limit: 100, offset: 0 }, { signal });
      if (!signal?.aborted) {
        setPages(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search]);

  const openPage = useCallback(async (pageId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const next = await getPage(pageId, { signal });
      if (signal?.aborted) return;
      const version = next?.versions?.[0] || null;
      setSelectedId(next?.page?.id || pageId);
      setDetails(next);
      setSelectedVersionId(version?.id || null);
      setForm(pageFormFromDetails(next, version));
      setSelectedSectionIndex(version?.sections?.length ? 0 : null);
      setReviewNote("");
      setReviewerId("");
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

  async function refreshCurrent(message = "") {
    if (!selectedId) return;
    const next = await getPage(selectedId);
    const version = next?.versions?.[0] || null;
    setDetails(next);
    setSelectedVersionId(version?.id || null);
    setForm(pageFormFromDetails(next, version));
    setSelectedSectionIndex(version?.sections?.length ? 0 : null);
    if (message) setNotice(message);
    await loadPages();
  }

  function updateForm(key, value) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  function patchSection(index, patch) {
    setForm((current) => current ? {
      ...current,
      sections: current.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section),
    } : current);
  }

  function updateSectionContent(index, key, value) {
    setForm((current) => current ? {
      ...current,
      sections: current.sections.map((section, sectionIndex) => {
        if (sectionIndex !== index) return section;
        return { ...section, content_json: { ...normalizeVisualContent(section.content_json), [key]: value } };
      }),
    } : current);
  }

  function updateSectionSettings(index, key, value) {
    setForm((current) => current ? {
      ...current,
      sections: current.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, settings_json: { ...(section.settings_json || {}), [key]: value } } : section),
    } : current);
  }

  function addSection(type) {
    setForm((current) => {
      if (!current) return current;
      const nextSection = createVisualSection(type, current.sections);
      const next = [...current.sections, nextSection];
      window.setTimeout(() => setSelectedSectionIndex(next.length - 1), 0);
      return { ...current, sections: next };
    });
    setLibraryOpen(false);
  }

  function moveSection(fromIndex, toIndex) {
    setForm((current) => current ? { ...current, sections: reorderVisualSections(current.sections, fromIndex, toIndex) } : current);
    setSelectedSectionIndex(toIndex);
  }

  function duplicateSection(index) {
    setForm((current) => {
      if (!current) return current;
      const next = duplicateVisualSection(current.sections, index);
      window.setTimeout(() => setSelectedSectionIndex(index + 1), 0);
      return { ...current, sections: next };
    });
  }

  function removeSection(index) {
    if (!window.confirm("Remove this section from the draft? The change is not permanent until you save the draft.")) return;
    setForm((current) => {
      if (!current) return current;
      const next = current.sections.filter((_, sectionIndex) => sectionIndex !== index).map((section, sectionIndex) => ({ ...section, sort_order: sectionIndex }));
      window.setTimeout(() => setSelectedSectionIndex(next.length ? Math.min(index, next.length - 1) : null), 0);
      return { ...current, sections: next };
    });
  }

  async function loadMedia() {
    if (!canViewMedia) return;
    setMediaLoading(true);
    setMediaError("");
    try {
      const result = await listMedia({ visibility: "public", limit: 100, offset: 0 });
      const items = Array.isArray(result?.items) ? result.items : [];
      setMediaAssets(items.filter((asset) => String(asset.processing_status || "ready") === "ready" && asset.public_url));
    } catch (requestError) {
      setMediaError(contentStudioErrorMessage(requestError));
    } finally {
      setMediaLoading(false);
    }
  }

  async function chooseMediaTarget(kind) {
    if (selectedSectionIndex === null || !canViewMedia) return;
    setMediaTarget({ index: selectedSectionIndex, kind });
    if (!mediaAssets.length) await loadMedia();
  }

  function applyMedia(asset) {
    if (!mediaTarget) return;
    const field = mediaTarget.kind === "background" ? "background_media_asset_id" : "primary_media_asset_id";
    const previewField = mediaTarget.kind === "background" ? "background_media_preview_url" : "primary_media_preview_url";
    patchSection(mediaTarget.index, { [field]: asset.id, [previewField]: asset.public_url || "" });
    setMediaTarget(null);
  }

  async function saveDraft() {
    if (!form || !selectedId || !selectedVersionId || !editable || !canEdit) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updatePageDraft(selectedId, selectedVersionId, pagePayload(form));
      await refreshCurrent("Visual draft saved safely. The public website was not changed until review and publication.");
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function createEditableVersion() {
    if (!selectedId || (!canEdit && !canCreate)) return;
    setSaving(true);
    setError("");
    try {
      await createPageVersion(selectedId, { change_summary: "Visual Builder working copy" });
      await refreshCurrent("A new editable visual draft was created from the latest governed version.");
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function submitForReview() {
    if (!selectedId || !selectedVersionId || !editable || !canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await updatePageDraft(selectedId, selectedVersionId, pagePayload(form));
      await submitPageVersion(selectedId, selectedVersionId, {
        assigned_to: cleanId(reviewerId),
        note: reviewNote,
      });
      await refreshCurrent("The exact visual draft was saved and sent into the governed review queue.");
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function createNewPage(event) {
    event.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    setError("");
    try {
      const starter = createVisualSection("hero", []);
      const result = await createPage({
        page_key: createForm.page_key,
        slug: createForm.slug,
        page_type: createForm.is_homepage ? "landing" : "standard",
        template_key: createForm.is_homepage ? "feature" : "standard",
        menu_title: createForm.title,
        title: createForm.title,
        subtitle: createForm.subtitle,
        summary: createForm.summary,
        body: {},
        seo_title: createForm.title,
        meta_description: createForm.summary,
        robots_directive: "index,follow",
        is_homepage: createForm.is_homepage,
        show_in_search: true,
        show_in_sitemap: true,
        change_summary: "Created in Visual Builder",
        sections: [visualSectionForSave(starter, 0)],
      });
      const pageId = result?.page?.id;
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      await loadPages();
      if (pageId) await openPage(pageId);
      setNotice("New visual page draft created with a starter hero section.");
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cs-vb-shell">
      <section className="cs-vb-hero">
        <div className="cs-vb-hero-mark">VB</div>
        <div>
          <span>PHASE 2B / VISUAL CONTENT SYSTEM</span>
          <h1>Visual Builder</h1>
          <p>Compose governed pages without code. Add sections, reorder the story, choose approved media and preview desktop, tablet and mobile before saving the exact draft.</p>
        </div>
        {canCreate ? <button type="button" onClick={() => setCreateOpen(true)}>New visual page <b>+</b></button> : null}
      </section>

      <Notice error={error} notice={notice} onClear={() => { setError(""); setNotice(""); }} />

      <div className="cs-vb-mobile-switch" role="tablist" aria-label="Visual Builder mobile surface">
        <button type="button" className={mobileSurface === "compose" ? "is-active" : ""} onClick={() => setMobileSurface("compose")}>Compose</button>
        <button type="button" className={mobileSurface === "preview" ? "is-active" : ""} onClick={() => setMobileSurface("preview")}>Preview</button>
      </div>

      <div className="cs-vb-workspace" data-mobile-surface={mobileSurface}>
        <aside className="cs-vb-pages">
          <header><div><span>PAGE LIBRARY</span><strong>{total.toLocaleString("en-GH")} governed pages</strong></div></header>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages" aria-label="Search visual pages" />
          <div className="cs-vb-page-list" aria-busy={loading ? "true" : "false"}>
            {pages.map((page) => (
              <button type="button" key={page.id} className={Number(page.id) === Number(selectedId) ? "is-active" : ""} onClick={() => openPage(page.id)}>
                <span><strong>{page.latest_title || page.menu_title || page.slug}</strong><small>/{page.slug}</small></span>
                <StatusChip value={page.publication_status} />
              </button>
            ))}
            {!loading && pages.length === 0 ? <div className="cs-vb-pages-empty">No pages match this search.</div> : null}
          </div>
        </aside>

        <main className="cs-vb-compose">
          {!form ? (
            <div className="cs-vb-empty-stage"><span>VISUAL CANVAS</span><strong>Select a page to start composing.</strong><p>The existing advanced Pages manager remains available for full metadata, version and approval administration.</p></div>
          ) : (
            <>
              <header className="cs-vb-compose-head">
                <div>
                  <span>{form.is_homepage ? "HOMEPAGE CANVAS" : `/${form.slug}`}</span>
                  <h2>{form.title || "Untitled page"}</h2>
                  <small>Version {selectedVersion?.version_number || "—"}</small>
                </div>
                <div><StatusChip value={selectedVersion?.version_status} /></div>
              </header>

              <section className="cs-vb-page-copy">
                <Field label="Page title"><input value={form.title} disabled={!editable} onChange={(event) => updateForm("title", event.target.value)} /></Field>
                <Field label="Subtitle"><input value={form.subtitle} disabled={!editable} onChange={(event) => updateForm("subtitle", event.target.value)} /></Field>
                <Field label="Summary" className="is-wide"><textarea rows="3" value={form.summary} disabled={!editable} onChange={(event) => updateForm("summary", event.target.value)} /></Field>
              </section>

              <div className="cs-vb-canvas-head">
                <div><span>SECTION CANVAS</span><strong>{form.sections.length} blocks · {form.sections.filter((section) => section.is_enabled !== false).length} visible</strong></div>
                {editable ? <button type="button" onClick={() => setLibraryOpen(true)}>Add section <b>+</b></button> : null}
              </div>

              <div className="cs-vb-section-canvas">
                {form.sections.map((section, index) => {
                  const definition = getVisualSectionDefinition(section.section_type);
                  return (
                    <article
                      key={`${section.section_key}-${index}`}
                      className={`${selectedSectionIndex === index ? "is-selected" : ""} ${section.is_enabled === false ? "is-disabled" : ""}`}
                      draggable={editable}
                      onDragStart={() => setDragIndex(index)}
                      onDragEnd={() => setDragIndex(null)}
                      onDragOver={(event) => editable && event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (editable && dragIndex !== null) moveSection(dragIndex, index);
                        setDragIndex(null);
                      }}
                      onClick={() => setSelectedSectionIndex(index)}
                    >
                      <div className="cs-vb-section-handle" aria-hidden="true">⋮⋮</div>
                      <div className="cs-vb-section-badge">{definition.badge}</div>
                      <div className="cs-vb-section-copy"><small>{definition.label} · {section.section_key}</small><strong>{visualSectionSummary(section)}</strong></div>
                      <div className="cs-vb-section-actions">
                        {editable ? <button type="button" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveSection(index, index - 1); }}>↑</button> : null}
                        {editable ? <button type="button" aria-label={`Move ${definition.label} down`} disabled={index === form.sections.length - 1} onClick={(event) => { event.stopPropagation(); moveSection(index, index + 1); }}>↓</button> : null}
                        {editable ? <button type="button" aria-label={`Duplicate ${definition.label}`} onClick={(event) => { event.stopPropagation(); duplicateSection(index); }}>⧉</button> : null}
                        {editable ? <button type="button" aria-label={section.is_enabled === false ? `Show ${definition.label}` : `Hide ${definition.label}`} onClick={(event) => { event.stopPropagation(); patchSection(index, { is_enabled: section.is_enabled === false }); }}>{section.is_enabled === false ? "○" : "●"}</button> : null}
                        {editable ? <button type="button" className="is-danger" aria-label={`Remove ${definition.label}`} onClick={(event) => { event.stopPropagation(); removeSection(index); }}>×</button> : null}
                      </div>
                    </article>
                  );
                })}
                {form.sections.length === 0 ? <button type="button" className="cs-vb-add-empty" onClick={() => editable && setLibraryOpen(true)} disabled={!editable}><span>+</span><strong>Add the first section</strong><small>Choose from the governed section library.</small></button> : null}
              </div>

              <SectionInspector
                section={selectedSection}
                index={selectedSectionIndex || 0}
                editable={editable}
                canViewMedia={canViewMedia}
                onPatch={(patch) => patchSection(selectedSectionIndex, patch)}
                onContent={(key, value) => updateSectionContent(selectedSectionIndex, key, value)}
                onSettings={(key, value) => updateSectionSettings(selectedSectionIndex, key, value)}
                onChooseMedia={chooseMediaTarget}
              />

              <section className="cs-vb-governance">
                <div><span>GOVERNED SAVE</span><strong>{editable ? "You are editing a draft version." : "This version is read-only."}</strong><p>{editable ? "Saving changes only updates this draft. Publication still requires the existing review and publishing controls." : "Create a new editable version before changing the page."}</p></div>
                <div className="cs-vb-governance-actions">
                  {editable && canEdit ? <button type="button" className="is-primary" onClick={saveDraft} disabled={saving}>{saving ? "Saving…" : "Save visual draft"}</button> : null}
                  {!editable && (canEdit || canCreate) ? <button type="button" className="is-primary" onClick={createEditableVersion} disabled={saving}>Create editable version</button> : null}
                </div>
                {editable && canSubmit ? (
                  <div className="cs-vb-review-row">
                    <Field label="Reviewer user ID" hint="Optional; leave blank for the review queue."><input inputMode="numeric" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></Field>
                    <Field label="Review note"><input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="What should the reviewer verify?" /></Field>
                    <button type="button" onClick={submitForReview} disabled={saving}>Save & send to review →</button>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </main>

        <aside className="cs-vb-preview">
          <header>
            <div><span>LIVE STUDIO PREVIEW</span><strong>{VISUAL_PREVIEW_DEVICES.find((item) => item.key === previewDevice)?.label}</strong></div>
            <div className="cs-vb-device-switch" role="group" aria-label="Preview device">
              {VISUAL_PREVIEW_DEVICES.map((device) => <button type="button" key={device.key} className={previewDevice === device.key ? "is-active" : ""} onClick={() => setPreviewDevice(device.key)}>{device.label}</button>)}
            </div>
          </header>
          {form ? <LivePreview form={form} device={previewDevice} /> : <div className="cs-vb-preview-placeholder">Select a page to open its visual preview.</div>}
          <small className="cs-vb-preview-note">Studio preview shows hierarchy, content, visibility and responsive intent. The governed public renderer remains the final publication surface.</small>
        </aside>
      </div>

      <SectionLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} onChoose={addSection} />
      <MediaPicker open={Boolean(mediaTarget)} assets={mediaAssets} loading={mediaLoading} error={mediaError} onClose={() => setMediaTarget(null)} onChoose={applyMedia} onRetry={loadMedia} />

      {createOpen ? (
        <div className="cs-vb-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-vb-create-title">
          <button type="button" className="cs-vb-dialog-backdrop" aria-label="Close new page dialog" onClick={() => setCreateOpen(false)} />
          <form className="cs-vb-create-panel" onSubmit={createNewPage}>
            <header><div><span>NEW / VISUAL PAGE</span><h2 id="cs-vb-create-title">Start with a clean governed canvas</h2><p>A starter hero is created automatically. Nothing becomes public until the normal review and publish workflow completes.</p></div><button type="button" onClick={() => setCreateOpen(false)}>Close ×</button></header>
            <div className="cs-vb-mini-grid">
              <Field label="Internal page key" hint="Lowercase letters, numbers and underscores."><input required value={createForm.page_key} onChange={(event) => setCreateForm((current) => ({ ...current, page_key: event.target.value }))} /></Field>
              <Field label="Public URL slug" hint="Example: company-profile"><input required value={createForm.slug} onChange={(event) => setCreateForm((current) => ({ ...current, slug: event.target.value }))} /></Field>
            </div>
            <Field label="Page title"><input required value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} /></Field>
            <Field label="Subtitle"><input value={createForm.subtitle} onChange={(event) => setCreateForm((current) => ({ ...current, subtitle: event.target.value }))} /></Field>
            <Field label="Summary"><textarea rows="4" value={createForm.summary} onChange={(event) => setCreateForm((current) => ({ ...current, summary: event.target.value }))} /></Field>
            <label className="cs-vb-check"><input type="checkbox" checked={createForm.is_homepage} onChange={(event) => setCreateForm((current) => ({ ...current, is_homepage: event.target.checked }))} /><span>Use as homepage page record</span></label>
            <button className="cs-vb-create-submit" disabled={saving}>{saving ? "Creating visual draft…" : "Create visual page"}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
