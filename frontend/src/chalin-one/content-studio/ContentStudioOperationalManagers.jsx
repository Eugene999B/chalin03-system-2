import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  archiveNavigation,
  assignSubmission,
  changeSubmissionStatus,
  createNavigation,
  createNavigationVersion,
  createSetting,
  deactivateSetting,
  decideApproval,
  decideNavigationApproval,
  getSubmission,
  listAllApprovals,
  listNavigation,
  listSettings,
  listSubmissions,
  publishNavigationVersion,
  reviewSubmission,
  submitNavigationVersion,
  updateNavigationDraft,
  updateSetting,
} from "./contentStudioOperationsApi";
import {
  CONTENT_STUDIO_PERMISSIONS,
  contentStudioStatusTone,
} from "./contentStudioModel";
import "./contentStudioOperationalManagers.css";

const SUBMISSION_STATUSES = Object.freeze([
  "new",
  "in_review",
  "awaiting_customer",
  "resolved",
  "rejected",
  "spam",
  "archived",
]);
const NAV_LOCATIONS = Object.freeze(["header", "footer", "mobile", "utility"]);
const PUBLIC_SETTING_KEYS = Object.freeze([
  "site.name",
  "site.tagline",
  "site.description",
  "site.logo",
  "site.favicon",
  "site.contact",
  "site.social_links",
  "site.brand",
  "site.seo",
  "site.footer",
  "site.legal",
  "site.emergency_banner",
  "site.analytics_public",
  "company.registration",
  "company.certifications",
  "company.safety_commitment",
  "company.quality_commitment",
]);

function Field({ label, hint, children }) {
  return <label className="cs-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Notice({ error, message, clear, title = "Content Studio updated" }) {
  const value = error || message;
  if (!value) return null;
  return <div className={`cs-alert ${error ? "cs-alert-danger" : "cs-alert-success"}`} role={error ? "alert" : "status"}><div><strong>{error ? "Action not completed" : title}</strong><span>{value}</span></div><button type="button" onClick={clear}>Close</button></div>;
}

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function statusLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function StatusChip({ status }) {
  return <span className={`cs-status-chip cs-status-${contentStudioStatusTone(status)}`}>{statusLabel(status)}</span>;
}

function displayDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GH");
}

function readableValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function ContentStudioEnquiryDesk() {
  const auth = useAuth();
  const canRespond = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submissionsRespond);
  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submissionsManage);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const [nextStatus, setNextStatus] = useState("in_review");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadItems = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listSubmissions({ search, status, mine: mine ? "true" : "", limit: 100, offset: 0 }, { signal });
      if (!signal?.aborted) {
        setItems(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [mine, search, status]);

  const loadDetails = useCallback(async (submissionId, { signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const next = await getSubmission(submissionId, { signal });
      if (!signal?.aborted) {
        setSelectedId(Number(submissionId));
        setDetails(next);
        setAssigneeId(next?.submission?.assigned_to || "");
        setNextStatus(next?.submission?.submission_status === "new" ? "in_review" : next?.submission?.submission_status || "in_review");
      }
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

  async function run(action, message) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await action();
      setDetails(next);
      setNotice(message);
      setNote("");
      await loadItems();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const submission = details?.submission || null;
  const responses = submission?.response_json && typeof submission.response_json === "object" ? submission.response_json : {};

  return <div className="cs-operational-manager"><section className="cs-module-hero"><div className="cs-badge cs-badge-orange" aria-hidden="true">ED</div><div><span className="cs-eyebrow">Engagement</span><h2>Enquiry Desk</h2><p>Review private website enquiries, assign owners, record responses and move cases through controlled statuses without exposing raw IP or storage keys.</p></div></section><Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} title="Enquiry updated" /><div className="cs-page-layout"><aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Inbox</span><h3>{total.toLocaleString("en-GH")} enquiries</h3></div></div><div className="cs-filter-stack"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, name, email or phone" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{SUBMISSION_STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select><label className="cs-inline-check"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Assigned to me</label></div><div className="cs-page-list" aria-busy={loading ? "true" : "false"}>{items.map((item) => <button type="button" key={item.id} className={Number(selectedId) === Number(item.id) ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => loadDetails(item.id)}><span><strong>{item.full_name || item.company_name || item.reference_code}</strong><small>{item.form_name} · {item.reference_code}</small></span><StatusChip status={item.submission_status} /></button>)}</div></aside><section className="cs-panel cs-page-editor-panel">{!submission ? <div className="cs-empty-state cs-page-empty"><strong>Select an enquiry</strong><span>Review contact details, responses, files and history.</span></div> : <><div className="cs-editor-heading"><div><span className="cs-eyebrow">{submission.reference_code}</span><h3>{submission.full_name || submission.company_name || "Website enquiry"}</h3></div><StatusChip status={submission.submission_status} /></div><div className="cs-contact-grid"><div><span>Email</span><strong>{submission.email || "—"}</strong></div><div><span>Phone</span><strong>{submission.phone || "—"}</strong></div><div><span>Company</span><strong>{submission.company_name || "—"}</strong></div><div><span>Received</span><strong>{displayDate(submission.created_at)}</strong></div><div><span>Form</span><strong>{submission.form_name}</strong></div><div><span>Assigned to</span><strong>{submission.assigned_to_name || "Unassigned"}</strong></div></div><div className="cs-ops-columns"><section className="cs-response-box"><h4>Submitted responses</h4>{Object.entries(responses).length ? Object.entries(responses).map(([key, value]) => <div key={key}><span>{statusLabel(key)}</span><pre>{readableValue(value)}</pre></div>) : <p>No custom responses recorded.</p>}</section><section className="cs-response-box"><h4>Private files</h4>{details?.files?.length ? details.files.map((file) => <div key={file.id}><span>{file.original_filename}</span><strong>{file.security_status}</strong><small>{file.mime_type} · {Number(file.file_size_bytes || 0).toLocaleString("en-GH")} bytes</small></div>) : <p>No files attached.</p>}</section></div>{canManage ? <div className="cs-review-box"><div className="cs-form-grid"><Field label="Assign staff user ID"><input inputMode="numeric" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} /></Field><div className="cs-field cs-field-action"><span>Assignment</span><button className="cs-button cs-button-primary" type="button" disabled={saving || !cleanId(assigneeId)} onClick={() => run(() => assignSubmission(selectedId, assigneeId), "The enquiry was assigned safely.")}>Assign enquiry</button></div></div></div> : null}{canRespond || canManage ? <div className="cs-review-box"><div className="cs-form-grid"><Field label="Next status"><select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{SUBMISSION_STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></Field><Field label="Review or status note"><textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} /></Field></div><div className="cs-editor-actions">{canRespond ? <button className="cs-button cs-button-primary" type="button" disabled={saving || !note.trim()} onClick={() => run(() => reviewSubmission(selectedId, note, nextStatus), "The review note and status were recorded.")}>Record review</button> : null}{canManage ? <button className="cs-button cs-button-secondary" type="button" disabled={saving} onClick={() => run(() => changeSubmissionStatus(selectedId, nextStatus, note), "The enquiry status was updated.")}>Change status</button> : null}</div></div> : null}<section className="cs-history-list"><h4>Audit history</h4>{details?.history?.length ? details.history.map((entry) => <div key={entry.id}><strong>{statusLabel(entry.action_key)}</strong><span>{displayDate(entry.created_at)}</span></div>) : <p>No audit entries available.</p>}</section></>}</section></div></div>;
}

function approvalTitle(approval) {
  const snapshot = approval.snapshot || {};
  return snapshot.title || snapshot.name || snapshot.full_name || snapshot.label || snapshot.question || snapshot.navigation_key || approval.label || approval.entity_type || `Approval #${approval.id}`;
}

export function ContentStudioApprovalInbox() {
  const auth = useAuth();
  const canApprove = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.approve);
  const [items, setItems] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listAllApprovals({ mine: mine ? "true" : "", limit: 100, offset: 0 }, { signal });
      if (!signal?.aborted) {
        const sorted = [...(result.items || [])].sort((a, b) => new Date(a.requested_at || 0) - new Date(b.requested_at || 0));
        setItems(sorted);
        setUnavailable(result.unavailable_sources || []);
        if (selected && !sorted.some((item) => item.approval_source === selected.approval_source && Number(item.id) === Number(selected.id))) setSelected(null);
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [mine, selected]);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  async function decide(decision) {
    if (!selected) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await decideApproval(selected, decision, note);
      setNotice(decision === "approved" ? "The exact saved version was approved." : "The exact saved version was rejected and returned to its manager.");
      setSelected(null);
      setNote("");
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return <div className="cs-operational-manager"><section className="cs-module-hero"><div className="cs-badge cs-badge-orange" aria-hidden="true">AI</div><div><span className="cs-eyebrow">Governance</span><h2>Approval Inbox</h2><p>Review exact saved versions from Pages, Portfolio, Newsroom, Company Information, Forms and Navigation in one protected queue.</p></div></section><Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} title="Approval recorded" />{unavailable.length ? <div className="cs-alert cs-alert-danger"><div><strong>Partial approval queue</strong><span>Unavailable sources: {unavailable.join(", ")}</span></div></div> : null}<div className="cs-page-layout"><aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Pending reviews</span><h3>{items.length} approvals</h3></div></div><label className="cs-inline-check"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Assigned to me</label><div className="cs-page-list" aria-busy={loading ? "true" : "false"}>{items.map((item) => <button type="button" key={`${item.approval_source}-${item.id}`} className={selected?.approval_source === item.approval_source && Number(selected?.id) === Number(item.id) ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => setSelected(item)}><span><strong>{approvalTitle(item)}</strong><small>{statusLabel(item.approval_source)} · version {item.version_number || "?"}</small></span><StatusChip status="pending" /></button>)}</div></aside><section className="cs-panel cs-page-editor-panel">{!selected ? <div className="cs-empty-state cs-page-empty"><strong>Select an approval</strong><span>Inspect the exact snapshot before approving or rejecting it.</span></div> : <><div className="cs-editor-heading"><div><span className="cs-eyebrow">{statusLabel(selected.approval_source)} approval #{selected.id}</span><h3>{approvalTitle(selected)}</h3></div><StatusChip status={selected.approval_status} /></div><div className="cs-contact-grid"><div><span>Entity type</span><strong>{selected.entity_type}</strong></div><div><span>Version</span><strong>{selected.version_number || "—"}</strong></div><div><span>Requested by</span><strong>{selected.requested_by_name || selected.requested_by || "—"}</strong></div><div><span>Assigned to</span><strong>{selected.assigned_to_name || selected.assigned_to || "Open queue"}</strong></div><div><span>Requested</span><strong>{displayDate(selected.requested_at)}</strong></div><div><span>Change summary</span><strong>{selected.change_summary || "—"}</strong></div></div><Field label="Submitter note"><textarea rows="3" value={selected.request_note || ""} readOnly /></Field><section className="cs-snapshot-box"><h4>Exact saved snapshot</h4><pre>{JSON.stringify(selected.snapshot || {}, null, 2)}</pre></section>{canApprove ? <div className="cs-review-box"><Field label="Decision note"><textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the reason for approval or rejection" /></Field><div className="cs-editor-actions"><button className="cs-button cs-button-success" type="button" onClick={() => decide("approved")} disabled={loading}>Approve exact version</button><button className="cs-button cs-button-danger" type="button" onClick={() => decide("rejected")} disabled={loading}>Reject version</button></div></div> : null}</>}</section></div></div>;
}

const EMPTY_NAV = Object.freeze({
  navigation_key: "",
  parent_id: "",
  page_id: "",
  navigation_location: "header",
  label: "",
  url: "",
  icon_key: "",
  sort_order: 0,
  opens_new_tab: false,
  change_summary: "",
});

export function ContentStudioNavigationManager() {
  const auth = useAuth();
  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.navigationManage);
  const canSubmit = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.submit);
  const canApprove = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.approve);
  const canPublish = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.publish);
  const [items, setItems] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_NAV });
  const [mode, setMode] = useState("list");
  const [reviewerId, setReviewerId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => items.find((item) => Number(item.id) === Number(selectedId)) || null, [items, selectedId]);
  const latestVersionId = selected?.latest_version_id || null;
  const latestStatus = selected?.latest_version_status || selected?.publication_status || "draft";
  const pendingApproval = approvals.find((approval) => Number(approval.entity_id) === Number(selectedId) && Number(approval.content_version_id) === Number(latestVersionId)) || null;

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const [nav, approvalResult] = await Promise.all([
        listNavigation({ signal }),
        listAllApprovals({ limit: 100, offset: 0 }, { signal }),
      ]);
      if (!signal?.aborted) {
        setItems(Array.isArray(nav) ? nav : []);
        setApprovals((approvalResult.items || []).filter((item) => item.approval_source === "navigation"));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  function choose(item) {
    const snapshot = item.latest_snapshot || item;
    setSelectedId(item.id);
    setForm({
      navigation_key: snapshot.navigation_key || item.navigation_key || "",
      parent_id: snapshot.parent_id || "",
      page_id: snapshot.page_id || "",
      navigation_location: snapshot.navigation_location || item.navigation_location || "header",
      label: snapshot.label || item.label || "",
      url: snapshot.url || "",
      icon_key: snapshot.icon_key || "",
      sort_order: Number(snapshot.sort_order || 0),
      opens_new_tab: snapshot.opens_new_tab === true || Number(snapshot.opens_new_tab) === 1,
      change_summary: item.latest_change_summary || "",
    });
    setMode("edit");
  }

  function beginCreate() {
    setSelectedId(null);
    setForm({ ...EMPTY_NAV });
    setMode("create");
  }

  async function run(action, message) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (Array.isArray(result)) setItems(result);
      setNotice(message);
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  const payload = {
    ...form,
    parent_id: cleanId(form.parent_id),
    page_id: cleanId(form.page_id),
    sort_order: Number(form.sort_order) || 0,
  };
  const editable = mode === "create" || latestStatus === "draft";

  return <div className="cs-operational-manager"><section className="cs-module-hero"><div className="cs-badge cs-badge-slate" aria-hidden="true">NV</div><div><span className="cs-eyebrow">Website</span><h2>Navigation</h2><p>Build header, footer, mobile and utility menus with safe targets, hierarchy protection and exact-version approval.</p></div>{canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={beginCreate}>New menu item</button> : null}</section><Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} title="Navigation updated" /><div className="cs-page-layout"><aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Menu structure</span><h3>{items.length} items</h3></div></div><div className="cs-page-list" aria-busy={loading ? "true" : "false"}>{items.map((item) => <button type="button" key={item.id} className={Number(selectedId) === Number(item.id) ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => choose(item)}><span><strong>{item.label}</strong><small>{item.navigation_location} · {item.parent_key ? `under ${item.parent_key}` : "top level"}</small></span><StatusChip status={item.latest_version_status || item.publication_status} /></button>)}</div></aside><section className="cs-panel cs-page-editor-panel">{mode === "list" ? <div className="cs-empty-state cs-page-empty"><strong>Select a menu item</strong><span>Edit the latest draft or create a new controlled version.</span></div> : <form onSubmit={(event) => { event.preventDefault(); run(() => mode === "create" ? createNavigation(payload) : updateNavigationDraft(selectedId, latestVersionId, payload), mode === "create" ? "Navigation draft created." : "Navigation draft updated."); }}><div className="cs-editor-heading"><div><span className="cs-eyebrow">{mode === "create" ? "New draft" : `Menu item #${selectedId}`}</span><h3>{form.label || "Untitled item"}</h3></div>{mode === "edit" ? <StatusChip status={latestStatus} /> : null}</div><div className="cs-form-grid"><Field label="Internal navigation key"><input value={form.navigation_key} onChange={(event) => setForm((current) => ({ ...current, navigation_key: event.target.value }))} disabled={mode !== "create" || !canManage} required /></Field><Field label="Menu location"><select value={form.navigation_location} onChange={(event) => setForm((current) => ({ ...current, navigation_location: event.target.value }))} disabled={!editable || !canManage}>{NAV_LOCATIONS.map((location) => <option key={location} value={location}>{location}</option>)}</select></Field><Field label="Label"><input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} disabled={!editable || !canManage} required /></Field><Field label="Display order"><input type="number" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} disabled={!editable || !canManage} /></Field><Field label="Parent item ID"><input inputMode="numeric" value={form.parent_id} onChange={(event) => setForm((current) => ({ ...current, parent_id: event.target.value }))} disabled={!editable || !canManage} /></Field><Field label="Website page ID"><input inputMode="numeric" value={form.page_id} onChange={(event) => setForm((current) => ({ ...current, page_id: event.target.value }))} disabled={!editable || !canManage} /></Field><Field label="Direct URL" hint="Relative, HTTP, HTTPS, mailto or tel link."><input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} disabled={!editable || !canManage} /></Field><Field label="Icon key"><input value={form.icon_key} onChange={(event) => setForm((current) => ({ ...current, icon_key: event.target.value }))} disabled={!editable || !canManage} /></Field></div><label className="cs-inline-check"><input type="checkbox" checked={form.opens_new_tab} onChange={(event) => setForm((current) => ({ ...current, opens_new_tab: event.target.checked }))} disabled={!editable || !canManage} /> Open in a new tab</label><Field label="Change summary"><input value={form.change_summary} onChange={(event) => setForm((current) => ({ ...current, change_summary: event.target.value }))} disabled={!editable || !canManage} /></Field><div className="cs-editor-actions">{editable && canManage ? <button className="cs-button cs-button-primary" disabled={loading}>Save draft</button> : null}{mode === "edit" && latestStatus !== "draft" && canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={() => run(() => createNavigationVersion(selectedId, { change_summary: "New editable navigation version" }), "A new navigation draft version was created.")}>Create new draft</button> : null}{mode === "edit" && latestStatus === "draft" && canSubmit ? <button className="cs-button cs-button-warning" type="button" onClick={() => run(() => submitNavigationVersion(selectedId, latestVersionId, { assigned_to: cleanId(reviewerId), note }), "The exact navigation version was submitted for review.")}>Submit for review</button> : null}{mode === "edit" && latestStatus === "in_review" && pendingApproval && canApprove ? <><button className="cs-button cs-button-success" type="button" onClick={() => run(() => decideNavigationApproval(pendingApproval.id, { decision: "approved", note }), "The navigation version was approved.")}>Approve</button><button className="cs-button cs-button-danger" type="button" onClick={() => run(() => decideNavigationApproval(pendingApproval.id, { decision: "rejected", note }), "The navigation version was rejected.")}>Reject</button></> : null}{mode === "edit" && latestStatus === "approved" && canPublish ? <button className="cs-button cs-button-success" type="button" onClick={() => run(() => publishNavigationVersion(selectedId, latestVersionId), "The approved navigation version is now live.")}>Publish</button> : null}{mode === "edit" && canManage ? <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={() => { if (window.confirm("Archive this menu item? Active children will block unsafe archival.")) run(() => archiveNavigation(selectedId, note), "The menu item was archived safely."); }}>Archive</button> : null}</div>{mode === "edit" ? <div className="cs-review-box"><div className="cs-form-grid"><Field label="Reviewer user ID"><input inputMode="numeric" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></Field><Field label="Review or action note"><input value={note} onChange={(event) => setNote(event.target.value)} /></Field></div></div> : null}</form>}</section></div></div>;
}

