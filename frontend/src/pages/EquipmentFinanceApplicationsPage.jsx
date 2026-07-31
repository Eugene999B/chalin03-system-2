import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/credit-applications";
const FINAL_STATUSES = new Set(["approved", "declined", "withdrawn"]);

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Pill({ value }) {
  const dangerous = ["declined", "rejected", "ineligible", "critical", "overdue"].includes(value);
  const warning = ["submitted", "under_review", "manual_review", "high", "changes_requested", "incomplete"].includes(value);
  return (
    <span className={`finance-simple__pill ${dangerous ? "is-danger" : warning ? "is-warning" : "is-good"}`}>
      {label(value)}
    </span>
  );
}

export default function EquipmentFinanceApplicationsPage() {
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);
  const canReview = ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);
  const [applications, setApplications] = useState([]);
  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState(null);
  const [decision, setDecision] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready) return;
      const response = await axiosClient.get(API);
      setApplications(response.data?.applications || []);
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (responseReadiness?.ready === false) {
        setReadiness(responseReadiness);
      } else {
        setProblem(errorMessage(error, "Could not load Finance applications."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  async function openDetail(application) {
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/${application.id}`);
      setDetail(response.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the application file."));
    }
  }

  function requestDecision(application, kind) {
    const titles = {
      assess: "Recalculate affordability",
      submit: "Submit for manager review",
      start_review: "Start manager review",
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

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Applications and approvals</p>
          <h1>Credit Applications</h1>
          <span>
            Start every case through the guided workflow. This page is now for draft completion,
            KYC verification and independent manager decisions—not for finding a separate quotation.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help with approvals</Link>
          {canManage ? <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">+ Start New Installment</Link> : null}
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        Finance is company-wide. No Hire-location selection is needed to create, edit, submit or review an application.
      </div>

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Credit application foundation is not ready</h2>
          <p>Missing: {(readiness.missing_tables || []).join(", ") || "approved database foundation"}</p>
        </section>
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
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="under_review">Under review</option>
                  <option value="changes_requested">Changes requested</option>
                  <option value="approved">Approved</option>
                  <option value="declined">Declined</option>
                </select>
                <button type="button" onClick={load} disabled={loading}>Refresh</button>
              </div>
            </div>

            {loading ? <div className="finance-simple__empty">Loading credit applications…</div> : null}
            {!loading && !visible.length ? (
              <div className="finance-simple__empty">
                <h3>No matching applications</h3>
                <p>Use Start New Installment to create the customer, automatic Installment Offer and draft application together.</p>
              </div>
            ) : null}

            <div className="finance-simple__cards">
              {visible.map((application) => (
                <article className="finance-simple__card" key={application.id}>
                  <div className="finance-simple__machine-image">
                    {application.main_image_url ? <img src={application.main_image_url} alt={application.asset_name || "Excavator"} /> : <span>🚜</span>}
                  </div>
                  <div className="finance-simple__card-body">
                    <div className="finance-simple__card-head">
                      <div><small>{application.application_number}</small><h3>{application.customer_name}</h3><p>{application.asset_code} — {application.asset_name}</p></div>
                      <Pill value={application.application_status} />
                    </div>
                    <div className="finance-simple__facts">
                      <div><span>Installment Offer</span><strong>{application.quotation_number || "Automatic offer"}</strong></div>
                      <div><span>Quoted total</span><strong>{money(application.quoted_total)}</strong></div>
                      <div><span>Deposit</span><strong>{money(application.proposed_deposit)}</strong></div>
                      <div><span>Financed</span><strong>{money(application.financed_amount)}</strong></div>
                      <div><span>KYC</span><strong><Pill value={application.kyc_status} /></strong></div>
                      <div><span>Affordability</span><strong><Pill value={application.affordability_status} /></strong></div>
                      <div><span>Risk</span><strong><Pill value={application.risk_band} /></strong></div>
                      <div><span>Monthly surplus</span><strong>{money(application.net_monthly_surplus)}</strong></div>
                    </div>
                    <div className="finance-simple__card-actions">
                      <button type="button" onClick={() => openDetail(application)}>View file</button>
                      {canManage && !FINAL_STATUSES.has(application.application_status) ? <button type="button" onClick={() => requestDecision(application, "assess")}>Recalculate</button> : null}
                      {canManage && ["draft", "changes_requested"].includes(application.application_status) ? <button className="is-primary" type="button" onClick={() => requestDecision(application, "submit")}>Submit</button> : null}
                      {canReview && application.application_status === "submitted" ? <button className="is-primary" type="button" onClick={() => requestDecision(application, "start_review")}>Start review</button> : null}
                      {canReview && ["submitted", "under_review"].includes(application.application_status) && application.kyc_status !== "verified" ? <button type="button" onClick={() => requestDecision(application, "verify")}>Verify KYC</button> : null}
                      {canReview && ["submitted", "under_review"].includes(application.application_status) ? <button type="button" onClick={() => requestDecision(application, "reject_kyc")}>Reject KYC</button> : null}
                      {canReview && application.application_status === "under_review" ? <><button type="button" onClick={() => requestDecision(application, "request_changes")}>Request changes</button><button className="is-danger" type="button" onClick={() => requestDecision(application, "decline")}>Decline</button><button className="is-primary" type="button" onClick={() => requestDecision(application, "approve")}>Approve</button></> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {detail ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setDetail(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Credit application file" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Application file</p><h2>{detail.application?.application_number}</h2><span className="finance-simple__muted">{detail.application?.customer_name} · {detail.application?.asset_code} {detail.application?.asset_name}</span></div><button type="button" onClick={() => setDetail(null)}>Close</button></div>
            <div className="finance-simple__summary">
              <article><span>Status</span><strong>{label(detail.application?.application_status)}</strong></article>
              <article><span>Automatic Installment Offer</span><strong>{detail.application?.quotation_number}</strong></article>
              <article><span>Customer ID</span><strong>{detail.kyc?.id_type}: {detail.kyc?.id_number || "Missing"}</strong></article>
              <article><span>Employment</span><strong>{label(detail.kyc?.employment_type)} · {detail.kyc?.occupation || "Missing"}</strong></article>
              <article><span>Guarantor</span><strong>{detail.kyc?.guarantor_name || "Not recorded"}</strong><small>{detail.kyc?.guarantor_phone}</small></article>
              <article><span>Assessment</span><strong>{detail.application?.assessment_recommendation || "Not calculated"}</strong></article>
            </div>
            <section className="finance-simple__section"><p className="finance-simple__eyebrow">Decision history</p>{detail.decisions?.length ? detail.decisions.map((item) => <article key={item.id} className="finance-simple__notice is-info"><strong>{label(item.action_type)} → {label(item.to_status)}</strong><p>{item.notes || "No note"}</p><small>{item.decided_by_name || "System"}</small></article>) : <p>No decisions recorded.</p>}</section>
          </section>
        </div>
      ) : null}

      {decision ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setDecision(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label={decision.title} onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Controlled decision</p><h2>{decision.title}</h2><span className="finance-simple__muted">{decision.application.application_number} · {decision.application.customer_name}</span></div><button type="button" onClick={() => setDecision(null)}>Close</button></div>
            <form onSubmit={confirmDecision}>
              <label className="finance-simple__field"><span>Reason / note</span><textarea value={decision.reason} onChange={(event) => setDecision((current) => ({ ...current, reason: event.target.value }))} placeholder="Enter a clear reason, especially for rejection, decline or requested changes." /></label>
              <div className="finance-simple__sticky-actions"><span>No payment, delivery or ownership transfer happens here.</span><div><button type="button" onClick={() => setDecision(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Confirm Action"}</button></div></div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
