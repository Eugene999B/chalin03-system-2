import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  archivePortfolioEntity,
  createPortfolioEntity,
  createPortfolioVersion,
  decidePortfolioApproval,
  getPortfolioEntity,
  listPortfolioEntities,
  publishPortfolioVersion,
  restorePortfolioVersion,
  submitPortfolioVersion,
  updatePortfolioDraft,
} from "./contentStudioPortfolioApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import "./contentStudioPageManager.css";
import "./contentStudioLeadershipManager.css";

const KIND = "leadership";
const SOCIAL_LINK_FIELDS = Object.freeze([
  ["website", "Website", "https://example.com"],
  ["linkedin", "LinkedIn", "https://www.linkedin.com/in/name"],
  ["facebook", "Facebook", "https://www.facebook.com/name"],
  ["instagram", "Instagram", "https://www.instagram.com/name"],
  ["x", "X", "https://x.com/name"],
  ["youtube", "YouTube", "https://www.youtube.com/@channel"],
  ["email", "Email link", "mailto:name@example.com"],
  ["phone", "Phone link", "tel:+233000000000"],
]);

const EMPTY_FORM = Object.freeze({
  profile_key: "",
  slug: "",
  full_name: "",
  position_title: "",
  professional_summary: "",
  biography_text: "",
  original_biography: {},
  has_structured_biography: false,
  portrait_media_asset_id: "",
  signature_media_asset_id: "",
  social_links: {},
  sort_order: 0,
  change_summary: "",
});

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function displayStatus(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function biographyEditor(value) {
  const biography = value && typeof value === "object" ? value : {};
  if (typeof biography.text === "string") {
    return {
      biography_text: biography.text,
      original_biography: biography,
      has_structured_biography: false,
    };
  }
  return {
    biography_text: "",
    original_biography: biography,
    has_structured_biography: Object.keys(biography).length > 0,
  };
}

function formFromDetails(details, version = null) {
  const selectedVersion = version || details?.versions?.[0] || null;
  const snapshot = selectedVersion?.snapshot || details?.current_snapshot || {};
  return {
    profile_key: snapshot.profile_key || "",
    slug: snapshot.slug || "",
    full_name: snapshot.full_name || "",
    position_title: snapshot.position_title || "",
    professional_summary: snapshot.professional_summary || "",
    ...biographyEditor(snapshot.biography || snapshot.biography_json),
    portrait_media_asset_id: snapshot.portrait_media_asset_id || "",
    signature_media_asset_id: snapshot.signature_media_asset_id || "",
    social_links:
      snapshot.social_links && typeof snapshot.social_links === "object"
        ? snapshot.social_links
        : {},
    sort_order: Number.isInteger(Number(snapshot.sort_order))
      ? Number(snapshot.sort_order)
      : 0,
    change_summary: selectedVersion?.change_summary || "",
  };
}

function biographyForSave(form) {
  if (form.has_structured_biography && form.biography_text === "") {
    return form.original_biography || {};
  }
  if (
    typeof form.original_biography?.text === "string" &&
    form.biography_text === form.original_biography.text
  ) {
    return form.original_biography;
  }
  return { text: form.biography_text };
}

function payloadFromForm(form) {
  return {
    profile_key: form.profile_key,
    slug: form.slug,
    full_name: form.full_name,
    position_title: form.position_title,
    professional_summary: form.professional_summary,
    biography: biographyForSave(form),
    portrait_media_asset_id: cleanId(form.portrait_media_asset_id),
    signature_media_asset_id: cleanId(form.signature_media_asset_id),
    social_links: Object.fromEntries(
      Object.entries(form.social_links || {}).filter(([, value]) =>
        String(value || "").trim()
      )
    ),
    sort_order: Number(form.sort_order) || 0,
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
        <strong>{tone === "danger" ? "Action not completed" : "Leadership updated"}</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}

export default function ContentStudioLeadershipManager() {
  const auth = useAuth();
  const [items, setItems] = useState([]);
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
  const [actionNote, setActionNote] = useState("");

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

  const loadItems = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listPortfolioEntities(
        KIND,
        { status: statusFilter, search, limit: 100, offset: 0 },
        { signal }
      );
      if (!signal?.aborted) {
        setItems(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search, statusFilter]);

  const loadDetails = useCallback(async (entityId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const nextDetails = await getPortfolioEntity(KIND, entityId, { signal });
      if (signal?.aborted) return;
      const latest = nextDetails?.versions?.[0] || null;
      setDetails(nextDetails);
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
    loadItems({ signal: controller.signal });
    return () => controller.abort();
  }, [loadItems]);

  function beginCreate() {
    setSelectedId(null);
    setDetails(null);
    setSelectedVersionId(null);
    setForm({ ...EMPTY_FORM, social_links: {} });
    setMode("create");
    setError("");
    setNotice("");
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSocialLink(key, value) {
    setForm((current) => ({
      ...current,
      social_links: { ...current.social_links, [key]: value },
    }));
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
      if (nextDetails?.entity) {
        const latest = nextDetails.versions?.[0] || null;
        setDetails(nextDetails);
        setSelectedId(nextDetails.entity.id);
        setSelectedVersionId(latest?.id || null);
        setForm(formFromDetails(nextDetails, latest));
        setMode("edit");
      }
      setNotice(successMessage);
      await loadItems();
    } catch (actionError) {
      setError(contentStudioErrorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function saveEntity(event) {
    event.preventDefault();
    const payload = payloadFromForm(form);
    if (mode === "create") {
      await runAction(
        () => createPortfolioEntity(KIND, payload),
        "The leadership profile draft was created safely."
      );
      return;
    }
    await runAction(
      () => updatePortfolioDraft(KIND, selectedId, selectedVersionId, payload),
      "The leadership draft version was updated safely."
    );
  }

  async function makeNewDraft() {
    await runAction(
      () => createPortfolioVersion(KIND, selectedId, {
        change_summary: "New editable leadership version",
      }),
      "A new editable leadership version was created."
    );
  }

  async function submitForReview() {
    await runAction(
      () => submitPortfolioVersion(KIND, selectedId, selectedVersionId, {
        assigned_to: cleanId(reviewerId),
        note: actionNote,
      }),
      "The exact saved leadership version was submitted for review."
    );
  }

  async function decideApproval(decision) {
    if (!pendingApproval) return;
    await runAction(
      () => decidePortfolioApproval(KIND, pendingApproval.id, {
        decision,
        note: actionNote,
      }),
      decision === "approved"
        ? "The exact leadership version was approved."
        : "The leadership version was returned to draft."
    );
  }

  async function publishNow() {
    await runAction(
      () => publishPortfolioVersion(KIND, selectedId, selectedVersionId, {}),
      "The approved leadership profile is now published."
    );
  }

  async function restoreSelected() {
    await runAction(
      () => restorePortfolioVersion(KIND, selectedId, selectedVersionId, {
        reason: actionNote,
      }),
      "The selected leadership version was restored as a new draft."
    );
  }

  async function archiveSelected() {
    if (!window.confirm("Archive this leadership profile? It will no longer be public.")) {
      return;
    }
    await runAction(
      () => archivePortfolioEntity(KIND, selectedId, { reason: actionNote }),
      "The leadership profile was archived without deleting its history."
    );
  }

  const editable = mode === "create" || selectedVersion?.version_status === "draft";

  return (
    <div className="cs-leadership-manager">
      <section className="cs-module-hero cs-leadership-hero">
        <div className="cs-badge cs-badge-navy" aria-hidden="true">LD</div>
        <div>
          <span className="cs-eyebrow">Company</span>
          <h2>Leadership</h2>
          <p>
            Maintain professional leadership biographies, approved portraits and
            safe public contact links through exact-version governance.
          </p>
        </div>
        {canCreate ? (
          <button type="button" className="cs-button cs-button-secondary" onClick={beginCreate}>
            New profile
          </button>
        ) : null}
      </section>

      <Notice tone="danger" message={error} onClose={() => setError("")} />
      <Notice message={notice} onClose={() => setNotice("")} />

      <div className="cs-page-layout">
        <aside className="cs-panel cs-page-list-panel">
          <div className="cs-panel-heading">
            <div>
              <span className="cs-eyebrow">Directory</span>
              <h3>{total.toLocaleString("en-GH")} profiles</h3>
            </div>
          </div>
          <div className="cs-filter-stack">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or position"
              aria-label="Search leadership profiles"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter leadership by status"
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
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={
                  Number(selectedId) === Number(item.id)
                    ? "cs-page-list-item is-active"
                    : "cs-page-list-item"
                }
                onClick={() => {
                  setSelectedId(item.id);
                  loadDetails(item.id);
                }}
              >
                <span>
                  <strong>{item.full_name}</strong>
                  <small>{item.position_title || `/${item.slug}`}</small>
                </span>
                <StatusChip status={item.publication_status} />
              </button>
            ))}
            {!loading && items.length === 0 ? (
              <div className="cs-empty-state">
                <strong>No leadership profiles found</strong>
                <span>Change the filters or create the first draft.</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="cs-panel cs-page-editor-panel">
          {mode === "list" ? (
            <div className="cs-empty-state cs-page-empty">
              <strong>Select a leadership profile</strong>
              <span>Choose an existing profile or create a new draft.</span>
            </div>
          ) : (
            <form onSubmit={saveEntity}>
              <div className="cs-editor-heading">
                <div>
                  <span className="cs-eyebrow">
                    {mode === "create" ? "New profile" : `Leadership #${selectedId}`}
                  </span>
                  <h3>{form.full_name || "Unnamed leader"}</h3>
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

              <div className="cs-form-grid">
                <Field label="Profile key" hint="Lowercase letters, numbers and underscores.">
                  <input
                    value={form.profile_key}
                    onChange={(event) => updateField("profile_key", event.target.value)}
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
                <Field label="Full name">
                  <input
                    value={form.full_name}
                    onChange={(event) => updateField("full_name", event.target.value)}
                    disabled={!editable}
                    required
                  />
                </Field>
                <Field label="Position title">
                  <input
                    value={form.position_title}
                    onChange={(event) => updateField("position_title", event.target.value)}
                    disabled={!editable}
                    required
                  />
                </Field>
                <Field label="Portrait media asset ID" hint="Must be an active image; publication requires public and ready status.">
                  <input
                    inputMode="numeric"
                    value={form.portrait_media_asset_id}
                    onChange={(event) => updateField("portrait_media_asset_id", event.target.value)}
                    disabled={!editable}
                  />
                </Field>
                <Field label="Signature media asset ID" hint="Optional approved signature image.">
                  <input
                    inputMode="numeric"
                    value={form.signature_media_asset_id}
                    onChange={(event) => updateField("signature_media_asset_id", event.target.value)}
                    disabled={!editable}
                  />
                </Field>
                <Field label="Display order">
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(event) => updateField("sort_order", event.target.value)}
                    disabled={!editable}
                  />
                </Field>
              </div>

              <Field label="Professional summary">
                <textarea
                  rows="5"
                  value={form.professional_summary}
                  onChange={(event) => updateField("professional_summary", event.target.value)}
                  disabled={!editable}
                />
              </Field>

              <Field
                label="Biography"
                hint={
                  form.has_structured_biography
                    ? "This biography contains advanced structured content. Leave blank to preserve it, or enter text to replace it."
                    : "Plain text public biography."
                }
              >
                <textarea
                  rows="10"
                  value={form.biography_text}
                  onChange={(event) => updateField("biography_text", event.target.value)}
                  disabled={!editable}
                />
              </Field>

              <div className="cs-editor-section-heading">
                <div>
                  <span className="cs-eyebrow">Public links</span>
                  <h4>Social and contact links</h4>
                </div>
              </div>
              <div className="cs-social-link-grid">
                {SOCIAL_LINK_FIELDS.map(([key, label, placeholder]) => (
                  <Field key={key} label={label}>
                    <input
                      type="text"
                      value={form.social_links?.[key] || ""}
                      placeholder={placeholder}
                      onChange={(event) => updateSocialLink(key, event.target.value)}
                      disabled={!editable}
                    />
                  </Field>
                ))}
              </div>

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
                  <button className="cs-button cs-button-primary" type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save draft"}
                  </button>
                ) : null}
                {mode === "edit" && selectedVersion?.version_status !== "draft" && canEdit ? (
                  <button className="cs-button cs-button-secondary" type="button" onClick={makeNewDraft} disabled={saving}>
                    Create new draft
                  </button>
                ) : null}
                {mode === "edit" && selectedVersion?.version_status === "draft" && canSubmit ? (
                  <button className="cs-button cs-button-warning" type="button" onClick={submitForReview} disabled={saving}>
                    Submit for review
                  </button>
                ) : null}
                {mode === "edit" && selectedVersion?.version_status === "in_review" && pendingApproval && canApprove ? (
                  <>
                    <button className="cs-button cs-button-success" type="button" onClick={() => decideApproval("approved")} disabled={saving}>
                      Approve version
                    </button>
                    <button className="cs-button cs-button-danger" type="button" onClick={() => decideApproval("rejected")} disabled={saving}>
                      Reject
                    </button>
                  </>
                ) : null}
                {mode === "edit" && selectedVersion?.version_status === "approved" && approvedApproval && canPublish ? (
                  <button className="cs-button cs-button-success" type="button" onClick={publishNow} disabled={saving}>
                    Publish now
                  </button>
                ) : null}
                {mode === "edit" && selectedVersion && selectedVersion.version_status !== "draft" && canRestore ? (
                  <button className="cs-button cs-button-secondary" type="button" onClick={restoreSelected} disabled={saving}>
                    Restore as draft
                  </button>
                ) : null}
                {mode === "edit" && canArchive ? (
                  <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={archiveSelected} disabled={saving}>
                    Archive profile
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
    </div>
  );
}
