import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

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
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateValue(value, fallback = "Not recorded") {
  return value ? String(value).slice(0, 10) : fallback;
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function EquipmentFinanceAgreementActivationPage() {
  const { user, workspaceRole } = useAuth();
  const activeRoles = [
    workspaceRole,
    user?.workspace_role,
    user?.access_role,
    user?.role,
    user?.base_role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ]
    .map((value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean);
  const canActivate =
    Boolean(user?.is_original_system_administrator) ||
    activeRoles.some(
      (role) =>
        ["admin", "administrator", "manager", "system_admin", "system_administrator", "super_admin"].includes(role) ||
        ACTIVATION_ROLES.has(role)
    );
  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("awaiting");
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
      const activated = Boolean(candidate.agreement_id);
      if (statusFilter === "awaiting" && activated) return false;
      if (statusFilter === "activated" && !activated) return false;
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
  }, [candidates, search, statusFilter]);

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
      const response = await axiosClient.post(`${API}/${selected.id}`, form);
      setSelected(null);
      const nextAction = response.data?.next_action?.label;
      setNotice(
        [response.data?.message || "Agreement created with its exact installment schedule.", nextAction]
          .filter(Boolean)
          .join(" ")
      );
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not activate the agreement."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple finance-simplified">
      <header className="finance-simple__hero">
        <div>
          <p>Search, select, then activate</p>
          <h1>Activate Agreement</h1>
          <span>
            Find the approved application first. The complete price, deposit, schedule and advisory
            details appear only after the correct application is selected.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications">Back to Applications</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Agreement activation is not ready</h2>
          <p>Missing: {(readiness.missing_tables || []).join(", ")}</p>
        </section>
      ) : null}

      {readiness.ready === true && !selected ? (
        <section className="finance-simple__section">
          <div className="finance-simple__toolbar">
            <div><p className="finance-simple__eyebrow">Choose approved application</p><h2>{visible.length} result(s)</h2></div>
            <div className="finance-simple__actions">
              <input
                aria-label="Search agreement activation candidates"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Application, customer, phone, offer or excavator"
                autoComplete="off"
              />
              <select aria-label="Filter agreement activation status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="awaiting">Awaiting activation</option>
                <option value="activated">Already activated</option>
                <option value="all">All applications</option>
              </select>
            </div>
          </div>
          {loading ? <div className="finance-simple__empty">Loading approved applications…</div> : null}
          {!loading && !visible.length ? <div className="finance-simple__empty">No approved application matches the current search.</div> : null}
          <div className="finance-simplified__compact-register">
            {visible.map((candidate) => {
              const blocked = Boolean(candidate.activation_blockers?.length) || candidate.activation_ready === false;
              return (
                <article className={`finance-simplified__compact-record ${blocked ? "is-warning" : ""}`} key={candidate.id}>
                  <div>
                    <small>{candidate.application_number}</small>
                    <h3>{candidate.customer_name}</h3>
                    <p>{candidate.asset_code} — {candidate.asset_name}</p>
                  </div>
                  <div className="finance-simplified__compact-fact">
                    <span>Financed amount</span>
                    <strong>{money(candidate.financed_amount)}</strong>
                  </div>
                  <div className="finance-simplified__compact-fact">
                    <span>Status</span>
                    <strong>{candidate.agreement_id ? "Activated" : blocked ? "Requires attention" : "Ready"}</strong>
                  </div>
                  <div className="finance-simplified__compact-record-actions">
                    <button className="is-primary" type="button" disabled={Boolean(candidate.agreement_id) || !canActivate || !candidate.activation_ready} onClick={() => open(candidate)}>
                      {candidate.agreement_id ? "Agreement Created" : "Create Agreement"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {selected ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Activate Finance agreement" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Selected application</p>
                <h2>{selected.application_number}</h2>
                <span className="finance-simple__muted">{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span>
              </div>
              <button type="button" onClick={() => setSelected(null)}>Close</button>
            </div>

            <div className="finance-simple__summary">
              <article><span>Automatic Installment Offer</span><strong>{selected.quotation_number || "Not recorded"}</strong></article>
              <article><span>Total price</span><strong>{money(selected.quoted_total)}</strong></article>
              <article><span>Deposit</span><strong>{money(selected.approved_deposit)}</strong></article>
              <article><span>Financed amount</span><strong>{money(selected.financed_amount)}</strong></article>
              <article><span>Payments</span><strong>{selected.installment_count} · {label(selected.payment_frequency)}</strong></article>
              <article><span>Periodic payment</span><strong>{money(selected.periodic_amount)}</strong></article>
              <article><span>First due</span><strong>{dateValue(selected.proposed_first_due_date, "Incomplete approved terms")}</strong></article>
              <article><span>Final due</span><strong>{dateValue(selected.final_due_date, "Incomplete approved terms")}</strong></article>
              <article><span>KYC advisory</span><strong>{label(selected.kyc_status || "not recorded")}</strong></article>
              <article><span>Affordability advisory</span><strong>{label(selected.affordability_status || "not recorded")}</strong></article>
            </div>

            {selected.activation_blockers?.length ? (
              <div className="finance-simple__notice is-error">{selected.activation_blockers.join(" ")}</div>
            ) : null}

            <form onSubmit={activate}>
              <div className="finance-simple__grid">
                <div className="finance-simple__field">
                  <span>Approved first installment due date</span>
                  <strong>{dateValue(selected.proposed_first_due_date)}</strong>
                  <small>The approved date is preserved exactly during agreement creation.</small>
                </div>
                <label className="finance-simple__field">
                  <span>Grace days</span>
                  <input type="number" min="0" max="90" value={form.grace_days} onChange={(event) => setForm((current) => ({ ...current, grace_days: event.target.value }))} />
                </label>
                <label className="finance-simple__field is-wide">
                  <span>Activation note</span>
                  <textarea value={form.activation_notes} onChange={(event) => setForm((current) => ({ ...current, activation_notes: event.target.value }))} />
                </label>
                <label className="finance-simple__check is-wide">
                  <input type="checkbox" checked={form.terms_accepted} onChange={(event) => setForm((current) => ({ ...current, terms_accepted: event.target.checked }))} />
                  <span><strong>Approved terms confirmed</strong><small>I confirm the customer, excavator, price, deposit and approved payment plan.</small></span>
                </label>
              </div>
              <div className="finance-simple__sticky-actions">
                <span>Agreement and schedule only.</span>
                <div><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create Agreement"}</button></div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
