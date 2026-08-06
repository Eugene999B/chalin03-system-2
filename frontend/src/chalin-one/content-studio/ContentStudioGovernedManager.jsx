import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import "./contentStudioPageManager.css";
import "./contentStudioExpandedManagers.css";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function displayStatus(value) {
  return String(value || "draft").replaceAll("_", " ");
}

export function GovernedField({ label, children, hint }) {
  return (
    <label className="cs-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusChip({ status }) {
  return (
    <span className={`cs-status-chip cs-status-${contentStudioStatusTone(status)}`}>
      {displayStatus(status)}
    </span>
  );
}

function Notice({ tone = "success", message, onClose, noun }) {
  if (!message) return null;
  return (
    <div
      className={`cs-alert cs-alert-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        <strong>{tone === "danger" ? "Action not completed" : `${noun} updated`}</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}

export default function ContentStudioGovernedManager({ config, api }) {
  const auth = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [form, setForm] = useState(() => cloneValue(config.emptyForm));
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [actionNote, setActionNote] = useState("");

  const selectedVersion = useMemo(
    () =>
      details?.versions?.find(
        (version) => Number(version.id) === Number(selectedVersionId)
      ) || null,
    [details, selectedVersionId]
  );
  const pendingApproval = useMemo(
    () =>
      details?.approvals?.find(
        (approval) =>
          approval.approval_status === "pending" &&
          Number(approval.content_version_id) === Number(selectedVersionId)
      ) || null,
    [details, selectedVersionId]
  );
  const approvedApproval = useMemo(
    () =>
      details?.approvals?.find(
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

  const loadItems = useCallback(
    async ({ signal } = {}) => {
      setLoading(true);
      setError("");
      try {
        const result = await api.list(
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
    },
    [api, search, statusFilter]
  );

  const loadDetails = useCallback(
    async (entityId, { signal } = {}) => {
      setLoading(true);
      setError("");
      try {
        const nextDetails = await api.get(entityId, { signal });
        if (signal?.aborted) return;
        const latest = nextDetails?.versions?.[0] || null;
        setDetails(nextDetails);
        setSelectedVersionId(latest?.id || null);
        setForm(config.formFromDetails(nextDetails, latest));
        setMode("edit");
      } catch (requestError) {
        if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [api, config]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadItems({ signal: controller.signal });
    return () => controller.abort();
  }, [loadItems]);

  function beginCreate() {
    setSelectedId(null);
    setDetails(null);
    setSelectedVersionId(null);
    setForm(cloneValue(config.emptyForm));
    setMode("create");
    setError("");
    setNotice("");
    setReviewerId("");
    setActionNote("");
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateForm(updater) {
    setForm((current) => updater(current));
  }

  function chooseVersion(versionId) {
    const version = details?.versions?.find(
      (item) => Number(item.id) === Number(versionId)
    );
    setSelectedVersionId(Number(versionId));
    setForm(config.formFromDetails(details, version));
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
        setForm(config.formFromDetails(nextDetails, latest));
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
    const payload = config.payloadFromForm(form);
    if (mode === "create") {
      await runAction(
        () => api.create(payload),
        `The ${config.noun.toLowerCase()} draft was created safely.`
      );
      return;
    }
    await runAction(
      () => api.update(selectedId, selectedVersionId, payload),
      `The ${config.noun.toLowerCase()} draft version was updated safely.`
    );
  }

  async function makeNewDraft() {
    await runAction(
      () =>
        api.createVersion(selectedId, {
          change_summary: `New editable ${config.noun.toLowerCase()} version`,
        }),
      `A new editable ${config.noun.toLowerCase()} version was created.`
    );
  }

  async function submitForReview() {
    await runAction(
      () =>
        api.submit(selectedId, selectedVersionId, {
          assigned_to: cleanId(reviewerId),
          note: actionNote,
        }),
      `The exact saved ${config.noun.toLowerCase()} version was submitted for review.`
    );
  }

  async function decideApproval(decision) {
    if (!pendingApproval) return;
    await runAction(
      () =>
        api.decide(pendingApproval.id, {
          decision,
          note: actionNote,
        }),
      decision === "approved"
        ? `The exact ${config.noun.toLowerCase()} version was approved.`
        : `The ${config.noun.toLowerCase()} version was returned to draft.`
    );
  }

  async function publishNow() {
    await runAction(
      () => api.publish(selectedId, selectedVersionId, {}),
      `The approved ${config.noun.toLowerCase()} is now published.`
    );
  }

  async function restoreSelected() {
    await runAction(
      () =>
        api.restore(selectedId, selectedVersionId, {
          reason: actionNote,
        }),
      `The selected ${config.noun.toLowerCase()} version was restored as a new draft.`
    );
  }

  async function archiveSelected() {
    if (!window.confirm(config.archivePrompt)) return;
    await runAction(
      () => api.archive(selectedId, { reason: actionNote }),
      `The ${config.noun.toLowerCase()} was archived without deleting its history.`
    );
  }

  const editable = mode === "create" || selectedVersion?.version_status === "draft";

  return (
    <div className="cs-expanded-manager">
      <section className="cs-module-hero">
        <div className={`cs-badge cs-badge-${config.tone || "navy"}`} aria-hidden="true">
          {config.badge}
        </div>
        <div>
          <span className="cs-eyebrow">{config.group || "Company"}</span>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        {canCreate ? (
          <button type="button" className="cs-button cs-button-secondary" onClick={beginCreate}>
            New {config.noun.toLowerCase()}
          </button>
        ) : null}
      </section>

      <Notice tone="danger" message={error} onClose={() => setError("")} noun={config.noun} />
      <Notice message={notice} onClose={() => setNotice("")} noun={config.noun} />

      <div className="cs-page-layout">
        <aside className="cs-panel cs-page-list-panel">
          <div className="cs-panel-heading">
            <div>
              <span className="cs-eyebrow">{config.libraryLabel || "Directory"}</span>
              <h3>{total.toLocaleString("en-GH")} {config.plural}</h3>
            </div>
          </div>
          <div className="cs-filter-stack">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={config.searchPlaceholder}
              aria-label={`Search ${config.plural}`}
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label={`Filter ${config.plural} by status`}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="expired">Expired</option>
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
                  <strong>{config.listPrimary(item)}</strong>
                  <small>{config.listSecondary(item)}</small>
                </span>
                <StatusChip status={item.publication_status} />
              </button>
            ))}
            {!loading && items.length === 0 ? (
              <div className="cs-empty-state">
                <strong>No {config.plural} found</strong>
                <span>Change the filters or create the first draft.</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="cs-panel cs-page-editor-panel">
          {mode === "list" ? (
            <div className="cs-empty-state cs-page-empty">
              <strong>Select a {config.noun.toLowerCase()}</strong>
              <span>Choose an existing record or create a new controlled draft.</span>
            </div>
          ) : (
            <form onSubmit={saveEntity}>
              <div className="cs-editor-heading">
                <div>
                  <span className="cs-eyebrow">
                    {mode === "create" ? "New draft" : `${config.noun} #${selectedId}`}
                  </span>
                  <h3>{config.formTitle(form)}</h3>
                </div>
                {selectedVersion ? <StatusChip status={selectedVersion.version_status} /> : null}
              </div>

              {details?.versions?.length ? (
                <GovernedField label="Version history">
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
                </GovernedField>
              ) : null}

              {config.renderFields({
                form,
                updateField,
                updateForm,
                editable,
                mode,
              })}

              <GovernedField label="Change summary">
                <input
                  value={form.change_summary || ""}
                  onChange={(event) => updateField("change_summary", event.target.value)}
                  disabled={!editable}
                  placeholder="Explain what changed in this version"
                />
              </GovernedField>

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
                    Archive {config.noun.toLowerCase()}
                  </button>
                ) : null}
              </div>

              {mode === "edit" && (canSubmit || canApprove || canRestore || canArchive) ? (
                <div className="cs-review-box">
                  <div className="cs-form-grid">
                    {canSubmit ? (
                      <GovernedField
                        label="Reviewer user ID"
                        hint="Optional; leave blank for the shared review queue."
                      >
                        <input
                          inputMode="numeric"
                          value={reviewerId}
                          onChange={(event) => setReviewerId(event.target.value)}
                        />
                      </GovernedField>
                    ) : null}
                    <GovernedField label="Review or action note">
                      <input
                        value={actionNote}
                        onChange={(event) => setActionNote(event.target.value)}
                        placeholder="Reason, instruction or decision note"
                      />
                    </GovernedField>
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

export { cleanId };
