import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import ContentStudioMediaPickerField from "./ContentStudioMediaPickerField";
import {
  archiveNewsCategory,
  archiveNewsroomEntity,
  createNewsCategory,
  createNewsroomEntity,
  createNewsroomVersion,
  decideNewsroomApproval,
  getNewsroomEntity,
  listNewsCategories,
  listNewsroomEntities,
  publishNewsroomVersion,
  restoreNewsroomVersion,
  submitNewsroomVersion,
  updateNewsCategory,
  updateNewsroomDraft,
} from "./contentStudioNewsroomApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import "./contentStudioPageManager.css";
import "./contentStudioNewsroomManager.css";

const EMPTY_ARTICLE = Object.freeze({
  article_key: "",
  slug: "",
  category_id: "",
  title: "",
  excerpt: "",
  body_text: "",
  original_body: {},
  has_structured_body: false,
  author_display_name: "",
  featured_media_asset_id: "",
  is_featured: false,
  seo_title: "",
  meta_description: "",
  change_summary: "",
});

const EMPTY_ANNOUNCEMENT = Object.freeze({
  announcement_key: "",
  title: "",
  body_text: "",
  link_label: "",
  link_url: "",
  display_style: "info",
  priority: 0,
  ticker_enabled: false,
  change_summary: "",
});

