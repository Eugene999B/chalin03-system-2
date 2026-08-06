import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  archiveForm,
  createForm,
  createFormVersion,
  decideFormApproval,
  getForm,
  listForms,
  publishFormVersion,
  restoreFormVersion,
  submitFormVersion,
  updateFormDraft,
} from "./contentStudioOperationsApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import "./contentStudioOperationalManagers.css";

const FIELD_TYPES = Object.freeze([
  "text",
  "textarea",
  "email",
  "tel",
  "number",
  "select",
  "radio",
  "multiselect",
  "checkbox_group",
  "checkbox",
  "boolean",
]);
const FORM_TYPES = Object.freeze([
  "general_enquiry",
  "contact",
  "quote_request",
  "equipment_hire",
  "installment_application",
  "career_application",
  "supplier_registration",
  "tender_response",
]);
const OPTION_TYPES = new Set(["select", "radio", "multiselect", "checkbox_group"]);
const EMPTY_FIELD = Object.freeze({
  field_key: "",
  field_type: "text",
  label: "",
  placeholder: "",
  help_text: "",
  is_required: false,
  options_text: "",
  max_length: "",
  minimum: "",
  maximum: "",
});
const EMPTY_FORM = Object.freeze({
  form_key: "",
  slug: "",
  name: "",
  form_type: "general_enquiry",
  description: "",
  confirmation_message: "Thank you. Your information was received.",
  require_contact: true,
  require_consent: true,
  submit_label: "Submit",
  consent_text_version: "privacy-v1",
  fields: [],
  change_summary: "",
});

function Field({ label, hint, children }) {
  return <label className="cs-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Notice({ error, message, clear }) {
  const value = error || message;
  if (!value) return null;
  return <div className={`cs-alert ${error ? "cs-alert-danger" : "cs-alert-success"}`} role={error ? "alert" : "status"}><div><strong>{error ? "Action not completed" : "Form Builder updated"}</strong><span>{value}</span></div><button type="button" onClick={clear}>Close</button></div>;
}

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function fieldFromSnapshot(field = {}) {
  return {
    field_key: field.field_key || field.key || "",
    field_type: field.field_type || field.type || "text",
    label: field.label || "",
    placeholder: field.placeholder || "",
    help_text: field.help_text || "",
    is_required: field.is_required === true || field.required === true,
    options_text: Array.isArray(field.options) ? field.options.join("\n") : "",
    max_length: field.validation?.max_length ?? "",
    minimum: field.validation?.minimum ?? "",
    maximum: field.validation?.maximum ?? "",
  };
}

function formFromDetails(details, version = null) {
  const selected = version || details?.versions?.[0] || null;
  const snapshot = selected?.snapshot || details?.current_snapshot || {};
  const settings = snapshot.settings || snapshot.settings_json || {};
  return {
    form_key: snapshot.form_key || "",
    slug: snapshot.slug || "",
    name: snapshot.name || "",
    form_type: snapshot.form_type || "general_enquiry",
    description: snapshot.description || "",
    confirmation_message: snapshot.confirmation_message || "Thank you. Your information was received.",
    require_contact: settings.require_contact !== false,
    require_consent: settings.require_consent !== false,
    submit_label: settings.submit_label || "Submit",
    consent_text_version: settings.consent_text_version || "privacy-v1",
    fields: Array.isArray(snapshot.fields) ? snapshot.fields.map(fieldFromSnapshot) : [],
    change_summary: selected?.change_summary || "",
  };
}

function payloadFromForm(form) {
  return {
    form_key: form.form_key,
    slug: form.slug,
    name: form.name,
    form_type: form.form_type,
    description: form.description,
    confirmation_message: form.confirmation_message,
    settings: {
      require_contact: form.require_contact,
      require_consent: form.require_consent,
      submit_label: form.submit_label,
      consent_text_version: form.consent_text_version,
    },
    fields: form.fields.map((field, index) => ({
      field_key: field.field_key,
      field_type: field.field_type,
      label: field.label,
      placeholder: field.placeholder,
      help_text: field.help_text,
      is_required: field.is_required,
      options: OPTION_TYPES.has(field.field_type)
        ? field.options_text.split("\n").map((option) => option.trim()).filter(Boolean)
        : [],
      validation: {
        ...(field.max_length !== "" ? { max_length: Number(field.max_length) } : {}),
        ...(field.minimum !== "" ? { minimum: Number(field.minimum) } : {}),
        ...(field.maximum !== "" ? { maximum: Number(field.maximum) } : {}),
      },
      sort_order: index,
    })),
    change_summary: form.change_summary,
  };
}

