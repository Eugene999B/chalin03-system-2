import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  archivePage,
  createPage,
  createPageVersion,
  decidePageApproval,
  getPage,
  listPages,
  publishPageVersion,
  restorePageVersion,
  submitPageVersion,
  updatePageDraft,
} from "./contentStudioPageApi";
import { contentStudioErrorMessage } from "./contentStudioApi";
import ContentStudioMediaPickerField from "./ContentStudioMediaPickerField";
import "./contentStudioPageManager.css";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";

const EMPTY_SECTION = Object.freeze({
  section_key: "",
  section_type: "text",
  heading: "",
  subheading: "",
  content_text: "",
  original_content: {},
  settings_json: {},
  sort_order: 0,
  is_enabled: true,
});

const EMPTY_FORM = Object.freeze({
  page_key: "",
  slug: "",
  page_type: "standard",
  template_key: "standard",
  menu_title: "",
  title: "",
  subtitle: "",
  summary: "",
  seo_title: "",
  meta_description: "",
  canonical_url: "",
  robots_directive: "index,follow",
  primary_media_asset_id: "",
  is_homepage: false,
  show_in_search: true,
  show_in_sitemap: true,
  change_summary: "",
  sections: [],
});

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function displayStatus(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function sectionFromRecord(section, index) {
  const content = section?.content_json && typeof section.content_json === "object"
    ? section.content_json
    : {};
  return {
    section_key: section?.section_key || `section_${index + 1}`,
    section_type: section?.section_type || "text",
    heading: section?.heading || "",
    subheading: section?.subheading || "",
    content_text: typeof content.text === "string" ? content.text : "",
    has_structured_content:
      typeof content.text !== "string" && Object.keys(content).length > 0,
    original_content: content,
    settings_json:
      section?.settings_json && typeof section.settings_json === "object"
        ? section.settings_json
        : {},
    primary_media_asset_id: section?.primary_media_asset_id || "",
    background_media_asset_id: section?.background_media_asset_id || "",
    sort_order: Number.isInteger(Number(section?.sort_order))
      ? Number(section.sort_order)
      : index,
    is_enabled: section?.is_enabled !== false,
  };
}

function formFromDetails(details, version = null) {
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
      ? selectedVersion.sections.map(sectionFromRecord)
      : [],
  };
}

function contentForSave(section) {
  const originalText =
    typeof section.original_content?.text === "string"
      ? section.original_content.text
      : Object.keys(section.original_content || {}).length > 0
        ? JSON.stringify(section.original_content, null, 2)
        : "";
  if (section.has_structured_content && section.content_text === "") {
    return section.original_content || {};
  }
  if (section.content_text === originalText) return section.original_content || {};
  return { text: section.content_text };
}

function payloadFromForm(form) {
  return {
    page_key: form.page_key,
    slug: form.slug,
    page_type: form.page_type,
    template_key: form.template_key,
    menu_title: form.menu_title,
    title: form.title,
    subtitle: form.subtitle,
    summary: form.summary,
    body: {},
    seo_title: form.seo_title,
    meta_description: form.meta_description,
    canonical_url: form.canonical_url,
    robots_directive: form.robots_directive,
    primary_media_asset_id: cleanId(form.primary_media_asset_id),
    is_homepage: form.is_homepage,
    show_in_search: form.show_in_search,
    show_in_sitemap: form.show_in_sitemap,
    change_summary: form.change_summary,
    sections: form.sections.map((section, index) => ({
      section_key: section.section_key,
      section_type: section.section_type,
      heading: section.heading,
      subheading: section.subheading,
      content: contentForSave(section),
      settings: section.settings_json || {},
      primary_media_asset_id: cleanId(section.primary_media_asset_id),
      background_media_asset_id: cleanId(section.background_media_asset_id),
      sort_order: index,
      is_enabled: section.is_enabled,
    })),
  };
}

function StatusChip({ status }) {
  return (
    <span className={`cs-status-chip cs-status-${contentStudioStatusTone(status)}`}>
      {displayStatus(status)}
    </span>
  );
}

