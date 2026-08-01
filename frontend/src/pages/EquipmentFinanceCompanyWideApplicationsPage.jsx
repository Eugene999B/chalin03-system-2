import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/credit-applications";
const FINAL_STATUSES = new Set(["approved", "declined", "withdrawn"]);
const REVIEW_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Pill({ value }) {
  const normalized = String(value || "");
  const danger = ["declined", "rejected", "ineligible", "critical", "overdue"].includes(normalized);
  const warning = [
    "draft",
    "submitted",
    "under_review",
    "manual_review",
    "not_assessed",
    "high",
    "changes_requested",
    "incomplete",
  ].includes(normalized);
  return (
    <span className={`finance-simple__pill ${danger ? "is-danger" : warning ? "is-warning" : "is-good"}`}>
      {label(value)}
    </span>
  );
}

function Field({ title, hint = "", wide = false, children }) {
  return (
    <label className={`finance-simple__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function numberText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function detailToEdit(detail) {
  const application = detail?.application || {};
  const kyc = detail?.kyc || {};
  return {
    kyc: {
      customer_name_snapshot: kyc.customer_name_snapshot || application.customer_name || "",
      customer_phone_snapshot: kyc.customer_phone_snapshot || application.customer_phone || "",
      customer_email_snapshot: kyc.customer_email_snapshot || application.customer_email || "",
      customer_address_snapshot: kyc.customer_address_snapshot || application.customer_address || "",
      id_type: kyc.id_type || "Ghana Card",
      id_number: kyc.id_number || "",
      date_of_birth: String(kyc.date_of_birth || "").slice(0, 10),
      nationality: kyc.nationality || "Ghana",
      employment_type: kyc.employment_type || "",
      occupation: kyc.occupation || "",
      employer_business_name: kyc.employer_business_name || "",
      business_registration_number: kyc.business_registration_number || "",
      residential_address: kyc.residential_address || "",
      work_address: kyc.work_address || "",
      years_at_residence: numberText(kyc.years_at_residence),
      years_in_employment_business: numberText(kyc.years_in_employment_business),
      emergency_contact_name: kyc.emergency_contact_name || "",
      emergency_contact_phone: kyc.emergency_contact_phone || "",
      emergency_contact_relationship: kyc.emergency_contact_relationship || "",
      guarantor_name: kyc.guarantor_name || "",
      guarantor_phone: kyc.guarantor_phone || "",
      guarantor_address: kyc.guarantor_address || "",
      guarantor_id_type: kyc.guarantor_id_type || "Ghana Card",
      guarantor_id_number: kyc.guarantor_id_number || "",
      guarantor_relationship: kyc.guarantor_relationship || "",
      customer_consent_confirmed: Boolean(kyc.customer_consent_confirmed),
      credit_assessment_consent_confirmed: Boolean(
        kyc.credit_assessment_consent_confirmed
      ),
    },
    affordability: {
      monthly_salary_income: numberText(application.monthly_salary_income),
      monthly_business_income: numberText(application.monthly_business_income),
      monthly_other_income: numberText(application.monthly_other_income),
      monthly_business_costs: numberText(application.monthly_business_costs),
      monthly_household_expenses: numberText(application.monthly_household_expenses),
      existing_monthly_debt: numberText(application.existing_monthly_debt),
      assessment_notes: application.assessment_notes || "",
    },
  };
}

function scheduleInterval(detail) {
  const schedule = detail?.exact_schedule;
  if (!schedule) return "Not calculated";
  if (schedule.payment_frequency === "custom") {
    return `Every ${schedule.custom_interval_days} days`;
  }
  if (schedule.payment_frequency === "weekly") return "Every 7 days";
  if (schedule.payment_frequency === "fortnightly") return "Every 14 days";
  return "Monthly";
}

function ApplicationDialog({ detail, onClose, onEdit, canEdit }) {
  const application = detail.application || {};
  const kyc = detail.kyc || {};
  const schedule = detail.exact_schedule;
  return (
    <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="finance-simple__dialog finance-simple__dialog--wide" role="dialog" aria-modal="true" aria-label="Complete Finance application file" onMouseDown={(event) => event.stopPropagation()}>
        <div className="finance-simple__section-header">
          <div>
            <p className="finance-simple__eyebrow">Complete application file</p>
            <h2>{application.application_number}</h2>
            <span className="finance-simple__muted">
              {application.customer_name} · {application.asset_code} {application.asset_name}
            </span>
          </div>
          <div className="finance-simple__actions">
            {canEdit ? <button type="button" onClick={onEdit}>Edit draft</button> : null}
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="finance-simple__summary">
          <article><span>Status</span><strong><Pill value={application.application_status} /></strong></article>
          <article><span>KYC</span><strong><Pill value={application.kyc_status} /></strong></article>
          <article><span>Affordability</span><strong><Pill value={application.affordability_status} /></strong></article>
          <article><span>Risk</span><strong><Pill value={application.risk_band} /></strong></article>
          <article><span>Installment Offer</span><strong>{application.quotation_number}</strong></article>
          <article><span>Financed</span><strong>{money(application.financed_amount)}</strong></article>
        </div>

        <section className="finance-simple__section">
          <div className="finance-simple__section-header">
            <div><p className="finance-simple__eyebrow">Readiness</p><h3>{detail.completeness?.complete_count || 0} of {detail.completeness?.total_count || 0} checks complete</h3></div>
            <Pill value={detail.completeness?.ready_for_submission ? "complete" : "incomplete"} />
          </div>
          <div className="finance-simple__checks finance-simple__checks--cards">
            {(detail.completeness?.checks || []).map((check) => (
              <span className={check.complete ? "is-complete" : "is-missing"} key={check.code}>
                {check.complete ? "✓" : "○"} {check.label}
              </span>
            ))}
          </div>
        </section>

        <section className="finance-simple__section">
          <p className="finance-simple__eyebrow">Customer and affordability</p>
          <div className="finance-simple__facts">
            <div><span>ID</span><strong>{kyc.id_type || "—"} {kyc.id_number || ""}</strong></div>
            <div><span>Employment</span><strong>{label(kyc.employment_type)}</strong><small>{kyc.occupation || "No occupation recorded"}</small></div>
            <div><span>Address</span><strong>{kyc.residential_address || kyc.customer_address_snapshot || "Not recorded"}</strong></div>
            <div><span>Guarantor</span><strong>{kyc.guarantor_name || "Not recorded"}</strong><small>{kyc.guarantor_phone || ""}</small></div>
            <div><span>Salary income</span><strong>{money(application.monthly_salary_income)}</strong></div>
            <div><span>Business income</span><strong>{money(application.monthly_business_income)}</strong></div>
            <div><span>Other income</span><strong>{money(application.monthly_other_income)}</strong></div>
            <div><span>Total commitments</span><strong>{money(application.total_monthly_commitments)}</strong></div>
            <div><span>Monthly surplus</span><strong>{money(application.net_monthly_surplus)}</strong></div>
            <div><span>Debt-service ratio</span><strong>{Number(application.debt_service_ratio_percent || 0).toFixed(2)}%</strong></div>
          </div>
          <div className="finance-simple__notice is-info">
            <strong>{application.assessment_recommendation || "Assessment not completed"}</strong>
            {application.assessment_notes ? <p>{application.assessment_notes}</p> : null}
          </div>
        </section>

        <section className="finance-simple__section">
          <div className="finance-simple__section-header">
            <div><p className="finance-simple__eyebrow">Exact approved schedule</p><h3>{schedule?.schedule?.length || 0} payment date(s)</h3><span className="finance-simple__muted">{scheduleInterval(detail)} · {dateLabel(schedule?.first_due_date)} → {dateLabel(schedule?.final_due_date)}</span></div>
            <strong>{money(schedule?.periodic_amount)}</strong>
          </div>
          {schedule?.schedule?.length ? (
            <details>
              <summary>Show all exact dates</summary>
              <div className="finance-simple__schedule-list">
                {schedule.schedule.map((row) => (
                  <article key={`${row.sequence_number}-${row.due_date}`}>
                    <span>Payment {row.sequence_number}</span>
                    <strong>{dateLabel(row.due_date)}</strong>
                    <b>{money(row.scheduled_amount)}</b>
                  </article>
                ))}
              </div>
            </details>
          ) : <div className="finance-simple__notice is-warning">The exact schedule could not be calculated. Correct the payment terms before submission.</div>}
        </section>

        <section className="finance-simple__section">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Protected documents</p><h3>{detail.documents?.length || 0} current document(s)</h3></div><Link to="/equipment-installment-finance/applications?stage=operations&tab=case">Manage secure documents</Link></div>
          <div className="finance-simple__cards">
            {(detail.documents || []).map((document) => (
              <article className="finance-simple__card" key={document.id}>
                <div className="finance-simple__card-body"><small>{label(document.document_category)}</small><h3>{document.document_label}</h3><p>{document.original_file_name}</p><Pill value={document.document_status} /><small>Uploaded by {document.uploaded_by_name || "System"}{document.verified_by_name ? ` · Verified by ${document.verified_by_name}` : ""}</small></div>
              </article>
            ))}
          </div>
        </section>

        <section className="finance-simple__section">
          <p className="finance-simple__eyebrow">Open tasks</p>
          {(detail.tasks || []).length ? (detail.tasks || []).map((task) => (
            <article className="finance-simple__notice is-info" key={task.id}><strong>{task.title}</strong><p>{task.description || "No description"}</p><small>{label(task.priority)} · {task.assigned_to_name || label(task.assigned_role)}</small></article>
          )) : <p>No open task is attached to this application.</p>}
        </section>

        <section className="finance-simple__section">
          <p className="finance-simple__eyebrow">Decision history and chronology</p>
          {(detail.decisions || []).map((decision) => (
            <article className="finance-simple__notice is-info" key={`decision-${decision.id}`}><strong>{label(decision.action_type)} → {label(decision.to_status)}</strong><p>{decision.notes || "No note"}</p><small>{decision.decided_by_name || "System"} · {dateLabel(decision.decided_at)}</small></article>
          ))}
          {(detail.timeline || []).map((event) => (
            <article className="finance-simple__notice" key={`event-${event.id}`}><strong>{event.event_title}</strong><p>{event.event_description || ""}</p><small>{event.recorded_by_name || "System"} · {dateLabel(event.occurred_at)}</small></article>
          ))}
        </section>
      </section>
    </div>
  );
}

function EditDialog({ detail, form, setForm, onClose, onSave, saving }) {
  function update(section, field, value) {
    setForm((current) => ({
      ...current,
      [section]: { ...current[section], [field]: value },
    }));
  }
  return (
    <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="finance-simple__dialog finance-simple__dialog--wide" role="dialog" aria-modal="true" aria-label="Edit Finance draft" onMouseDown={(event) => event.stopPropagation()}>
        <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Draft correction</p><h2>{detail.application?.application_number}</h2><span className="finance-simple__muted">Original history remains unchanged.</span></div><button type="button" onClick={onClose}>Close</button></div>
        <form onSubmit={onSave}>
          <h3>Identity and work</h3>
          <div className="finance-simple__grid">
            <Field title="Customer ID type"><input value={form.kyc.id_type} onChange={(event) => update("kyc", "id_type", event.target.value)} /></Field>
            <Field title="Customer ID number"><input value={form.kyc.id_number} onChange={(event) => update("kyc", "id_number", event.target.value)} /></Field>
            <Field title="Date of birth"><input type="date" value={form.kyc.date_of_birth} onChange={(event) => update("kyc", "date_of_birth", event.target.value)} /></Field>
            <Field title="Employment or business type"><select value={form.kyc.employment_type} onChange={(event) => update("kyc", "employment_type", event.target.value)}><option value="">Not recorded</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="pensioner">Pensioner</option><option value="farmer">Farmer</option><option value="other">Other</option></select></Field>
            <Field title="Occupation"><input value={form.kyc.occupation} onChange={(event) => update("kyc", "occupation", event.target.value)} /></Field>
            <Field title="Employer or business"><input value={form.kyc.employer_business_name} onChange={(event) => update("kyc", "employer_business_name", event.target.value)} /></Field>
            <Field title="Residential address" wide><textarea value={form.kyc.residential_address} onChange={(event) => update("kyc", "residential_address", event.target.value)} /></Field>
          </div>
          <h3>Affordability</h3>
          <div className="finance-simple__grid">
            {[
              ["monthly_salary_income", "Salary income"],
              ["monthly_business_income", "Business income"],
              ["monthly_other_income", "Other income"],
              ["monthly_business_costs", "Business costs"],
              ["monthly_household_expenses", "Household expenses"],
              ["existing_monthly_debt", "Existing monthly debt"],
            ].map(([field, title]) => (
              <Field title={title} key={field}><input type="number" min="0" step="0.01" value={form.affordability[field]} onChange={(event) => update("affordability", field, event.target.value)} /></Field>
            ))}
            <Field title="Assessment notes" wide><textarea value={form.affordability.assessment_notes} onChange={(event) => update("affordability", "assessment_notes", event.target.value)} /></Field>
          </div>
          <h3>Consent and guarantor</h3>
          <div className="finance-simple__checks">
            <label><input type="checkbox" checked={form.kyc.customer_consent_confirmed} onChange={(event) => update("kyc", "customer_consent_confirmed", event.target.checked)} /> Customer consent confirmed</label>
            <label><input type="checkbox" checked={form.kyc.credit_assessment_consent_confirmed} onChange={(event) => update("kyc", "credit_assessment_consent_confirmed", event.target.checked)} /> Credit assessment consent confirmed</label>
          </div>
          <div className="finance-simple__grid">
            <Field title="Guarantor name"><input value={form.kyc.guarantor_name} onChange={(event) => update("kyc", "guarantor_name", event.target.value)} /></Field>
            <Field title="Guarantor phone"><input value={form.kyc.guarantor_phone} onChange={(event) => update("kyc", "guarantor_phone", event.target.value)} /></Field>
            <Field title="Guarantor ID number"><input value={form.kyc.guarantor_id_number} onChange={(event) => update("kyc", "guarantor_id_number", event.target.value)} /></Field>
          </div>
          <div className="finance-simple__sticky-actions"><span>Save as draft; approval remains separate</span><div><button type="button" onClick={onClose}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save Draft Changes"}</button></div></div>
        </form>
      </section>
    </div>
  );
}

export default function EquipmentFinanceCompanyWideApplicationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { effectivePermissions = [], user, workspaceRole } = useAuth();
  const role = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const owner = Boolean(user?.is_original_system_administrator);
  const canManage =
    owner ||
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "administrator", "system_administrator", "super_admin"].includes(role);
  const canReview =
    owner ||
    REVIEW_ROLES.has(role) ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);

  const [applications, setApplications] = useState([]);
  const [readiness, setReadiness] = useState({ ready: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [decision, setDecision] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const next = readinessResponse.data?.readiness || { ready: true };
      setReadiness(next);
      if (!next.ready) return;
      const response = await axiosClient.get(API);
      setApplications(response.data?.applications || []);
    } catch (error) {
      const next = error?.response?.data?.readiness;
      if (next?.ready === false) setReadiness(next);
      else setProblem(errorMessage(error, "Could not load Finance applications."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (applicationOrId) => {
    const applicationId = Number(applicationOrId?.id || applicationOrId);
    if (!applicationId) return;
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/${applicationId}`);
      setDetail(response.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the complete application file."));
    }
  }, []);

  useEffect(() => {
    if (loading || readiness.ready !== true) return;
    const applicationId = Number(new URLSearchParams(location.search).get("application") || 0);
    if (applicationId) openDetail(applicationId);
  }, [loading, location.search, openDetail, readiness.ready]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (status !== "all" && application.application_status !== status) return false;
      if (!term) return true;
      return [
        application.application_number,
        application.customer_name,
        application.customer_phone,
        application.quotation_number,
        application.asset_code,
        application.asset_name,
        application.make,
        application.model,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [applications, search, status]);

  const metrics = {
    drafts: applications.filter((item) => ["draft", "changes_requested"].includes(item.application_status)).length,
    review: applications.filter((item) => ["submitted", "under_review"].includes(item.application_status)).length,
    approved: applications.filter((item) => item.application_status === "approved").length,
    exposure: applications
      .filter((item) => !["declined", "withdrawn"].includes(item.application_status))
      .reduce((sum, item) => sum + Number(item.financed_amount || 0), 0),
  };

  function closeDetail() {
    setDetail(null);
    const params = new URLSearchParams(location.search);
    if (params.has("application")) {
      params.delete("application");
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
    }
  }

  function requestDecision(application, kind) {
    const titles = {
      assess: "Recalculate affordability",
      submit: "Submit for independent review",
      start_review: "Start independent review",
      verify: "Verify KYC evidence",
      reject_kyc: "Reject KYC evidence",
      request_changes: "Request changes",
      approve: "Approve credit application",
      decline: "Decline credit application",
    };
    setDecision({ application, kind, title: titles[kind], reason: "" });
  }

  async function confirmDecision(event) {
    event.preventDefault();
    if (!decision) return;
    const reasonRequired = ["reject_kyc", "request_changes", "decline"].includes(decision.kind);
    if (reasonRequired && !decision.reason.trim()) {
      setProblem("Enter the exact reason before completing this action.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const { application, kind, reason } = decision;
      let response;
      if (kind === "assess") {
        response = await axiosClient.post(`${API}/${application.id}/assess`, {});
      } else if (kind === "submit") {
        response = await axiosClient.post(`${API}/${application.id}/submit`, { notes: reason });
      } else if (["verify", "reject_kyc"].includes(kind)) {
        response = await axiosClient.post(`${API}/${application.id}/kyc/verify`, {
          verification_status: kind === "verify" ? "verified" : "rejected",
          reason,
        });
      } else {
        response = await axiosClient.post(`${API}/${application.id}/review`, {
          action: kind,
          reason,
        });
      }
      setDecision(null);
      setDetail(null);
      setNotice(response.data?.message || "Application action completed.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not complete the application action."));
    } finally {
      setSaving(false);
    }
  }

  function beginEdit() {
    setEditForm(detailToEdit(detail));
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!detail?.application?.id || !editForm) return;
    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.put(`${API}/${detail.application.id}`, editForm);
      setEditForm(null);
      setNotice(response.data?.message || "Draft changes saved.");
      await load();
      await openDetail(detail.application.id);
    } catch (error) {
      setProblem(errorMessage(error, "Could not save the draft changes."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Applications, corrections and independent decisions</p>
          <h1>Credit Applications</h1>
          <span>
            Complete drafts, inspect exact schedules and evidence, then submit for an independent decision. No Hire location is used.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
          {canManage ? <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">+ Start New Installment</Link> : null}
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        Draft creation needs only the customer, exact excavator and valid payment plan. KYC and affordability become mandatory before submission—not before saving the draft.
      </div>

      {readiness.ready === false ? (
        <section className="finance-simple__section"><h2>Finance applications are being prepared</h2><p>Missing: {(readiness.missing_tables || []).join(", ")}</p></section>
      ) : null}

      {readiness.ready === true ? (
        <>
          <section className="finance-simple__metrics">
            <article className="finance-simple__metric"><span>Drafts / changes</span><strong>{metrics.drafts}</strong></article>
            <article className="finance-simple__metric"><span>Awaiting review</span><strong>{metrics.review}</strong></article>
            <article className="finance-simple__metric"><span>Approved</span><strong>{metrics.approved}</strong></article>
            <article className="finance-simple__metric"><span>Proposed exposure</span><strong>{money(metrics.exposure)}</strong></article>
          </section>
          <section className="finance-simple__section">
            <div className="finance-simple__toolbar">
              <div><p className="finance-simple__eyebrow">Application register</p><h2>{visible.length} record(s)</h2></div>
              <div className="finance-simple__actions">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, application, offer or excavator" />
                <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="changes_requested">Changes requested</option><option value="approved">Approved</option><option value="declined">Declined</option></select>
                <button type="button" onClick={load} disabled={loading}>Refresh</button>
              </div>
            </div>
            {loading ? <div className="finance-simple__empty">Loading credit applications…</div> : null}
            {!loading && !visible.length ? <div className="finance-simple__empty"><h3>No matching applications</h3><p>Use Start New Installment to create the customer, exact dates, automatic Offer and draft together.</p></div> : null}
            <div className="finance-simple__cards">
              {visible.map((application) => (
                <article className="finance-simple__card" key={application.id}>
                  <div className="finance-simple__machine-image">{application.main_image_url ? <img src={application.main_image_url} alt={application.asset_name || "Excavator"} /> : <span>🚜</span>}</div>
                  <div className="finance-simple__card-body">
                    <div className="finance-simple__card-head"><div><small>{application.application_number}</small><h3>{application.customer_name}</h3><p>{application.asset_code} — {application.asset_name}</p></div><Pill value={application.application_status} /></div>
                    <div className="finance-simple__facts">
                      <div><span>Installment Offer</span><strong>{application.quotation_number}</strong></div>
                      <div><span>Financed</span><strong>{money(application.financed_amount)}</strong></div>
                      <div><span>Periodic payment</span><strong>{money(application.proposed_periodic_amount)}</strong></div>
                      <div><span>First due</span><strong>{dateLabel(application.proposed_first_due_date)}</strong></div>
                      <div><span>KYC</span><strong><Pill value={application.kyc_status} /></strong></div>
                      <div><span>Affordability</span><strong><Pill value={application.affordability_status} /></strong></div>
                    </div>
                    <div className="finance-simple__card-actions">
                      <button type="button" onClick={() => openDetail(application)}>View complete file</button>
                      {canManage && ["draft", "changes_requested"].includes(application.application_status) ? <button type="button" onClick={async () => { await openDetail(application); }}>Edit</button> : null}
                      {canManage && !FINAL_STATUSES.has(application.application_status) ? <button type="button" onClick={() => requestDecision(application, "assess")}>Recalculate</button> : null}
                      {canManage && ["draft", "changes_requested"].includes(application.application_status) ? <button className="is-primary" type="button" onClick={() => requestDecision(application, "submit")}>Submit</button> : null}
                      {canReview && application.application_status === "submitted" ? <button className="is-primary" type="button" onClick={() => requestDecision(application, "start_review")}>Start review</button> : null}
                      {canReview && ["submitted", "under_review"].includes(application.application_status) && application.kyc_status !== "verified" ? <button type="button" onClick={() => requestDecision(application, "verify")}>Verify KYC</button> : null}
                      {canReview && ["submitted", "under_review"].includes(application.application_status) ? <button type="button" onClick={() => requestDecision(application, "reject_kyc")}>Reject KYC</button> : null}
                      {canReview && application.application_status === "under_review" ? <><button type="button" onClick={() => requestDecision(application, "request_changes")}>Request changes</button><button className="is-danger" type="button" onClick={() => requestDecision(application, "decline")}>Decline</button><button className="is-primary" type="button" onClick={() => requestDecision(application, "approve")}>Approve</button></> : null}
                      {application.application_status === "approved" && !application.agreement_id ? <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=activation">Activate agreement</Link> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {detail && !editForm ? (
        <ApplicationDialog
          detail={detail}
          onClose={closeDetail}
          onEdit={beginEdit}
          canEdit={canManage && ["draft", "changes_requested"].includes(detail.application?.application_status)}
        />
      ) : null}
      {detail && editForm ? (
        <EditDialog detail={detail} form={editForm} setForm={setEditForm} onClose={() => setEditForm(null)} onSave={saveEdit} saving={saving} />
      ) : null}

      {decision ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setDecision(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label={decision.title} onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Controlled decision</p><h2>{decision.title}</h2><span className="finance-simple__muted">{decision.application.application_number} · {decision.application.customer_name}</span></div><button type="button" onClick={() => setDecision(null)}>Close</button></div>
            <form onSubmit={confirmDecision}>
              <Field title={["reject_kyc", "request_changes", "decline"].includes(decision.kind) ? "Required reason" : "Decision note"} wide><textarea required={["reject_kyc", "request_changes", "decline"].includes(decision.kind)} value={decision.reason} onChange={(event) => setDecision((current) => ({ ...current, reason: event.target.value }))} /></Field>
              <div className="finance-simple__sticky-actions"><span>Every action is audit recorded</span><div><button type="button" onClick={() => setDecision(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Confirm action"}</button></div></div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
