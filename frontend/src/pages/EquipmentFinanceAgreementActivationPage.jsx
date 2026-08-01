import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/agreement-activations";
const ACTIVATION_ROLES = new Set([
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
  if (!value) return "Not recorded";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function intervalLabel(candidate) {
  if (candidate.payment_frequency === "custom") {
    return `Every ${candidate.payment_interval_days || "?"} days`;
  }
  if (candidate.payment_frequency === "weekly") return "Every 7 days";
  if (candidate.payment_frequency === "fortnightly") return "Every 14 days";
  return "Monthly";
}

export default function EquipmentFinanceAgreementActivationPage() {
  const { user, workspaceRole } = useAuth();
  const activeRole = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const canActivate =
    Boolean(user?.is_original_system_administrator) ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(activeRole) ||
    ACTIVATION_ROLES.has(activeRole);
  const [readiness, setReadiness] = useState({ ready: null });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ grace_days: "0", activation_notes: "", terms_accepted: false });

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready) return;
      const response = await axiosClient.get(`${API}/candidates`);
      setCandidates(response.data?.candidates || []);
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (responseReadiness?.ready === false) setReadiness(responseReadiness);
      else setProblem(errorMessage(error, "Could not load approved Finance applications."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (!term) return true;
      return [
        candidate.application_number,
        candidate.customer_name,
        candidate.customer_phone,
        candidate.quotation_number,
        candidate.asset_code,
        candidate.asset_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [candidates, search]);

  function open(candidate) {
    if (!canActivate) {
      setProblem("Only an authorised Finance manager or accountant can activate the agreement.");
      return;
    }
    setSelected(candidate);
    setForm({ grace_days: "0", activation_notes: "", terms_accepted: false });
    setProblem("");
  }

  async function activate(event) {
    event.preventDefault();
    if (!selected || !form.terms_accepted) {
      setProblem("Confirm the approved agreement terms before activation.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/${selected.id}`, {
        ...form,
        first_due_date: selected.proposed_first_due_date,
      });
      setSelected(null);
      setNotice(response.data?.message || "Agreement activated with its exact schedule.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not activate the agreement."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Approved application → agreement</p>
          <h1>Activate Agreement</h1>
          <span>
            Activate the exact approved price, deposit, interval and dated schedule. Finance is
            company-wide and no Hire location is used.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications">Back to Applications</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        Approved dates cannot be changed here. Use a numbered, approved schedule amendment when a date must change.
      </div>

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Agreement activation is not ready</h2>
          <p>Missing: {(readiness.missing_columns || readiness.missing_tables || []).join(", ")}</p>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <section className="finance-simple__section">
          <div className="finance-simple__toolbar">
            <div><p className="finance-simple__eyebrow">Approved candidates</p><h2>{visible.length} application(s)</h2></div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search application, customer, offer or excavator" />
          </div>
          {loading ? <div className="finance-simple__empty">Loading approved applications…</div> : null}
          {!loading && !visible.length ? <div className="finance-simple__empty">No approved KYC-verified application is awaiting activation.</div> : null}
          <div className="finance-simple__cards">
            {visible.map((candidate) => (
              <article className="finance-simple__card" key={candidate.id}>
                <div className="finance-simple__card-body">
                  <div className="finance-simple__card-head">
                    <div><small>{candidate.application_number}</small><h3>{candidate.customer_name}</h3><p>{candidate.asset_code} — {candidate.asset_name}</p></div>
                    <span className={`finance-simple__pill ${candidate.agreement_id ? "is-good" : "is-warning"}`}>{candidate.agreement_id ? "Activated" : "Awaiting activation"}</span>
                  </div>
                  <div className="finance-simple__facts">
                    <div><span>Installment Offer</span><strong>{candidate.quotation_number}</strong></div>
                    <div><span>Total</span><strong>{money(candidate.quoted_total)}</strong></div>
                    <div><span>Deposit</span><strong>{money(candidate.approved_deposit)}</strong></div>
                    <div><span>Financed</span><strong>{money(candidate.financed_amount)}</strong></div>
                    <div><span>Payment interval</span><strong>{intervalLabel(candidate)}</strong></div>
                    <div><span>Normal payment</span><strong>{money(candidate.periodic_amount)}</strong></div>
                    <div><span>First due</span><strong>{dateLabel(candidate.proposed_first_due_date)}</strong></div>
                    <div><span>Final due</span><strong>{dateLabel(candidate.final_due_date)}</strong></div>
                  </div>
                  <button className="is-primary" type="button" disabled={Boolean(candidate.agreement_id) || !canActivate} onClick={() => open(candidate)}>{candidate.agreement_id ? "Agreement activated" : "Review Exact Schedule"}</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Activate Finance agreement" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header">
              <div><p className="finance-simple__eyebrow">Approved terms</p><h2>{selected.application_number}</h2><span className="finance-simple__muted">{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span></div>
              <button type="button" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="finance-simple__summary">
              <article><span>Interval</span><strong>{intervalLabel(selected)}</strong></article>
              <article><span>Payments</span><strong>{selected.installment_count}</strong></article>
              <article><span>First due</span><strong>{dateLabel(selected.proposed_first_due_date)}</strong></article>
              <article><span>Final due</span><strong>{dateLabel(selected.final_due_date)}</strong></article>
              <article><span>Normal payment</span><strong>{money(selected.periodic_amount)}</strong></article>
              <article><span>Weekend rule</span><strong>{label(selected.non_working_day_rule)}</strong></article>
            </div>
            <details open>
              <summary>Exact approved schedule</summary>
              <div className="finance-simple__schedule-list">
                {(selected.exact_schedule || []).map((row) => (
                  <article key={`${row.sequence_number}-${row.due_date}`}>
                    <span>Payment {row.sequence_number}</span>
                    <strong>{dateLabel(row.due_date)}</strong>
                    <b>{money(row.scheduled_amount)}</b>
                  </article>
                ))}
              </div>
            </details>
            <form onSubmit={activate}>
              <div className="finance-simple__grid">
                <label className="finance-simple__field"><span>Grace days</span><input type="number" min="0" max="90" value={form.grace_days} onChange={(event) => setForm((current) => ({ ...current, grace_days: event.target.value }))} /></label>
                <label className="finance-simple__field is-wide"><span>Activation note</span><textarea value={form.activation_notes} onChange={(event) => setForm((current) => ({ ...current, activation_notes: event.target.value }))} /></label>
                <label className="finance-simple__check is-wide"><input type="checkbox" checked={form.terms_accepted} onChange={(event) => setForm((current) => ({ ...current, terms_accepted: event.target.checked }))} /><span><strong>Exact approved terms confirmed</strong><small>I confirm the customer, exact excavator, price, deposit, payment interval and every due date above.</small></span></label>
              </div>
              <div className="finance-simple__sticky-actions"><span>No payment or reservation is created here</span><div><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Activating…" : "Activate Exact Agreement"}</button></div></div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
