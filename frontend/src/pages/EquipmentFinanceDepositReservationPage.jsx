import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

const API = "/equipment-catalogue/sales/deposit-reservations";
const DEPOSIT_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function rolesFor(user, workspaceRole) {
  const values = [
    workspaceRole,
    user?.workspace_role,
    user?.access_role,
    user?.role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
    ...(Array.isArray(user?.workspace_roles) ? user.workspace_roles : []),
  ];
  return values
    .map((value) =>
      value && typeof value === "object"
        ? value.code || value.role_code || value.name || value.role
        : value
    )
    .map(normalizeRole)
    .filter(Boolean);
}

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
  const activeRoles = rolesFor(user, workspaceRole);
  const canCollect =
    Boolean(user?.is_original_system_administrator) ||
    activeRoles.some((role) => ADMIN_ROLES.has(role) || DEPOSIT_ROLES.has(role));
  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState("open");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);

  const closeEntry = useCallback(() => {
    setSelected(null);
    setForm(null);
  }, []);

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
      else setProblem(errorMessage(error, "Could not load Finance deposit agreements."));
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
      const state = queueState(candidate);
      if (queueFilter === "open" && state === "reserved") return false;
      if (queueFilter !== "all" && queueFilter !== "open" && state !== queueFilter) return false;
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
  }, [candidates, queueFilter, search]);

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
    if (candidate.ready_for_deposit === false) {
      setProblem(`This agreement is blocked: ${(candidate.blockers || []).map(label).join(", ")}.`);
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
    const amountText = String(form.amount || "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      setProblem("Enter a non-negative amount with no more than two decimal places.");
      return;
    }
    const amount = Number(amountText);
    const amountCents = Math.round(amount * 100);
    const remainingCents = Math.round(Number(selected.deposit_remaining || 0) * 100);
    const completes = amountCents >= remainingCents;
    if (amountCents > remainingCents) {
      setProblem("The amount cannot exceed the remaining required deposit.");
      return;
    }
    if (amountCents === 0 && remainingCents > 0) {
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
      closeEntry();
      setNotice(`${response.data?.message || "Opening deposit recorded."}${receipt ? ` Receipt: ${receipt}.` : ""}`);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not record the Finance opening deposit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-simple finance-simplified">
      <header className="finance-simple__hero">
        <div>
          <p>Search, select, then record</p>
          <h1>Opening Deposit &amp; Machine Reservation</h1>
          <span>
            Find the approved agreement first. Deposit and machine details open only after the
            correct customer agreement is selected.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=activation">Agreement Activation</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Deposit and reservation are not ready</h2>
          <p>Missing: {[...(readiness.missing_tables || []), ...(readiness.missing_columns || []), ...(readiness.missing_triggers || []), ...(readiness.missing_migrations || [])].join(", ")}</p>
        </section>
      ) : null}

      {readiness.ready === true && !selected ? (
        <>
          <section className="finance-simple__metrics">
            <article className="finance-simple__metric"><span>Awaiting first deposit</span><strong>{summary.awaiting}</strong></article>
            <article className="finance-simple__metric"><span>Partial deposits</span><strong>{summary.partial}</strong></article>
            <article className="finance-simple__metric"><span>Reserved machines</span><strong>{summary.reserved}</strong></article>
            <article className="finance-simple__metric"><span>Deposit still required</span><strong>{money(summary.remaining)}</strong></article>
          </section>

          <section className="finance-simple__section">
            <div className="finance-simple__toolbar">
              <div><p className="finance-simple__eyebrow">Choose agreement</p><h2>{visible.length} result(s)</h2></div>
              <div className="finance-simple__actions">
                <input
                  aria-label="Search opening deposit agreements"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Agreement, customer, phone or excavator"
                  autoComplete="off"
                />
                <select aria-label="Filter opening deposit queue" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
                  <option value="open">Awaiting / partial</option>
                  <option value="awaiting">Awaiting first deposit</option>
                  <option value="partial">Partial deposits</option>
                  <option value="reserved">Reserved</option>
                  <option value="all">All agreements</option>
                </select>
              </div>
            </div>
            {loading ? <div className="finance-simple__empty">Loading Finance agreements…</div> : null}
            {!loading && !visible.length ? <div className="finance-simple__empty">No agreement matches the current search and filter.</div> : null}
            <div className="finance-simplified__compact-register">
              {visible.map((candidate) => {
                const state = queueState(candidate);
                return (
                  <article className={`finance-simplified__compact-record ${state === "partial" ? "is-warning" : ""}`} key={candidate.agreement_id}>
                    <div>
                      <small>{candidate.agreement_number}</small>
                      <h3>{candidate.customer_name}</h3>
                      <p>{candidate.asset_code} — {candidate.asset_name}</p>
                    </div>
                    <div className="finance-simplified__compact-fact">
                      <span>Deposit remaining</span>
                      <strong>{money(candidate.deposit_remaining)}</strong>
                    </div>
                    <div className="finance-simplified__compact-fact">
                      <span>Status</span>
                      <strong>{label(state)}</strong>
                    </div>
                    <div className="finance-simplified__compact-record-actions">
                      <button className="is-primary" type="button" disabled={candidate.reserved || candidate.ready_for_deposit === false || !canCollect} onClick={() => open(candidate)}>
                        {candidate.reserved ? "Reserved" : Number(candidate.deposit_received || 0) > 0 ? "Complete Deposit" : "Record Deposit"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {selected && form ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={closeEntry}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Record opening deposit" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Selected agreement</p>
                <h2>{selected.agreement_number}</h2>
                <span className="finance-simple__muted">{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span>
              </div>
              <button type="button" onClick={closeEntry}>Close</button>
            </div>
            <div className="finance-simple__summary">
              <article><span>Sale total</span><strong>{money(selected.total_amount)}</strong></article>
              <article><span>Deposit required</span><strong>{money(selected.deposit_required)}</strong></article>
              <article><span>Already received</span><strong>{money(selected.deposit_received)}</strong></article>
              <article><span>Deposit remaining</span><strong>{money(selected.deposit_remaining)}</strong></article>
            </div>
            {(selected.blockers || []).length ? <div className="finance-simple__notice is-error">Blocked: {selected.blockers.map(label).join(", ")}</div> : null}
            <form onSubmit={record}>
              <div className="finance-simple__grid">
                <label className="finance-simple__field">
                  <span>Amount</span>
                  <input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value.replace(/[^0-9.]/g, "") }))} required />
                  <strong className="finance-simple__money">{money(form.amount)}</strong>
                </label>
                <label className="finance-simple__field">
                  <span>Payment method</span>
                  <select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}>
                    <option value="cash">Cash</option>
                    <option value="momo">Mobile money</option>
                    <option value="bank">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="finance-simple__field"><span>Reference number</span><input value={form.reference_number} onChange={(event) => setForm((current) => ({ ...current, reference_number: event.target.value }))} /></label>
                <label className="finance-simple__field"><span>Notes</span><input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <label className="finance-simple__check is-wide">
                  <input type="checkbox" checked={form.confirm_reservation} onChange={(event) => setForm((current) => ({ ...current, confirm_reservation: event.target.checked }))} />
                  <span><strong>Reserve this exact excavator when the required deposit is complete</strong><small>This creates the protected Finance sale lock.</small></span>
                </label>
              </div>
              <div className="finance-simple__sticky-actions">
                <span>Receipt first; reservation only after the required deposit.</span>
                <div><button type="button" onClick={closeEntry}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Recording…" : "Record Deposit"}</button></div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