export default function ContentStudioFormManager() {
  const auth = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, fields: [] });
  const [mode, setMode] = useState("list");
  const [reviewerId, setReviewerId] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.formsManage);
  const canSubmit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submit);
  const canApprove = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.approve);
  const canPublish = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.publish);
  const canRestore = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.restore);
  const canArchive = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.archive);

  const selectedVersion = useMemo(() => details?.versions?.find((version) => Number(version.id) === Number(selectedVersionId)) || null, [details, selectedVersionId]);
  const pendingApproval = useMemo(() => details?.approvals?.find((approval) => approval.approval_status === "pending" && Number(approval.content_version_id) === Number(selectedVersionId)) || null, [details, selectedVersionId]);
  const approvedApproval = useMemo(() => details?.approvals?.find((approval) => approval.approval_status === "approved" && Number(approval.content_version_id) === Number(selectedVersionId)) || null, [details, selectedVersionId]);

  const loadItems = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listForms({ search, status: statusFilter, limit: 100, offset: 0 }, { signal });
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

  const loadDetails = useCallback(async (formId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const next = await getForm(formId, { signal });
      if (signal?.aborted) return;
      const latest = next?.versions?.[0] || null;
      setDetails(next);
      setSelectedId(next?.form?.id || Number(formId));
      setSelectedVersionId(latest?.id || null);
      setForm(formFromDetails(next, latest));
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
    setForm({ ...EMPTY_FORM, fields: [] });
    setMode("create");
    setError("");
    setNotice("");
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateBuilderField(index, key, value) {
    setForm((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field),
    }));
  }

  function addBuilderField() {
    setForm((current) => current.fields.length >= 60 ? current : ({
      ...current,
      fields: [...current.fields, { ...EMPTY_FIELD }],
    }));
  }

  function removeBuilderField(index) {
    setForm((current) => ({ ...current, fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index) }));
  }

  function moveField(index, direction) {
    setForm((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.fields.length) return current;
      const fields = [...current.fields];
      [fields[index], fields[nextIndex]] = [fields[nextIndex], fields[index]];
      return { ...current, fields };
    });
  }

  function chooseVersion(versionId) {
    const version = details?.versions?.find((item) => Number(item.id) === Number(versionId));
    setSelectedVersionId(Number(versionId));
    setForm(formFromDetails(details, version));
  }

  async function run(action, message) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await action();
      if (next?.form) {
        const latest = next.versions?.[0] || null;
        setDetails(next);
        setSelectedId(next.form.id);
        setSelectedVersionId(latest?.id || null);
        setForm(formFromDetails(next, latest));
        setMode("edit");
      }
      setNotice(message);
      await loadItems();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    const payload = payloadFromForm(form);
    if (mode === "create") {
      await run(() => createForm(payload), "The public form draft was created safely.");
    } else {
      await run(() => updateFormDraft(selectedId, selectedVersionId, payload), "The form draft version was updated safely.");
    }
  }

  async function newVersion() {
    await run(() => createFormVersion(selectedId, { change_summary: "New editable form version" }), "A new editable form version was created.");
  }

  async function submitReview() {
    await run(() => submitFormVersion(selectedId, selectedVersionId, { assigned_to: cleanId(reviewerId), note: actionNote }), "The exact form version was submitted for review.");
  }

  async function decide(decision) {
    if (!pendingApproval) return;
    await run(() => decideFormApproval(pendingApproval.id, { decision, note: actionNote }), decision === "approved" ? "The exact form version was approved." : "The form version was returned to draft.");
  }

  async function publish() {
    await run(() => publishFormVersion(selectedId, selectedVersionId), "The approved form is now published.");
  }

  async function restore() {
    await run(() => restoreFormVersion(selectedId, selectedVersionId, actionNote), "The selected form version was restored as a new draft.");
  }

  async function archive() {
    if (!window.confirm("Archive this form? Existing customer submissions will be preserved.")) return;
    await run(() => archiveForm(selectedId, actionNote), "The form was archived without deleting customer submissions.");
  }

  const editable = mode === "create" || selectedVersion?.version_status === "draft";

  return (
    <div className="cs-operational-manager">
      <section className="cs-module-hero"><div className="cs-badge cs-badge-green" aria-hidden="true">FB</div><div><span className="cs-eyebrow">Engagement</span><h2>Form Builder</h2><p>Create safe enquiry, quotation, application and registration forms without scripts, file fields or raw HTML.</p></div>{canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={beginCreate}>New form</button> : null}</section>
      <Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} />
      <div className="cs-page-layout">
        <aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Forms</span><h3>{total.toLocaleString("en-GH")} forms</h3></div></div><div className="cs-filter-stack"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, slug or type" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="published">Published</option><option value="archived">Archived</option></select></div><div className="cs-page-list" aria-busy={loading ? "true" : "false"}>{items.map((item) => <button type="button" key={item.id} className={Number(selectedId) === Number(item.id) ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => loadDetails(item.id)}><span><strong>{item.name}</strong><small>{item.form_type} · {item.field_count || 0} fields</small></span><span className={`cs-status-chip cs-status-${contentStudioStatusTone(item.publication_status)}`}>{statusLabel(item.publication_status)}</span></button>)}</div></aside>
        <section className="cs-panel cs-page-editor-panel">{mode === "list" ? <div className="cs-empty-state cs-page-empty"><strong>Select a form</strong><span>Choose an existing form or create a new safe draft.</span></div> : <form onSubmit={save}><div className="cs-editor-heading"><div><span className="cs-eyebrow">{mode === "create" ? "New draft" : `Form #${selectedId}`}</span><h3>{form.name || "Untitled form"}</h3></div>{selectedVersion ? <span className={`cs-status-chip cs-status-${contentStudioStatusTone(selectedVersion.version_status)}`}>{statusLabel(selectedVersion.version_status)}</span> : null}</div>{details?.versions?.length ? <Field label="Version history"><select value={selectedVersionId || ""} onChange={(event) => chooseVersion(event.target.value)}>{details.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number} — {statusLabel(version.version_status)}</option>)}</select></Field> : null}<div className="cs-form-grid"><Field label="Internal form key"><input value={form.form_key} onChange={(event) => updateField("form_key", event.target.value)} disabled={mode !== "create" || !canManage} required /></Field><Field label="Public slug"><input value={form.slug} onChange={(event) => updateField("slug", event.target.value)} disabled={!editable || !canManage} required /></Field><Field label="Form name"><input value={form.name} onChange={(event) => updateField("name", event.target.value)} disabled={!editable || !canManage} required /></Field><Field label="Form type"><select value={form.form_type} onChange={(event) => updateField("form_type", event.target.value)} disabled={!editable || !canManage}>{FORM_TYPES.map((type) => <option key={type} value={type}>{statusLabel(type)}</option>)}</select></Field></div><Field label="Description"><textarea rows="3" value={form.description} onChange={(event) => updateField("description", event.target.value)} disabled={!editable || !canManage} /></Field><Field label="Confirmation message"><textarea rows="3" value={form.confirmation_message} onChange={(event) => updateField("confirmation_message", event.target.value)} disabled={!editable || !canManage} /></Field><div className="cs-form-grid"><Field label="Submit button label"><input value={form.submit_label} onChange={(event) => updateField("submit_label", event.target.value)} disabled={!editable || !canManage} /></Field><Field label="Consent text version"><input value={form.consent_text_version} onChange={(event) => updateField("consent_text_version", event.target.value)} disabled={!editable || !canManage} /></Field></div><div className="cs-checkbox-grid"><label><input type="checkbox" checked={form.require_contact} onChange={(event) => updateField("require_contact", event.target.checked)} disabled={!editable || !canManage} /> Require contact information</label><label><input type="checkbox" checked={form.require_consent} onChange={(event) => updateField("require_consent", event.target.checked)} disabled={!editable || !canManage} /> Require consent</label></div><div className="cs-editor-section-heading"><div><span className="cs-eyebrow">No-code fields</span><h4>{form.fields.length}/60 fields</h4></div>{editable && canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={addBuilderField}>Add field</button> : null}</div><div className="cs-form-builder-list">{form.fields.map((field, index) => <article className="cs-form-field-card" key={`${field.field_key}-${index}`}><div className="cs-section-editor-heading"><strong>Field {index + 1}</strong>{editable && canManage ? <div><button type="button" onClick={() => moveField(index, -1)} disabled={index === 0}>Up</button><button type="button" onClick={() => moveField(index, 1)} disabled={index === form.fields.length - 1}>Down</button><button type="button" onClick={() => removeBuilderField(index)}>Remove</button></div> : null}</div><div className="cs-form-grid"><Field label="Field key"><input value={field.field_key} onChange={(event) => updateBuilderField(index, "field_key", event.target.value)} disabled={!editable || !canManage} required /></Field><Field label="Field type"><select value={field.field_type} onChange={(event) => updateBuilderField(index, "field_type", event.target.value)} disabled={!editable || !canManage}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{statusLabel(type)}</option>)}</select></Field><Field label="Label"><input value={field.label} onChange={(event) => updateBuilderField(index, "label", event.target.value)} disabled={!editable || !canManage} required /></Field><Field label="Placeholder"><input value={field.placeholder} onChange={(event) => updateBuilderField(index, "placeholder", event.target.value)} disabled={!editable || !canManage} /></Field></div><Field label="Help text"><input value={field.help_text} onChange={(event) => updateBuilderField(index, "help_text", event.target.value)} disabled={!editable || !canManage} /></Field>{OPTION_TYPES.has(field.field_type) ? <Field label="Options" hint="One unique option per line; maximum 100."><textarea rows="4" value={field.options_text} onChange={(event) => updateBuilderField(index, "options_text", event.target.value)} disabled={!editable || !canManage} required /></Field> : null}<div className="cs-form-grid">{["text", "textarea", "email", "tel"].includes(field.field_type) ? <Field label="Maximum length"><input type="number" min="1" max="5000" value={field.max_length} onChange={(event) => updateBuilderField(index, "max_length", event.target.value)} disabled={!editable || !canManage} /></Field> : null}{field.field_type === "number" ? <><Field label="Minimum"><input type="number" value={field.minimum} onChange={(event) => updateBuilderField(index, "minimum", event.target.value)} disabled={!editable || !canManage} /></Field><Field label="Maximum"><input type="number" value={field.maximum} onChange={(event) => updateBuilderField(index, "maximum", event.target.value)} disabled={!editable || !canManage} /></Field></> : null}</div><label className="cs-inline-check"><input type="checkbox" checked={field.is_required} onChange={(event) => updateBuilderField(index, "is_required", event.target.checked)} disabled={!editable || !canManage} /> Required field</label></article>)}</div><Field label="Change summary"><input value={form.change_summary} onChange={(event) => updateField("change_summary", event.target.value)} disabled={!editable || !canManage} placeholder="Explain what changed" /></Field><div className="cs-editor-actions">{editable && canManage ? <button className="cs-button cs-button-primary" disabled={saving}>Save draft</button> : null}{mode === "edit" && selectedVersion?.version_status !== "draft" && canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={newVersion}>Create new draft</button> : null}{mode === "edit" && selectedVersion?.version_status === "draft" && canSubmit ? <button className="cs-button cs-button-warning" type="button" onClick={submitReview}>Submit for review</button> : null}{mode === "edit" && selectedVersion?.version_status === "in_review" && pendingApproval && canApprove ? <><button className="cs-button cs-button-success" type="button" onClick={() => decide("approved")}>Approve</button><button className="cs-button cs-button-danger" type="button" onClick={() => decide("rejected")}>Reject</button></> : null}{mode === "edit" && selectedVersion?.version_status === "approved" && approvedApproval && canPublish ? <button className="cs-button cs-button-success" type="button" onClick={publish}>Publish now</button> : null}{mode === "edit" && selectedVersion?.version_status !== "draft" && canRestore ? <button className="cs-button cs-button-secondary" type="button" onClick={restore}>Restore as draft</button> : null}{mode === "edit" && canArchive ? <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={archive}>Archive form</button> : null}</div>{mode === "edit" ? <div className="cs-review-box"><div className="cs-form-grid"><Field label="Reviewer user ID"><input inputMode="numeric" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></Field><Field label="Review or action note"><input value={actionNote} onChange={(event) => setActionNote(event.target.value)} /></Field></div></div> : null}</form>}</section>
      </div>
    </div>
  );
}
