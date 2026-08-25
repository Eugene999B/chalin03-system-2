import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import EquipmentFinanceDepositReservationDialog from "./EquipmentFinanceDepositReservationDialog";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";
import "../styles/equipmentFinanceDepositDialog.css";

const API = "/equipment-catalogue/sales/deposit-reservations";
const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["momo", "Mobile money"],
  ["bank", "Bank transfer"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];
const AUTHORIZED = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const money = (value) => `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

function userRoles(user, workspaceRole) {
  const values = [workspaceRole, user?.workspace_role, user?.access_role, user?.role, ...(user?.roles || []), ...(user?.workspace_roles || [])];
  return values.map((value) => value && typeof value === "object" ? value.code || value.role_code || value.name || value.role : value).map(normalize).filter(Boolean);
}

function queueState(candidate) {
  if (candidate.reserved) return "reserved";
  if (Number(candidate.deposit_received || 0) > 0) return "partial";
  return "awaiting";
}

function requestKey(id) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Your browser cannot create a secure payment request key. Refresh the page or use a current browser.");
  return `finance-opening-deposit:${id}:${uuid}`;
}

export default function EquipmentFinanceDepositReservationPageV2() {
  const { user, workspaceRole } = useAuth();
  const canCollect = Boolean(user?.is_original_system_administrator) || userRoles(user, workspaceRole).some((role) => AUTHORIZED.has(role));
  const [candidates, setCandidates] = useState([]);
  const [readiness, setReadiness] = useState({ ready: null });
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const next = readinessResponse.data?.readiness || { ready: true };
      setReadiness(next);
      if (!next.ready) return;
      const response = await axiosClient.get(`${API}/candidates`);
      setCandidates(response.data?.candidates || []);
      setProblem("");
    } catch (error) {
      setProblem(error?.response?.data?.message || error?.message || "Could not load Finance deposit agreements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const state = queueState(candidate);
      if (filter === "open" && state === "reserved") return false;
      if (!['open', 'all'].includes(filter) && state !== filter) return false;
      if (!term) return true;
      return [candidate.agreement_number, candidate.application_number, candidate.customer_name, candidate.customer_phone, candidate.asset_code, candidate.asset_name].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    });
  }, [candidates, filter, search]);

  const summary = useMemo(() => ({
    awaiting: candidates.filter((item) => queueState(item) === "awaiting").length,
    partial: candidates.filter((item) => queueState(item) === "partial").length,
    reserved: candidates.filter((item) => queueState(item) === "reserved").length,
    remaining: candidates.reduce((sum, item) => sum + Number(item.deposit_remaining || 0), 0),
  }), [candidates]);

  const close = useCallback(() => { if (!saving) { setSelected(null); setForm(null); } }, [saving]);
  const setField = useCallback((name, value) => setForm((current) => ({ ...current, [name]: value })), []);

  function open(candidate) {
    if (!canCollect) return setProblem("Only an authorised Finance manager or accountant can record the opening deposit.");
    if (candidate.reserved) return setProblem("This agreement already has a protected machine reservation.");
    if (candidate.ready_for_deposit === false) return setProblem(`This agreement is blocked: ${(candidate.blockers || []).map(label).join(", ")}.`);
    setProblem("");
    setNotice("");
    setSelected(candidate);
    setForm({ amount: String(Number(candidate.deposit_remaining || 0).toFixed(2)), payment_method: "cash", reference_number: "", notes: "", confirm_reservation: false, idempotency_key: requestKey(candidate.agreement_id) });
  }

  async function record(event) {
    event.preventDefault();
    if (!selected || !form) return;
    const amount = Number(form.amount);
    const cents = Math.round(amount * 100);
    const remaining = Math.round(Number(selected.deposit_remaining || 0) * 100);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(form.amount || "").trim())) return setProblem("Enter a valid payment amount with no more than two decimal places.");
    if (cents > remaining) return setProblem(`Payment cannot exceed the remaining deposit of ${money(selected.deposit_remaining)}.`);
    if (cents >= remaining && !form.confirm_reservation) return setProblem("Confirm the exact excavator reservation when this payment completes the required deposit.");
    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/${selected.agreement_id}/deposit`, { ...form, amount });
      const receipt = response.data?.payment?.receipt_number;
      setSelected(null);
      setForm(null);
      setNotice(`${response.data?.message || "Opening deposit recorded successfully."}${receipt ? ` Receipt: ${receipt}.` : ""}`);
      await load();
    } catch (error) {
      setProblem(error?.response?.data?.message || error?.message || "Could not record the Finance opening deposit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple finance-simplified">
      <header className="finance-simple__hero">
        <div>
          <p>Installment Finance</p>
          <h1>Opening Deposit</h1>
          <span>Record the buyer's deposit against the approved agreement. Partial payments stay unreserved; the exact excavator is protected only after the required deposit is complete.</span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=activation">Agreements</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}

      {readiness.ready === false ? <section className="finance-simple__section"><h2>Opening Deposit is not ready</h2><p>Please apply the approved deposit controls before recording money.</p></section> : null}

      {readiness.ready !== false ? <>
        <section className="finance-simple__metrics">
          <article className="finance-simple__metric"><span>Awaiting first deposit</span><strong>{summary.awaiting}</strong></article>
          <article className="finance-simple__metric"><span>Partial deposits</span><strong>{summary.partial}</strong></article>
          <article className="finance-simple__metric"><span>Reserved machines</span><strong>{summary.reserved}</strong></article>
          <article className="finance-simple__metric"><span>Deposit still required</span><strong>{money(summary.remaining)}</strong></article>
        </section>

        <section className="finance-simple__section">
          <div className="finance-simple__toolbar">
            <div><p className="finance-simple__eyebrow">Approved agreements</p><h2>{visible.length} agreement(s)</h2><p>Search, select, then record the opening deposit against the approved agreement.</p></div>
            <div className="finance-simple__actions">
              <input aria-label="Search agreements" placeholder="Customer, agreement or excavator" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select aria-label="Deposit filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="open">Awaiting / partial</option>
                <option value="awaiting">Awaiting first deposit</option>
                <option value="partial">Partial deposits</option>
                <option value="reserved">Reserved</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
          {loading ? <div className="finance-simple__empty">Loading agreements…</div> : null}
          {!loading && !visible.length ? <div className="finance-simple__empty">No agreements match the current filter.</div> : null}
          <div className="finance-simplified__compact-register">
            {visible.map((candidate) => {
              const state = queueState(candidate);
              return <article className={`finance-simplified__compact-record ${state === "partial" ? "is-warning" : ""}`} key={candidate.agreement_id}>
                <div><small>{candidate.agreement_number}</small><h3>{candidate.customer_name}</h3><p>{candidate.asset_code} — {candidate.asset_name}</p></div>
                <div className="finance-simplified__compact-fact"><span>Remaining</span><strong>{money(candidate.deposit_remaining)}</strong></div>
                <div className="finance-simplified__compact-fact"><span>Status</span><strong>{label(state)}</strong></div>
                <div className="finance-simplified__compact-record-actions"><button className="is-primary" type="button" disabled={candidate.reserved || candidate.ready_for_deposit === false || !canCollect} onClick={() => open(candidate)}>{candidate.reserved ? "Reserved" : state === "partial" ? "Complete Deposit" : "Record Deposit"}</button></div>
              </article>;
            })}
          </div>
        </section>
      </> : null}

      <EquipmentFinanceDepositReservationDialog selected={selected} form={form} saving={saving} onChange={setField} onClose={close} onSubmit={record} money={money} />
    </main>
  );
}