function Field({ label, children, hint }) {
  if (/media asset id/i.test(String(label || "")) && children?.props) {
    return (
      <ContentStudioMediaPickerField
        label={String(label).replace(/\s+asset\s+id$/i, "")}
        value={children.props.value}
        disabled={children.props.disabled}
        required={children.props.required}
        accept="image"
        hint={hint || "Choose a public publication-ready image from Media Library Pro."}
        onChange={(value) => children.props.onChange?.({ target: { value } })}
      />
    );
  }
  return (
    <label className="cs-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Notice({ tone = "success", message, onClose }) {
  if (!message) return null;
  return (
    <div className={`cs-alert cs-alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <div><strong>{tone === "danger" ? "Action not completed" : "Saved"}</strong><span>{message}</span></div>
      {onClose ? <button type="button" onClick={onClose}>Close</button> : null}
    </div>
  );
}

export default function ContentStudioPageManager() {
  const auth = useAuth();
  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const selectedVersion = useMemo(
    () => details?.versions?.find((version) => Number(version.id) === Number(selectedVersionId)) || null,
    [details, selectedVersionId]
  );
  const pendingApproval = useMemo(
    () => details?.approvals?.find(
      (approval) =>
        approval.approval_status === "pending" &&
        Number(approval.page_version_id) === Number(selectedVersionId)
    ) || null,
    [details, selectedVersionId]
  );
  const approvedApproval = useMemo(
    () => details?.approvals?.find(
      (approval) =>
        approval.approval_status === "approved" &&
        Number(approval.page_version_id) === Number(selectedVersionId)
    ) || null,
    [details, selectedVersionId]
  );

  const canCreate = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.create);
  const canEdit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.edit);
  const canSubmit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submit);
  const canApprove = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.approve);
  const canPublish = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.publish);
  const canRestore = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.restore);
  const canArchive = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.archive);

  const loadPages = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listPages(
        { status: statusFilter, search, limit: 100, offset: 0 },
        { signal }
      );
      if (!signal?.aborted) {
        setPages(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search, statusFilter]);

  const loadDetails = useCallback(async (pageId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const nextDetails = await getPage(pageId, { signal });
      if (signal?.aborted) return;
      setDetails(nextDetails);
      const latest = nextDetails?.versions?.[0] || null;
      setSelectedVersionId(latest?.id || null);
      setForm(formFromDetails(nextDetails, latest));
      setMode("edit");
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

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSection(index, key, value) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, [key]: value } : section
      ),
    }));
  }

  function addSection() {
    setForm((current) => ({
      ...current,
      sections: [
        ...current.sections,
        { ...EMPTY_SECTION, section_key: `section_${current.sections.length + 1}`, sort_order: current.sections.length },
      ],
    }));
  }

  function removeSection(index) {
    setForm((current) => ({
      ...current,
      sections: current.sections.filter((_, sectionIndex) => sectionIndex !== index),
    }));
  }

  function beginCreate() {
    setSelectedId(null);
    setDetails(null);
    setSelectedVersionId(null);
    setForm({ ...EMPTY_FORM, sections: [] });
    setMode("create");
    setError("");
    setNotice("");
  }

  function chooseVersion(versionId) {
    const version = details?.versions?.find(
      (item) => Number(item.id) === Number(versionId)
    );
    setSelectedVersionId(Number(versionId));
    setForm(formFromDetails(details, version));
    setError("");
    setNotice("");
  }

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextDetails = await action();
      if (nextDetails?.page) {
        setDetails(nextDetails);
        setSelectedId(nextDetails.page.id);
        const latest = nextDetails.versions?.[0] || null;
        setSelectedVersionId(latest?.id || null);
        setForm(formFromDetails(nextDetails, latest));
        setMode("edit");
      }
      setNotice(successMessage);
      await loadPages();
    } catch (actionError) {
      setError(contentStudioErrorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function savePage(event) {
    event.preventDefault();
    const payload = payloadFromForm(form);
    if (mode === "create") {
      await runAction(() => createPage(payload), "The page draft was created safely.");
      return;
    }
    await runAction(
      () => updatePageDraft(selectedId, selectedVersionId, payload),
      "The draft version was updated safely."
    );
  }

  async function makeNewDraft() {
    await runAction(
      () => createPageVersion(selectedId, { change_summary: "New editable version" }),
      "A new editable draft version was created."
    );
  }

  async function submitForReview() {
    await runAction(
      () =>
        submitPageVersion(selectedId, selectedVersionId, {
          assigned_to: cleanId(reviewerId),
          note: reviewNote,
        }),
      "The exact saved version was submitted for review."
    );
  }

  async function decideApproval(decision) {
    const approval = pendingApproval;
    if (!approval) return;
    await runAction(
      () => decidePageApproval(approval.id, { decision, note: reviewNote }),
      decision === "approved"
        ? "The exact page version was approved."
        : "The page version was returned to draft."
    );
  }

  async function publishNow() {
    await runAction(
      () => publishPageVersion(selectedId, selectedVersionId, {}),
      "The approved page version is now published."
    );
  }

  async function restoreSelected() {
    await runAction(
      () => restorePageVersion(selectedId, selectedVersionId, { reason: reviewNote }),
      "The selected version was restored as a new draft."
    );
  }

  async function archiveSelected() {
    if (!window.confirm("Archive this page? It will no longer be public.")) return;
    await runAction(
      () => archivePage(selectedId, { reason: reviewNote }),
      "The page was archived without deleting its history."
    );
  }

  const editable = mode === "create" || selectedVersion?.version_status === "draft";

  return (
    <div className="cs-page-manager">
      <section className="cs-module-hero">
        <div className="cs-badge cs-badge-blue" aria-hidden="true">PG</div>
        <div>
          <span className="cs-eyebrow">Content</span>
          <h2>Pages</h2>
          <p>Create reusable website pages and move exact versions through controlled review and publication.</p>
        </div>
        {canCreate ? (
          <button type="button" className="cs-button cs-button-secondary" onClick={beginCreate}>
            New page
          </button>
        ) : null}
      </section>

      <Notice tone="danger" message={error} onClose={() => setError("")} />
      <Notice message={notice} onClose={() => setNotice("")} />

      <div className="cs-page-layout">
        <aside className="cs-panel cs-page-list-panel">
          <div className="cs-panel-heading">
            <div><span className="cs-eyebrow">Library</span><h3>{total.toLocaleString("en-GH")} pages</h3></div>
          </div>
          <div className="cs-filter-stack">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search page title or URL"
              aria-label="Search pages"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter pages by status">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="cs-page-list" aria-busy={loading ? "true" : "false"}>
            {pages.map((page) => (
              <button
                type="button"
                key={page.id}
                className={Number(selectedId) === Number(page.id) ? "cs-page-list-item is-active" : "cs-page-list-item"}
                onClick={() => {
                  setSelectedId(page.id);
                  loadDetails(page.id);
                }}
              >
                <span><strong>{page.latest_title || page.menu_title || page.slug}</strong><small>/{page.slug}</small></span>
                <StatusChip status={page.publication_status} />
              </button>
            ))}
            {!loading && pages.length === 0 ? <div className="cs-empty-state"><strong>No pages found</strong><span>Change the filters or create the first page.</span></div> : null}
          </div>
        </aside>

        <section className="cs-panel cs-page-editor-panel">
          {mode === "list" ? (
            <div className="cs-empty-state cs-page-empty"><strong>Select a page</strong><span>Choose an existing page or create a new draft.</span></div>
          ) : (
            <form onSubmit={savePage}>
              <div className="cs-editor-heading">
                <div>
                  <span className="cs-eyebrow">{mode === "create" ? "New draft" : `Page #${selectedId}`}</span>
                  <h3>{form.title || "Untitled page"}</h3>
                </div>
                {selectedVersion ? <StatusChip status={selectedVersion.version_status} /> : null}
              </div>

              {details?.versions?.length ? (
                <Field label="Version history">
                  <select value={selectedVersionId || ""} onChange={(event) => chooseVersion(event.target.value)}>
                    {details.versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        Version {version.version_number} — {displayStatus(version.version_status)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <div className="cs-form-grid">
                <Field label="Internal page key" hint="Lowercase letters, numbers and underscores.">
                  <input value={form.page_key} onChange={(event) => updateField("page_key", event.target.value)} disabled={mode !== "create"} required />
                </Field>
                <Field label="Public URL slug" hint="Example: about-us">
                  <input value={form.slug} onChange={(event) => updateField("slug", event.target.value)} disabled={!editable} required />
                </Field>
                <Field label="Page title">
                  <input value={form.title} onChange={(event) => updateField("title", event.target.value)} disabled={!editable} required />
                </Field>
                <Field label="Menu title">
                  <input value={form.menu_title} onChange={(event) => updateField("menu_title", event.target.value)} disabled={!editable} />
                </Field>
                <Field label="Page type">
                  <select value={form.page_type} onChange={(event) => updateField("page_type", event.target.value)} disabled={!editable}>
                    <option value="standard">Standard</option>
                    <option value="landing">Landing page</option>
                    <option value="division">Business division</option>
                    <option value="campaign">Campaign</option>
                    <option value="legal">Legal</option>
                  </select>
                </Field>
                <Field label="Template">
                  <select value={form.template_key} onChange={(event) => updateField("template_key", event.target.value)} disabled={!editable}>
                    <option value="standard">Standard</option>
                    <option value="wide">Wide</option>
                    <option value="feature">Feature</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </Field>
              </div>

              <Field label="Subtitle">
                <input value={form.subtitle} onChange={(event) => updateField("subtitle", event.target.value)} disabled={!editable} />
              </Field>
              <Field label="Page summary">
                <textarea rows="4" value={form.summary} onChange={(event) => updateField("summary", event.target.value)} disabled={!editable} />
              </Field>

              <div className="cs-checkbox-grid">
                <label><input type="checkbox" checked={form.is_homepage} onChange={(event) => updateField("is_homepage", event.target.checked)} disabled={!editable} /> Homepage</label>
                <label><input type="checkbox" checked={form.show_in_search} onChange={(event) => updateField("show_in_search", event.target.checked)} disabled={!editable} /> Show in search</label>
                <label><input type="checkbox" checked={form.show_in_sitemap} onChange={(event) => updateField("show_in_sitemap", event.target.checked)} disabled={!editable} /> Show in sitemap</label>
              </div>

              <div className="cs-editor-section-heading">
                <div><span className="cs-eyebrow">Page builder</span><h4>Reusable sections</h4></div>
                {editable ? <button type="button" className="cs-button cs-button-secondary" onClick={addSection}>Add section</button> : null}
              </div>
              <div className="cs-section-list">
                {form.sections.map((section, index) => (
                  <article className="cs-section-editor" key={`${section.section_key}-${index}`}>
                    <div className="cs-section-editor-heading"><strong>Section {index + 1}</strong>{editable ? <button type="button" onClick={() => removeSection(index)}>Remove</button> : null}</div>
                    <div className="cs-form-grid">
                      <Field label="Section key"><input value={section.section_key} onChange={(event) => updateSection(index, "section_key", event.target.value)} disabled={!editable} required /></Field>
                      <Field label="Section type">
                        <select value={section.section_type} onChange={(event) => updateSection(index, "section_type", event.target.value)} disabled={!editable}>
                          <option value="text">Text</option>
                          <option value="hero">Hero</option>
                          <option value="split">Split content</option>
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                          <option value="statistics">Statistics</option>
                          <option value="divisions">Business divisions</option>
                          <option value="leadership">Leadership</option>
                          <option value="projects">Projects</option>
                          <option value="equipment">Equipment</option>
                          <option value="news">News</option>
                          <option value="testimonials">Testimonials</option>
                          <option value="gallery">Gallery</option>
                          <option value="cta">Call to action</option>
                          <option value="contact">Contact</option>
                          <option value="faq">FAQ</option>
                          <option value="form">Form</option>
                          <option value="custom">Custom</option>
                        </select>
                      </Field>
                      <Field label="Heading"><input value={section.heading} onChange={(event) => updateSection(index, "heading", event.target.value)} disabled={!editable} /></Field>
                      <Field label="Subheading"><input value={section.subheading} onChange={(event) => updateSection(index, "subheading", event.target.value)} disabled={!editable} /></Field>
                    </div>
                    <Field
                      label="Content"
                      hint={
                        section.has_structured_content
                          ? "This section contains advanced structured content. Leave this blank to preserve it, or enter text to replace it."
                          : "Plain text content for this section."
                      }
                    >
                      <textarea rows="5" value={section.content_text} onChange={(event) => updateSection(index, "content_text", event.target.value)} disabled={!editable} />
                    </Field>
                    <label className="cs-inline-check"><input type="checkbox" checked={section.is_enabled} onChange={(event) => updateSection(index, "is_enabled", event.target.checked)} disabled={!editable} /> Section enabled</label>
                  </article>
                ))}
                {form.sections.length === 0 ? <div className="cs-empty-state"><strong>No sections</strong><span>Add a reusable section to build the page.</span></div> : null}
              </div>

              <div className="cs-editor-section-heading"><div><span className="cs-eyebrow">Search visibility</span><h4>SEO settings</h4></div></div>
              <div className="cs-form-grid">
                <Field label="SEO title"><input value={form.seo_title} onChange={(event) => updateField("seo_title", event.target.value)} disabled={!editable} /></Field>
                <Field label="Primary media asset ID"><input inputMode="numeric" value={form.primary_media_asset_id} onChange={(event) => updateField("primary_media_asset_id", event.target.value)} disabled={!editable} /></Field>
              </div>
              <Field label="Meta description"><textarea rows="3" value={form.meta_description} onChange={(event) => updateField("meta_description", event.target.value)} disabled={!editable} /></Field>
              <Field label="Change summary"><input value={form.change_summary} onChange={(event) => updateField("change_summary", event.target.value)} disabled={!editable} placeholder="Explain what changed" /></Field>

              <div className="cs-editor-actions">
                {editable && (mode === "create" ? canCreate : canEdit) ? <button className="cs-button cs-button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button> : null}
                {mode === "edit" && selectedVersion?.version_status !== "draft" && canEdit ? <button className="cs-button cs-button-secondary" type="button" onClick={makeNewDraft} disabled={saving}>Create new draft</button> : null}
                {mode === "edit" && selectedVersion?.version_status === "draft" && canSubmit ? <button className="cs-button cs-button-warning" type="button" onClick={submitForReview} disabled={saving}>Submit for review</button> : null}
                {mode === "edit" && selectedVersion?.version_status === "in_review" && pendingApproval && canApprove ? <><button className="cs-button cs-button-success" type="button" onClick={() => decideApproval("approved")} disabled={saving}>Approve version</button><button className="cs-button cs-button-danger" type="button" onClick={() => decideApproval("rejected")} disabled={saving}>Reject</button></> : null}
                {mode === "edit" && selectedVersion?.version_status === "approved" && approvedApproval && canPublish ? <button className="cs-button cs-button-success" type="button" onClick={publishNow} disabled={saving}>Publish now</button> : null}
                {mode === "edit" && selectedVersion && selectedVersion.version_status !== "draft" && canRestore ? <button className="cs-button cs-button-secondary" type="button" onClick={restoreSelected} disabled={saving}>Restore as draft</button> : null}
                {mode === "edit" && canArchive ? <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={archiveSelected} disabled={saving}>Archive page</button> : null}
              </div>

              {mode === "edit" && (canSubmit || canApprove || canRestore || canArchive) ? (
                <div className="cs-review-box">
                  <div className="cs-form-grid">
                    {canSubmit ? <Field label="Reviewer user ID" hint="Optional; leave blank for an unassigned review queue."><input inputMode="numeric" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></Field> : null}
                    <Field label="Review or action note"><input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Reason, instruction or decision note" /></Field>
                  </div>
                </div>
              ) : null}
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