const EMPTY_SETTING = Object.freeze({ setting_key: "", setting_group: "general", value_text: "", description: "", is_public: false, is_active: true });

export function ContentStudioSettingsManager() {
  const auth = useAuth();
  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.settingsManage);
  const [items, setItems] = useState([]);
  const [group, setGroup] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_SETTING });
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const groups = useMemo(() => [...new Set(items.map((item) => item.setting_group).filter(Boolean))].sort(), [items]);
  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listSettings({ group, public_only: publicOnly ? "true" : "" }, { signal });
      if (!signal?.aborted) setItems(Array.isArray(result) ? result : []);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [group, publicOnly]);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  function choose(item) {
    setSelectedId(item.id);
    setForm({
      setting_key: item.setting_key,
      setting_group: item.setting_group,
      value_text: JSON.stringify(item.value, null, 2),
      description: item.description || "",
      is_public: item.is_public === true,
      is_active: item.is_active === true,
    });
    setMode("edit");
  }

  function beginCreate() {
    setSelectedId(null);
    setForm({ ...EMPTY_SETTING });
    setMode("create");
  }

  async function save(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      let value;
      try {
        value = form.value_text.trim() ? JSON.parse(form.value_text) : null;
      } catch {
        throw new Error("Setting value must be valid JSON.");
      }
      const payload = { setting_key: form.setting_key, setting_group: form.setting_group, value, description: form.description, is_public: form.is_public, is_active: form.is_active };
      const result = mode === "create" ? await createSetting(payload) : await updateSetting(selectedId, payload);
      setNotice("The website setting was saved safely.");
      if (result) choose(result);
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function deactivate() {
    if (!selectedId || !window.confirm("Deactivate this website setting?")) return;
    setLoading(true);
    try {
      await deactivateSetting(selectedId, "Deactivated from Content Studio");
      setNotice("The website setting was deactivated.");
      setMode("list");
      setSelectedId(null);
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return <div className="cs-operational-manager"><section className="cs-module-hero"><div className="cs-badge cs-badge-slate" aria-hidden="true">WS</div><div><span className="cs-eyebrow">Website</span><h2>Website Settings</h2><p>Manage approved branding, contact, legal, safety and SEO configuration while sensitive keys remain blocked from public exposure.</p></div>{canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={beginCreate}>New setting</button> : null}</section><Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} title="Website setting updated" /><div className="cs-page-layout"><aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Configuration</span><h3>{items.length} settings</h3></div></div><div className="cs-filter-stack"><select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">All groups</option>{groups.map((item) => <option key={item} value={item}>{item}</option>)}</select><label className="cs-inline-check"><input type="checkbox" checked={publicOnly} onChange={(event) => setPublicOnly(event.target.checked)} /> Public settings only</label></div><div className="cs-page-list" aria-busy={loading ? "true" : "false"}>{items.map((item) => <button type="button" key={item.id} className={Number(selectedId) === Number(item.id) ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => choose(item)}><span><strong>{item.setting_key}</strong><small>{item.setting_group}</small></span><span className={`cs-status-chip cs-status-${item.is_active ? item.is_public ? "success" : "neutral" : "danger"}`}>{item.is_active ? item.is_public ? "public" : "private" : "inactive"}</span></button>)}</div></aside><section className="cs-panel cs-page-editor-panel">{mode === "list" ? <div className="cs-empty-state cs-page-empty"><strong>Select a setting</strong><span>Review an existing value or create an approved configuration key.</span></div> : <form onSubmit={save}><div className="cs-editor-heading"><div><span className="cs-eyebrow">{mode === "create" ? "New setting" : `Setting #${selectedId}`}</span><h3>{form.setting_key || "Untitled setting"}</h3></div></div><div className="cs-form-grid"><Field label="Setting key" hint={form.is_public ? "Public keys must use the approved allowlist." : "Private keys still cannot contain sensitive secret fragments."}>{form.is_public ? <select value={form.setting_key} onChange={(event) => setForm((current) => ({ ...current, setting_key: event.target.value }))} disabled={!canManage} required><option value="">Choose approved public key</option>{PUBLIC_SETTING_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}</select> : <input value={form.setting_key} onChange={(event) => setForm((current) => ({ ...current, setting_key: event.target.value }))} disabled={!canManage} required />}</Field><Field label="Setting group"><input value={form.setting_group} onChange={(event) => setForm((current) => ({ ...current, setting_group: event.target.value }))} disabled={!canManage} required /></Field></div><Field label="Description"><textarea rows="3" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={!canManage} /></Field><Field label="JSON value" hint="Use JSON strings, numbers, booleans, arrays, objects or null."><textarea className="cs-code-input" rows="14" value={form.value_text} onChange={(event) => setForm((current) => ({ ...current, value_text: event.target.value }))} disabled={!canManage} required /></Field><div className="cs-checkbox-grid"><label><input type="checkbox" checked={form.is_public} onChange={(event) => setForm((current) => ({ ...current, is_public: event.target.checked, setting_key: event.target.checked && !PUBLIC_SETTING_KEYS.includes(current.setting_key) ? "" : current.setting_key }))} disabled={!canManage} /> Expose through approved public API</label><label><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} disabled={!canManage} /> Active</label></div>{canManage ? <div className="cs-editor-actions"><button className="cs-button cs-button-primary" disabled={loading}>Save setting</button>{mode === "edit" ? <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={deactivate} disabled={loading}>Deactivate</button> : null}</div> : null}</form>}</section></div></div>;
}
