import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/deposit-reservations";
const DEPOSIT_ROLES = new Set([
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

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function requestKey(agreementId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Use a current browser before recording money.");
  return `finance-opening-deposit:${agreementId}:${uuid}`;
}

function queueState(candidate) {
  if (candidate.reserved) return "reserved";
  if (Number(candidate.deposit_received || 0) > 0) return "partial";
  return "awaiting";
}

export default function EquipmentFinanceDepositReservationPage() {
  const { user, workspaceRole } = useAuth();
  const activeRole = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const canCollect =
    Boolean(user?.is_original_system_administrator) ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(activeRole) ||
    DEPOSIT_ROLES.has(activeRole);
  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);

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
      if (responseReadiness?.ready === false) {
        setReadiness(responseReadiness);
      } else {
        setProblem(errorMessage(error, "Could not load Finance deposit agreements."));
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
    return candidates.filter((candidate) => {
      if (!term) return true;
      return [
        candidate.agreement_number,
        candidate.application_number,
        candidate.customer_name,
        candidate.customer_phone,
        candidate.asset_code,
        candidate.asset_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [candidates, search]);

  const summary = {
    awaiting: candidates.filter((item) => queueState(item) === "awaiting").length,
    partial: candidates.filter((item) => queueState(item) === "partial").length,
    reserved: candidates.filter((item) => queueState(item) === "reserved").length,
    remaining: candidates.reduce((sum, item) => sum + Number(item.deposit_remaining || 0), 0),
  };

  function open(candidate) {
    if (!canCollect) {
      setProblem("Only an authorised Finance manager or accountant can record the opening deposit.");
      return;
    }
    if (candidate.reserved) {
      setProblem("The required deposit is complete and this excavator is already reserved.");
      return;
    }
    try {
      setSelected(candidate);
      setForm({
        amount: String(Number(candidate.deposit_remaining || 0).toFixed(2)),
        payment_method: "cash",
        reference_number: "",
        notes: "",
        confirm_reservation: false,
        idempotency_key: requestKey(candidate.agreement_id),
      });
      setProblem("");
    } catch (error) {
      setProblem(error.message);
    }
  }

  async function record(event) {
    event.preventDefault();
    if (!selected || !form) return;
    const amount = Number(form.amount || 0);
    const remaining = Number(selected.deposit_remaining || 0);
    const completes = amount + 0.01 >= remaining;
    if (!Number.isFinite(amount) || amount < 0 || amount > remaining + 0.01) {
      setProblem("Enter an amount from zero up to the remaining required deposit.");
      return;
    }
    if (amount <= 0 && remaining > 0.01) {
      setProblem("Enter the deposit amount.");
      return;
    }
    if (completes && !form.confirm_reservation) {
      setProblem("Confirm reservation of the exact excavator before completing the deposit.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/${selected.agreement_id}/deposit`, {
        ...form,
        amount,
      });
      const receipt = response.data?.payment?.receipt_number;
      setSelected(null);
      setForm(null);
      setNotice(`${response.data?.message || "Opening deposit recorded."}${receipt ? ` Receipt: ${receipt}.` : ""}`);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not record the Finance opening deposit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Agreement → deposit → reservation</p>
          <h1>Opening Deposit &amp; Machine Reservation</h1>
          <span>
            Record the opening deposit and reserve the exact excavator after the agreement is active.
            Finance is company-wide; no Hire-location selection is required.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=activation">Agreement Activation</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        A partial deposit records a receipt but does not reserve the excavator. Completing the required deposit and confirming reservation creates one protected Finance sale lock. No Hire job, delivery or ownership transfer is created here.
      </div>

      {readiness.ready === false ? <section className="finance-simple__section"><h2>Deposit and reservation are not ready</h2><p>Missing: {(readiness.missing_tables || readiness.missing_columns || []).join(", ")}</p></section> : null}

      {readiness.ready === true ? (
        <>
          <section className="finance-simple__metrics">
            <article className="finance-simple__metric"><span>Awaiting first deposit</span><strong>{summary.awaiting}</strong></article>
            <article className="finance-simple__metric"><span>Partial deposits</span><strong>{summary.partial}</strong></article>
            <article className="finance-simple__metric"><span>Reserved machines</span><strong>{summary.reserved}</strong></article>
            <article className="finance-simple__metric"><span>Deposit still required</span><strong>{money(summary.remaining)}</strong></article>
          </section>

          <section className="finance-simple__section">
            <div className="finance-simple__toolbar"><div><p className="finance-simple__eyebrow">Opening deposit queue</p><h2>{visible.length} agreement(s)</h2></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agreement, customer or excavator" /></div>
            {loading ? <div className="finance-simple__empty">Loading Finance agreements…</div> : null}
            {!loading && !visible.length ? <div className="finance-simple__empty">No activated Finance agreement is waiting for a deposit.</div> : null}
            <div className="finance-simple__cards">
              {visible.map((candidate) => {
                const state = queueState(candidate);
                return (
                  <article className="finance-simple__card" key={candidate.agreement_id}>
                    <div className="finance-simple__machine-image">{candidate.main_image_url ? <img src={candidate.main_image_url} alt={candidate.asset_name} /> : <span>🚜</span>}</div>
                    <div className="finance-simple__card-body">
                      <div className="finance-simple__card-head"><div><small>{candidate.agreement_number}</small><h3>{candidate.customer_name}</h3><p>{candidate.asset_code} — {candidate.asset_name}</p></div><span className={`finance-simple__pill ${state === "reserved" ? "is-good" : "is-warning"}`}>{label(state)}</span></div>
                      <div className="finance-simple__facts"><div><span>Sale total</span><strong>{money(candidate.total_amount)}</strong></div><div><span>Deposit required</span><strong>{money(candidate.deposit_required)}</strong></div><div><span>Deposit received</span><strong>{money(candidate.deposit_received)}</strong></div><div><span>Remaining</span><strong>{money(candidate.deposit_remaining)}</strong></div><div><span>Outstanding balance</span><strong>{money(candidate.outstanding_balance)}</strong></div><div><span>Machine status</span><strong>{label(candidate.asset_sale_status)}</strong></div></div>
                      <button className="is-primary" type="button" disabled={candidate.reserved || !canCollect} onClick={() => open(candidate)}>{candidate.reserved ? "Machine reserved" : Number(candidate.deposit_received || 0) > 0 ? "Complete Deposit" : "Record Deposit"}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {selected && form ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Record opening deposit" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Protected money entry</p><h2>{selected.agreement_number}</h2><span className="finance-simple__muted">{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span></div><button type="button" onClick={() => setSelected(null)}>Close</button></div>
            <form onSubmit={record}>
              <div className="finance-simple__summary"><article><span>Deposit remaining</span><strong className="finance-simple__money">{money(selected.deposit_remaining)}</strong></article><article><span>Already received</span><strong className="finance-simple__money">{money(selected.deposit_received)}</strong></article></div>
              <div className="finance-simple__grid">
                <label className="finance-simple__field"><span>Amount</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value.replace(/[^0-9.,]/g, "") }))} required /><strong className="finance-simple__money">{money(form.amount)}</strong></label>
                <label className="finance-simple__field"><span>Payment method</span><select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
                <label className="finance-simple__field"><span>Reference number</span><input value={form.reference_number} onChange={(event) => setForm((current) => ({ ...current, reference_number: event.target.value }))} /></label>
                <label className="finance-simple__field"><span>Notes</span><input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <label className="finance-simple__check is-wide"><input type="checkbox" checked={form.confirm_reservation} onChange={(event) => setForm((current) => ({ ...current, confirm_reservation: event.target.checked }))} /><span><strong>Reserve this exact excavator when the required deposit is complete</strong><small>This creates the protected Finance sale lock.</small></span></label>
              </div>
              <div className="finance-simple__sticky-actions"><span>Receipt first; reservation only after the required deposit</span><div><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Recording…" : "Record Deposit"}</button></div></div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