const EMPTY_CATEGORY = Object.freeze({
  category_key: "",
  slug: "",
  name: "",
  description: "",
  sort_order: 0,
});

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function displayStatus(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function bodyEditor(body) {
  const safeBody = body && typeof body === "object" ? body : {};
  if (typeof safeBody.text === "string") {
    return {
      body_text: safeBody.text,
      original_body: safeBody,
      has_structured_body: false,
    };
  }
  return {
    body_text: "",
    original_body: safeBody,
    has_structured_body: Object.keys(safeBody).length > 0,
  };
}

function articleForm(snapshot = {}) {
  return {
    article_key: snapshot.article_key || "",
    slug: snapshot.slug || "",
    category_id: snapshot.category_id || "",
    title: snapshot.title || "",
    excerpt: snapshot.excerpt || "",
    ...bodyEditor(snapshot.body || snapshot.body_json),
    author_display_name: snapshot.author_display_name || "",
    featured_media_asset_id: snapshot.featured_media_asset_id || "",
    is_featured: snapshot.is_featured === true,
    seo_title: snapshot.seo_title || "",
    meta_description: snapshot.meta_description || "",
    change_summary: snapshot.change_summary || "",
  };
}

function announcementForm(snapshot = {}) {
  return {
    announcement_key: snapshot.announcement_key || "",
    title: snapshot.title || "",
    body_text: snapshot.body_text || "",
    link_label: snapshot.link_label || "",
    link_url: snapshot.link_url || "",
    display_style: snapshot.display_style || "info",
    priority: Number.isInteger(Number(snapshot.priority))
      ? Number(snapshot.priority)
      : 0,
    ticker_enabled: snapshot.ticker_enabled === true,
    change_summary: snapshot.change_summary || "",
  };
}

function formFromDetails(kind, details, version = null) {
  const selectedVersion = version || details?.versions?.[0] || null;
  const snapshot = selectedVersion?.snapshot || details?.current_snapshot || {};
  const base = kind === "article" ? articleForm(snapshot) : announcementForm(snapshot);
  return {
    ...base,
    change_summary: selectedVersion?.change_summary || "",
  };
}

function bodyForSave(form) {
  if (form.has_structured_body && form.body_text === "") {
    return form.original_body || {};
  }
  if (
    typeof form.original_body?.text === "string" &&
    form.body_text === form.original_body.text
  ) {
    return form.original_body;
  }
  return { text: form.body_text };
}

function payloadFromForm(kind, form) {
  if (kind === "article") {
    return {
      article_key: form.article_key,
      slug: form.slug,
      category_id: cleanId(form.category_id),
      title: form.title,
      excerpt: form.excerpt,
      body: bodyForSave(form),
      author_display_name: form.author_display_name,
      featured_media_asset_id: cleanId(form.featured_media_asset_id),
      is_featured: form.is_featured,
      seo_title: form.seo_title,
      meta_description: form.meta_description,
      change_summary: form.change_summary,
    };
  }
  return {
    announcement_key: form.announcement_key,
    title: form.title,
    body_text: form.body_text,
    link_label: form.link_label,
    link_url: form.link_url,
    display_style: form.display_style,
    priority: Number(form.priority) || 0,
    ticker_enabled: form.ticker_enabled,
    change_summary: form.change_summary,
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
        hint={hint || "Choose a publication-ready image from Media Library Pro."}
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
    <div
      className={`cs-alert cs-alert-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        <strong>{tone === "danger" ? "Action not completed" : "Newsroom updated"}</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}

function CategoryManager({
  categories,
  loading,
  saving,
  canCreate,
  canEdit,
  canArchive,
  onReload,
  onSave,
  onArchive,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState({ ...EMPTY_CATEGORY });
  const selected = useMemo(
    () => categories.find((category) => Number(category.id) === Number(selectedId)) || null,
    [categories, selectedId]
  );

  function selectCategory(category) {
    setSelectedId(category.id);
    setMode("edit");
    setForm({
      category_key: category.category_key || "",
      slug: category.slug || "",
      name: category.name || "",
      description: category.description || "",
      sort_order: Number(category.sort_order || 0),
    });
  }

  function beginCreate() {
    setSelectedId(null);
    setMode("create");
    setForm({ ...EMPTY_CATEGORY });
  }

  async function submit(event) {
    event.preventDefault();
    const saved = await onSave(mode, selectedId, form);
    if (!saved) return;
    setMode("list");
    setSelectedId(null);
    setForm({ ...EMPTY_CATEGORY });
  }

  return (
    <div className="cs-news-category-layout">
      <section className="cs-panel">
        <div className="cs-panel-heading">
          <div>
            <span className="cs-eyebrow">Taxonomy</span>
            <h3>{categories.length.toLocaleString("en-GH")} categories</h3>
          </div>
          <div className="cs-heading-actions">
            <button
              type="button"
              className="cs-button cs-button-secondary"
              onClick={onReload}
            >
              Refresh
            </button>
            {canCreate ? (
              <button
                type="button"
                className="cs-button cs-button-primary"
                onClick={beginCreate}
              >
                New category
              </button>
            ) : null}
          </div>
        </div>
        <div className="cs-category-list" aria-busy={loading ? "true" : "false"}>
          {categories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={
                Number(selectedId) === Number(category.id)
                  ? "cs-category-row is-active"
                  : "cs-category-row"
              }
              onClick={() => selectCategory(category)}
            >
              <span>
                <strong>{category.name}</strong>
                <small>/{category.slug} · {category.active_article_count || 0} articles</small>
              </span>
              <span
                className={`cs-status-chip ${
                  category.is_active ? "cs-status-success" : "cs-status-danger"
                }`}
              >
                {category.is_active ? "active" : "archived"}
              </span>
            </button>
          ))}
          {!loading && categories.length === 0 ? (
            <div className="cs-empty-state">
              <strong>No categories</strong>
              <span>Create the first category for public news articles.</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="cs-panel">
        {mode === "list" ? (
          <div className="cs-empty-state cs-page-empty">
            <strong>Select a category</strong>
            <span>Choose a category to edit it, or create a new one.</span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="cs-editor-heading">
              <div>
                <span className="cs-eyebrow">
                  {mode === "create" ? "New category" : `Category #${selectedId}`}
                </span>
                <h3>{form.name || "Untitled category"}</h3>
              </div>
              {selected ? (
                <span
                  className={`cs-status-chip ${
                    selected.is_active ? "cs-status-success" : "cs-status-danger"
                  }`}
                >
                  {selected.is_active ? "active" : "archived"}
                </span>
              ) : null}
            </div>
            <div className="cs-form-grid">
              <Field label="Category key" hint="Lowercase letters, numbers and underscores.">
                <input
                  value={form.category_key}
                  onChange={(event) => setForm((current) => ({ ...current, category_key: event.target.value }))}
                  disabled={mode === "edit" && !canEdit}
                  required
                />
              </Field>
              <Field label="Public URL slug">
                <input
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  disabled={mode === "edit" && !canEdit}
                  required
                />
              </Field>
              <Field label="Category name">
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={mode === "edit" && !canEdit}
                  required
                />
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
                  disabled={mode === "edit" && !canEdit}
                />
              </Field>
            </div>
            <Field label="Description">
              <textarea
                rows="4"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                disabled={mode === "edit" && !canEdit}
              />
            </Field>
            <div className="cs-editor-actions">
              {(mode === "create" ? canCreate : canEdit) ? (
                <button
                  type="submit"
                  className="cs-button cs-button-primary"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save category"}
                </button>
              ) : null}
              {mode === "edit" && selected?.is_active && canArchive ? (
                <button
                  type="button"
                  className="cs-button cs-button-danger cs-action-right"
                  disabled={saving}
                  onClick={() => onArchive(selected)}
                >
                  Archive category
                </button>
              ) : null}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export default function ContentStudioNewsroomManager() {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState("article");
  const [entities, setEntities] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_ARTICLE });
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [actionNote, setActionNote] = useState("");

  const kind = activeTab === "announcement" ? "announcement" : "article";
  const selectedVersion = useMemo(
    () => details?.versions?.find(
      (version) => Number(version.id) === Number(selectedVersionId)
    ) || null,
    [details, selectedVersionId]
  );
  const pendingApproval = useMemo(
    () => details?.approvals?.find(
      (approval) =>
        approval.approval_status === "pending" &&
        Number(approval.content_version_id) === Number(selectedVersionId)
    ) || null,
    [details, selectedVersionId]
  );
  const approvedApproval = useMemo(
    () => details?.approvals?.find(
      (approval) =>
        approval.approval_status === "approved" &&
        Number(approval.content_version_id) === Number(selectedVersionId)
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

  const resetEditor = useCallback((nextKind = kind) => {
    setSelectedId(null);
    setDetails(null);
    setSelectedVersionId(null);
    setMode("list");
    setForm(nextKind === "article" ? { ...EMPTY_ARTICLE } : { ...EMPTY_ANNOUNCEMENT });
    setReviewerId("");
    setActionNote("");
  }, [kind]);

  const loadCategories = useCallback(async ({ signal } = {}) => {
    try {
      const result = await listNewsCategories(
        { includeInactive: true },
        { signal }
      );
      if (!signal?.aborted) setCategories(Array.isArray(result) ? result : []);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, []);

  const loadEntities = useCallback(async ({ signal } = {}) => {
    if (activeTab === "categories") return;
    setLoading(true);
    setError("");
    try {
      const result = await listNewsroomEntities(
        kind,
        { status: statusFilter, search, limit: 100, offset: 0 },
        { signal }
      );
      if (!signal?.aborted) {
        setEntities(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeTab, kind, search, statusFilter]);

  const loadDetails = useCallback(async (entityId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const nextDetails = await getNewsroomEntity(kind, entityId, { signal });
      if (signal?.aborted) return;
      const latest = nextDetails?.versions?.[0] || null;
      setDetails(nextDetails);
      setSelectedVersionId(latest?.id || null);
      setForm(formFromDetails(kind, nextDetails, latest));
      setMode("edit");
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    const controller = new AbortController();
    loadCategories({ signal: controller.signal });
    return () => controller.abort();
  }, [loadCategories]);

  useEffect(() => {
    if (activeTab === "categories") return undefined;
    const controller = new AbortController();
    loadEntities({ signal: controller.signal });
    return () => controller.abort();
  }, [activeTab, loadEntities]);

  function changeTab(nextTab) {
    setActiveTab(nextTab);
    setSearch("");
    setStatusFilter("");
    setEntities([]);
    setTotal(0);
    resetEditor(nextTab === "announcement" ? "announcement" : "article");
    setError("");
    setNotice("");
  }

  function beginCreate() {
    setSelectedId(null);
    setDetails(null);
    setSelectedVersionId(null);
    setMode("create");
    setForm(kind === "article" ? { ...EMPTY_ARTICLE } : { ...EMPTY_ANNOUNCEMENT });
    setError("");
    setNotice("");
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseVersion(versionId) {
    const version = details?.versions?.find(
      (item) => Number(item.id) === Number(versionId)
    );
    setSelectedVersionId(Number(versionId));
    setForm(formFromDetails(kind, details, version));
    setError("");
    setNotice("");
  }

  async function runEntityAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextDetails = await action();
      if (nextDetails?.entity) {
        const latest = nextDetails.versions?.[0] || null;
        setDetails(nextDetails);
        setSelectedId(nextDetails.entity.id);
        setSelectedVersionId(latest?.id || null);
        setForm(formFromDetails(kind, nextDetails, latest));
        setMode("edit");
      }
      setNotice(successMessage);
      await Promise.all([loadEntities(), loadCategories()]);
    } catch (actionError) {
      setError(contentStudioErrorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function saveEntity(event) {
    event.preventDefault();
    const payload = payloadFromForm(kind, form);
    if (mode === "create") {
      await runEntityAction(
        () => createNewsroomEntity(kind, payload),
        `The ${kind} draft was created safely.`
      );
      return;
    }
    await runEntityAction(
      () => updateNewsroomDraft(kind, selectedId, selectedVersionId, payload),
      `The ${kind} draft version was updated safely.`
    );
  }

  async function makeNewDraft() {
    await runEntityAction(
      () => createNewsroomVersion(kind, selectedId, { change_summary: "New editable version" }),
      "A new editable Newsroom version was created."
    );
  }

  async function submitForReview() {
    await runEntityAction(
      () => submitNewsroomVersion(kind, selectedId, selectedVersionId, {
        assigned_to: cleanId(reviewerId),
        note: actionNote,
      }),
      "The exact saved Newsroom version was submitted for review."
    );
  }

  async function decideApproval(decision) {
    if (!pendingApproval) return;
    await runEntityAction(
      () => decideNewsroomApproval(kind, pendingApproval.id, {
        decision,
        note: actionNote,
      }),
      decision === "approved"
        ? "The exact Newsroom version was approved."
        : "The Newsroom version was returned to draft."
    );
  }

  async function publishNow() {
    await runEntityAction(
      () => publishNewsroomVersion(kind, selectedId, selectedVersionId, {}),
      `The approved ${kind} is now published.`
    );
  }

  async function restoreSelected() {
    await runEntityAction(
      () => restoreNewsroomVersion(kind, selectedId, selectedVersionId, { reason: actionNote }),
      "The selected Newsroom version was restored as a new draft."
    );
  }

  async function archiveSelected() {
    if (!window.confirm(`Archive this ${kind}? It will no longer be public.`)) return;
    await runEntityAction(
      () => archiveNewsroomEntity(kind, selectedId, { reason: actionNote }),
      `The ${kind} was archived without deleting its history.`
    );
  }

  async function saveCategory(categoryMode, categoryId, categoryForm) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result =
        categoryMode === "create"
          ? await createNewsCategory(categoryForm)
          : await updateNewsCategory(categoryId, categoryForm);
      setCategories(Array.isArray(result) ? result : []);
      setNotice("The news category was saved safely.");
      return true;
    } catch (categoryError) {
      setError(contentStudioErrorMessage(categoryError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function archiveCategory(category) {
    if (
      !window.confirm(
        `Archive ${category.name}? Active and draft articles must already use another category.`
      )
    ) return;
    setSaving(true);
    setError("");
    try {
      const result = await archiveNewsCategory(category.id, { reason: actionNote });
      setCategories(Array.isArray(result) ? result : []);
      setNotice("The unused category was archived safely.");
    } catch (categoryError) {
      setError(contentStudioErrorMessage(categoryError));
    } finally {
      setSaving(false);
    }
  }

  const editable = mode === "create" || selectedVersion?.version_status === "draft";
  const entityTitle = kind === "article" ? "News articles" : "Rolling announcements";

  return (
    <div className="cs-newsroom-manager">
      <section className="cs-module-hero cs-newsroom-hero">
        <div className="cs-badge cs-badge-blue" aria-hidden="true">NW</div>
        <div>
          <span className="cs-eyebrow">Content</span>
          <h2>Newsroom</h2>
          <p>Prepare articles and website announcements, organize categories, and publish only exact approved versions.</p>
        </div>
        {activeTab !== "categories" && canCreate ? (
          <button type="button" className="cs-button cs-button-secondary" onClick={beginCreate}>
            New {kind}
          </button>
        ) : null}
      </section>

      <div className="cs-news-tabs" role="tablist" aria-label="Newsroom managers">
        {[
          ["article", "Articles"],
          ["announcement", "Announcements"],
          ["categories", "Categories"],
        ].map(([key, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={activeTab === key ? "is-active" : ""}
            key={key}
            onClick={() => changeTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <Notice tone="danger" message={error} onClose={() => setError("")} />
      <Notice message={notice} onClose={() => setNotice("")} />

      {activeTab === "categories" ? (
        <CategoryManager
          categories={categories}
          loading={loading}
          saving={saving}
          canCreate={canCreate}
          canEdit={canEdit}
          canArchive={canArchive}
          onReload={loadCategories}
          onSave={saveCategory}
          onArchive={archiveCategory}
        />
      ) : (
        <div className="cs-page-layout">
          <aside className="cs-panel cs-page-list-panel">
            <div className="cs-panel-heading">
              <div>
                <span className="cs-eyebrow">Library</span>
                <h3>{total.toLocaleString("en-GH")} {entityTitle.toLowerCase()}</h3>
              </div>
            </div>
            <div className="cs-filter-stack">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${kind}s`}
                aria-label={`Search ${kind}s`}
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label={`Filter ${kind}s by status`}
              >
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
              {entities.map((entity) => (
                <button
                  type="button"
                  key={entity.id}
                  className={
                    Number(selectedId) === Number(entity.id)
                      ? "cs-page-list-item is-active"
                      : "cs-page-list-item"
                  }
                  onClick={() => {
                    setSelectedId(entity.id);
                    loadDetails(entity.id);
                  }}
                >
                  <span>
                    <strong>{entity.title}</strong>
                    <small>
                      {kind === "article"
                        ? `/${entity.slug}`
                        : `${entity.display_style || "info"} · priority ${entity.priority || 0}`}
                    </small>
                  </span>
                  <StatusChip status={entity.publication_status} />
                </button>
              ))}
              {!loading && entities.length === 0 ? (
                <div className="cs-empty-state">
                  <strong>No {kind}s found</strong>
                  <span>Change the filters or create the first draft.</span>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="cs-panel cs-page-editor-panel">
            {mode === "list" ? (
              <div className="cs-empty-state cs-page-empty">
                <strong>Select a {kind}</strong>
                <span>Choose an existing record or create a new draft.</span>
              </div>
            ) : (
              <form onSubmit={saveEntity}>
                <div className="cs-editor-heading">
                  <div>
                    <span className="cs-eyebrow">
                      {mode === "create" ? `New ${kind}` : `${kind} #${selectedId}`}
                    </span>
                    <h3>{form.title || `Untitled ${kind}`}</h3>
                  </div>
                  {selectedVersion ? <StatusChip status={selectedVersion.version_status} /> : null}
                </div>

                {details?.versions?.length ? (
                  <Field label="Version history">
                    <select
                      value={selectedVersionId || ""}
                      onChange={(event) => chooseVersion(event.target.value)}
                    >
                      {details.versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          Version {version.version_number} — {displayStatus(version.version_status)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {kind === "article" ? (
                  <>
                    <div className="cs-form-grid">
                      <Field label="Article key" hint="Lowercase letters, numbers and underscores.">
                        <input
                          value={form.article_key}
                          onChange={(event) => updateField("article_key", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </Field>
                      <Field label="Public URL slug">
                        <input
                          value={form.slug}
                          onChange={(event) => updateField("slug", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </Field>
                      <Field label="Article title">
                        <input
                          value={form.title}
                          onChange={(event) => updateField("title", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </Field>
                      <Field label="Category">
                        <select
                          value={form.category_id}
                          onChange={(event) => updateField("category_id", event.target.value)}
                          disabled={!editable}
                        >
                          <option value="">No category</option>
                          {categories
                            .filter((category) => category.is_active || Number(category.id) === Number(form.category_id))
                            .map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}{category.is_active ? "" : " (archived)"}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Author display name">
                        <input
                          value={form.author_display_name}
                          onChange={(event) => updateField("author_display_name", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                      <Field label="Featured image asset ID">
                        <input
                          inputMode="numeric"
                          value={form.featured_media_asset_id}
                          onChange={(event) => updateField("featured_media_asset_id", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                    </div>
                    <Field label="Article excerpt">
                      <textarea
                        rows="4"
                        value={form.excerpt}
                        onChange={(event) => updateField("excerpt", event.target.value)}
                        disabled={!editable}
                      />
                    </Field>
                    <Field
                      label="Article body"
                      hint={
                        form.has_structured_body
                          ? "This article contains advanced structured content. Leave blank to preserve it, or enter text to replace it."
                          : "Plain text article content."
                      }
                    >
                      <textarea
                        rows="10"
                        value={form.body_text}
                        onChange={(event) => updateField("body_text", event.target.value)}
                        disabled={!editable}
                      />
                    </Field>
                    <label className="cs-inline-check">
                      <input
                        type="checkbox"
                        checked={form.is_featured}
                        onChange={(event) => updateField("is_featured", event.target.checked)}
                        disabled={!editable}
                      />
                      Feature this article prominently
                    </label>
                    <div className="cs-editor-section-heading">
                      <div><span className="cs-eyebrow">Search visibility</span><h4>Article SEO</h4></div>
                    </div>
                    <div className="cs-form-grid">
                      <Field label="SEO title">
                        <input
                          value={form.seo_title}
                          onChange={(event) => updateField("seo_title", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                      <Field label="Meta description">
                        <input
                          value={form.meta_description}
                          onChange={(event) => updateField("meta_description", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="cs-form-grid">
                      <Field label="Announcement key" hint="Lowercase letters, numbers and underscores.">
                        <input
                          value={form.announcement_key}
                          onChange={(event) => updateField("announcement_key", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </Field>
                      <Field label="Announcement title">
                        <input
                          value={form.title}
                          onChange={(event) => updateField("title", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </Field>
                      <Field label="Display style">
                        <select
                          value={form.display_style}
                          onChange={(event) => updateField("display_style", event.target.value)}
                          disabled={!editable}
                        >
                          <option value="info">Information</option>
                          <option value="success">Success</option>
                          <option value="warning">Warning</option>
                          <option value="urgent">Urgent</option>
                          <option value="promotion">Promotion</option>
                        </select>
                      </Field>
                      <Field label="Priority">
                        <input
                          type="number"
                          min="-1000"
                          max="1000"
                          value={form.priority}
                          onChange={(event) => updateField("priority", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                    </div>
                    <Field label="Announcement message">
                      <textarea
                        rows="6"
                        value={form.body_text}
                        onChange={(event) => updateField("body_text", event.target.value)}
                        disabled={!editable}
                      />
                    </Field>
                    <div className="cs-form-grid">
                      <Field label="Link label" hint="Supply both a label and URL, or leave both blank.">
                        <input
                          value={form.link_label}
                          onChange={(event) => updateField("link_label", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                      <Field label="Safe link URL" hint="Use /relative-path or an HTTPS address without credentials.">
                        <input
                          value={form.link_url}
                          onChange={(event) => updateField("link_url", event.target.value)}
                          disabled={!editable}
                        />
                      </Field>
                    </div>
                    <label className="cs-inline-check">
                      <input
                        type="checkbox"
                        checked={form.ticker_enabled}
                        onChange={(event) => updateField("ticker_enabled", event.target.checked)}
                        disabled={!editable}
                      />
                      Show in the rolling announcement ticker
                    </label>
                  </>
                )}

                <Field label="Change summary">
                  <input
                    value={form.change_summary}
                    onChange={(event) => updateField("change_summary", event.target.value)}
                    disabled={!editable}
                    placeholder="Explain what changed"
                  />
                </Field>

                <div className="cs-editor-actions">
                  {editable && (mode === "create" ? canCreate : canEdit) ? (
                    <button
                      className="cs-button cs-button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save draft"}
                    </button>
                  ) : null}
                  {mode === "edit" && selectedVersion?.version_status !== "draft" && canEdit ? (
                    <button
                      className="cs-button cs-button-secondary"
                      type="button"
                      onClick={makeNewDraft}
                      disabled={saving}
                    >
                      Create new draft
                    </button>
                  ) : null}
                  {mode === "edit" && selectedVersion?.version_status === "draft" && canSubmit ? (
                    <button
                      className="cs-button cs-button-warning"
                      type="button"
                      onClick={submitForReview}
                      disabled={saving}
                    >
                      Submit for review
                    </button>
                  ) : null}
                  {mode === "edit" && selectedVersion?.version_status === "in_review" && pendingApproval && canApprove ? (
                    <>
                      <button
                        className="cs-button cs-button-success"
                        type="button"
                        onClick={() => decideApproval("approved")}
                        disabled={saving}
                      >
                        Approve version
                      </button>
                      <button
                        className="cs-button cs-button-danger"
                        type="button"
                        onClick={() => decideApproval("rejected")}
                        disabled={saving}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                  {mode === "edit" && selectedVersion?.version_status === "approved" && approvedApproval && canPublish ? (
                    <button
                      className="cs-button cs-button-success"
                      type="button"
                      onClick={publishNow}
                      disabled={saving}
                    >
                      Publish now
                    </button>
                  ) : null}
                  {mode === "edit" && selectedVersion && selectedVersion.version_status !== "draft" && canRestore ? (
                    <button
                      className="cs-button cs-button-secondary"
                      type="button"
                      onClick={restoreSelected}
                      disabled={saving}
                    >
                      Restore as draft
                    </button>
                  ) : null}
                  {mode === "edit" && canArchive ? (
                    <button
                      className="cs-button cs-button-danger cs-action-right"
                      type="button"
                      onClick={archiveSelected}
                      disabled={saving}
                    >
                      Archive {kind}
                    </button>
                  ) : null}
                </div>

                {mode === "edit" && (canSubmit || canApprove || canRestore || canArchive) ? (
                  <div className="cs-review-box">
                    <div className="cs-form-grid">
                      {canSubmit ? (
                        <Field label="Reviewer user ID" hint="Optional; leave blank for the general review queue.">
                          <input
                            inputMode="numeric"
                            value={reviewerId}
                            onChange={(event) => setReviewerId(event.target.value)}
                          />
                        </Field>
                      ) : null}
                      <Field label="Review or action note">
                        <input
                          value={actionNote}
                          onChange={(event) => setActionNote(event.target.value)}
                          placeholder="Reason, instruction or decision note"
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
