import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentFinanceDepositReservation.css";

const API = "/equipment-catalogue/sales/deposit-reservations";
const DEPOSIT_ROLES = new Set(["finance_manager", "finance_accountant"]);
const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["momo", "Mobile money"],
  ["bank", "Bank transfer"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const label = (value) =>
  String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

function secureRequestKey(agreementId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error(
      "This browser cannot create a secure deposit request key. Refresh with a current browser before recording money."
    );
  }
  return `finance-opening-deposit:${agreementId}:${uuid}`;
}

function initialForm(candidate = {}) {
  return {
    amount: String(Number(candidate.deposit_remaining || 0).toFixed(2)),
    payment_method: "cash",
    reference_number: "",
    notes: "",
    confirm_reservation: false,
    idempotency_key: secureRequestKey(candidate.agreement_id || "new"),
  };
}

function StatusPill({ value }) {
  return (
    <span className={`finance-deposit__status is-${String(value || "unknown")}`}>
      {label(value)}
    </span>
  );
}

function Drawer({ title, subtitle, onClose, children }) {
  return (
    <div className="finance-deposit__backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="finance-deposit__drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close deposit dialog">
            ×
          </button>
        </header>
        <div className="finance-deposit__drawer-body">{children}</div>
      </section>
    </div>
  );
}

function Field({ title, hint, wide = false, children }) {
  return (
    <label className={`finance-deposit__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function queueState(candidate) {
  if (candidate.reserved) return "reserved";
  if (Number(candidate.deposit_received || 0) > 0) return "partial";
  return "awaiting";
}

export default function EquipmentFinanceDepositReservationPage() {
  const { user, workspaceRole } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const activeRole = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const isSystemAdministrator = Boolean(user?.is_original_system_administrator);
  const canCollect = isSystemAdministrator || DEPOSIT_ROLES.has(activeRole);

  const [readiness, setReadiness] = useState({ ready: null });
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [form, setForm] = useState(null);

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All authorised Finance locations"
      : "Choose a Finance location");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready || !selectedContextId) {
        setCandidates([]);
        return;
      }

      const response = await axiosClient.get(`${API}/candidates`);
      setCandidates(response.data?.candidates || []);
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (
        error?.response?.data?.code ===
          "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED" ||
        responseReadiness?.ready === false
      ) {
        setReadiness(responseReadiness || { ready: false });
        setCandidates([]);
        return;
      }
      setProblem(errorMessage(error, "Could not load Finance deposit agreements."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const state = queueState(candidate);
      if (statusFilter === "open" && state === "reserved") return false;
      if (["awaiting", "partial", "reserved"].includes(statusFilter) && state !== statusFilter) {
        return false;
      }
      if (!term) return true;
      return [
        candidate.agreement_number,
        candidate.application_number,
        candidate.customer_name,
        candidate.customer_phone,
        candidate.asset_code,
        candidate.asset_name,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [candidates, search, statusFilter]);

  const summary = useMemo(
    () => ({
      awaiting: candidates.filter((candidate) => queueState(candidate) === "awaiting").length,
      partial: candidates.filter((candidate) => queueState(candidate) === "partial").length,
      reserved: candidates.filter((candidate) => queueState(candidate) === "reserved").length,
      remaining: candidates
        .filter((candidate) => !candidate.reserved)
        .reduce((total, candidate) => total + Number(candidate.deposit_remaining || 0), 0),
    }),
    [candidates]
  );

  function openDeposit(candidate) {
    if (!selectedContextId) {
      setProblem("Choose one Finance location before recording a deposit.");
      return;
    }
    if (!canCollect) {
      setProblem(
        "Only the Finance Manager, Finance Accountant or protected System Administrator can record the opening deposit."
      );
      return;
    }
    if (candidate.reserved) {
      setProblem("The required deposit is complete and this machine is already reserved.");
      return;
    }

    try {
      setProblem("");
      setSelectedCandidate(candidate);
      setForm(initialForm(candidate));
    } catch (error) {
      setProblem(errorMessage(error, "Could not prepare a secure deposit request."));
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function recordDeposit(event) {
    event.preventDefault();
    if (!selectedCandidate || !form) return;

    const amount = Number(form.amount || 0);
    const remaining = Number(selectedCandidate.deposit_remaining || 0);
    const completesDeposit = amount + 0.01 >= remaining;
    if (!Number.isFinite(amount) || amount < 0) {
      setProblem("Enter a valid deposit amount.");
      return;
    }
    if (amount > remaining + 0.01) {
      setProblem("The amount cannot exceed the remaining required deposit.");
      return;
    }
    if (amount <= 0 && remaining > 0.01) {
      setProblem("Enter a deposit amount before reserving this machine.");
      return;
    }
    if (completesDeposit && !form.confirm_reservation) {
      setProblem("Confirm machine reservation before completing the required deposit.");
      return;
    }

    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(
        `${API}/${selectedCandidate.agreement_id}/deposit`,
        {
          ...form,
          amount,
        }
      );
      const receipt = response.data?.payment?.receipt_number;
      setSelectedCandidate(null);
      setForm(null);
      setNotice(
        `${response.data?.message || "Finance opening deposit recorded."}${
          receipt ? ` Receipt: ${receipt}.` : ""
        }`
      );
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not record the Finance opening deposit."));
    } finally {
      setSaving(false);
    }
  }

  const amountValue = Number(form?.amount || 0);
  const selectedRemaining = Number(selectedCandidate?.deposit_remaining || 0);
  const completingSelectedDeposit =
    Boolean(selectedCandidate) && amountValue + 0.01 >= selectedRemaining;

  return (
    <main className="finance-deposit">
      <section className="finance-deposit__hero">
        <div>
          <p>Finance agreement to secured equipment commitment</p>
          <h1>Collect the required deposit before reserving the machine</h1>
          <span>{locationName}</span>
        </div>
        <div className="finance-deposit__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=activation">
            Agreement activation
          </Link>
          <Link to="/equipment-installment-finance">Finance accounts</Link>
          <button type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      <section className="finance-deposit__boundary">
        <span aria-hidden="true">🏦</span>
        <div>
          <strong>Deposit first, reservation second</strong>
          <p>
            A partial deposit creates a Finance receipt but leaves the machine available and
            unreserved. Completing the required deposit and confirming reservation creates one
            Finance sale lock. This stage creates no Hire work, delivery, ownership transfer,
            installment allocation or SMS.
          </p>
        </div>
      </section>

      {problem ? <div className="finance-deposit__alert is-error">{problem}</div> : null}
      {notice ? <div className="finance-deposit__alert is-success">{notice}</div> : null}

      {!selectedContextId ? (
        <div className="finance-deposit__alert is-warning">
          Choose one Finance location before loading agreements or recording money. The
          administrator-wide location view remains read-only for this action.
        </div>
      ) : null}

      {!canCollect ? (
        <div className="finance-deposit__alert is-info">
          Your Finance role may review the queue, but only a Finance Manager or Finance
          Accountant may record deposits and reserve equipment.
        </div>
      ) : null}

      {readiness.ready === false ? (
        <section className="finance-deposit__foundation">
          <span aria-hidden="true">🏗️</span>
          <div>
            <p>Deposit foundation awaiting controlled migration</p>
            <h2>Finance deposit and reservation are not active in this database yet</h2>
            <span>
              Apply and verify the additive deposit-reservation migration after the required
              backups. Until then, this page cannot record money or reserve equipment.
            </span>
            {readiness.missing_columns?.length ? (
              <small>Missing columns: {readiness.missing_columns.join(", ")}</small>
            ) : null}
            {readiness.missing_triggers?.length ? (
              <small>Missing triggers: {readiness.missing_triggers.join(", ")}</small>
            ) : null}
          </div>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <>
          <section className="finance-deposit__metrics">
            <article>
              <span>🧾</span>
              <div>
                <small>Awaiting first deposit</small>
                <strong>{summary.awaiting}</strong>
                <p>Activated agreements with no opening receipt</p>
              </div>
            </article>
            <article>
              <span>◐</span>
              <div>
                <small>Partial deposits</small>
                <strong>{summary.partial}</strong>
                <p>Money recorded; machines remain unreserved</p>
              </div>
            </article>
            <article>
              <span>🔒</span>
              <div>
                <small>Machines reserved</small>
                <strong>{summary.reserved}</strong>
                <p>Required deposits completed and secured</p>
              </div>
            </article>
            <article>
              <span>💰</span>
              <div>
                <small>Deposit still required</small>
                <strong>{money(summary.remaining)}</strong>
                <p>Open deposit requirement across this location</p>
              </div>
            </article>
          </section>

          <section className="finance-deposit__toolbar">
            <label>
              <span>Search Finance agreements</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Agreement, application, customer or machine"
              />
            </label>
            <label>
              <span>Queue</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="open">All open deposits</option>
                <option value="awaiting">Awaiting first deposit</option>
                <option value="partial">Partial deposit</option>
                <option value="reserved">Reserved</option>
                <option value="all">All agreements</option>
              </select>
            </label>
          </section>

          {loading ? <div className="finance-deposit__loading">Loading agreements…</div> : null}

          {!loading ? (
            <section className="finance-deposit__queue" aria-label="Finance deposit queue">
              <header>
                <div>
                  <p>Opening deposit register</p>
                  <h2>{visibleCandidates.length} agreement(s)</h2>
                </div>
                <small>Finance records only · no Hire crossover</small>
              </header>

              {!visibleCandidates.length ? (
                <div className="finance-deposit__empty">
                  <span aria-hidden="true">🧾</span>
                  <h3>No matching Finance agreements</h3>
                  <p>
                    Activate an approved Finance agreement first, or choose another queue or
                    location.
                  </p>
                </div>
              ) : null}

              <div className="finance-deposit__cards">
                {visibleCandidates.map((candidate) => {
                  const state = queueState(candidate);
                  const required = Number(candidate.deposit_required || 0);
                  const received = Number(candidate.deposit_received || 0);
                  const progress = required > 0 ? Math.min((received / required) * 100, 100) : candidate.reserved ? 100 : 0;
                  return (
                    <article className="finance-deposit__card" key={candidate.agreement_id}>
                      <div className="finance-deposit__card-top">
                        <div className="finance-deposit__identity">
                          <div className="finance-deposit__image">
                            {candidate.main_image_url ? (
                              <img src={candidate.main_image_url} alt={candidate.asset_name || "Equipment"} />
                            ) : (
                              <span aria-hidden="true">🚜</span>
                            )}
                          </div>
                          <div>
                            <small>{candidate.agreement_number}</small>
                            <h3>{candidate.customer_name}</h3>
                            <p>{candidate.asset_code || "Equipment"} · {candidate.asset_name || "Machine"}</p>
                          </div>
                        </div>
                        <StatusPill value={state} />
                      </div>

                      <div className="finance-deposit__progress" aria-label={`Deposit ${progress.toFixed(0)} percent complete`}>
                        <div style={{ width: `${progress}%` }} />
                      </div>

                      <div className="finance-deposit__facts">
                        <div><span>Sale total</span><strong>{money(candidate.total_amount)}</strong></div>
                        <div><span>Deposit required</span><strong>{money(required)}</strong></div>
                        <div><span>Deposit received</span><strong>{money(received)}</strong></div>
                        <div><span>Deposit remaining</span><strong>{money(candidate.deposit_remaining)}</strong></div>
                        <div><span>Outstanding balance</span><strong>{money(candidate.outstanding_balance)}</strong></div>
                        <div><span>Machine status</span><strong>{label(candidate.asset_sale_status)}</strong></div>
                      </div>

                      <div className="finance-deposit__safeguards">
                        <span>No Hire job</span>
                        <span>No delivery</span>
                        <span>No ownership transfer</span>
                        <span>No SMS</span>
                      </div>

                      <div className="finance-deposit__card-actions">
                        {candidate.reserved ? (
                          <span className="finance-deposit__reserved-note">
                            Reserved {candidate.reservation_activated_at ? `on ${new Date(candidate.reservation_activated_at).toLocaleDateString("en-GB")}` : "after deposit completion"}
                          </span>
                        ) : canCollect ? (
                          <button className="is-primary" type="button" onClick={() => openDeposit(candidate)}>
                            {received > 0 ? "Complete deposit" : required <= 0 ? "Confirm reservation" : "Record deposit"}
                          </button>
                        ) : (
                          <span className="finance-deposit__reserved-note">Manager or accountant required</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {selectedCandidate && form ? (
        <Drawer
          title={
            Number(selectedCandidate.deposit_received || 0) > 0
              ? "Complete the opening deposit"
              : Number(selectedCandidate.deposit_required || 0) <= 0
                ? "Confirm machine reservation"
                : "Record opening deposit"
          }
          subtitle={`${selectedCandidate.agreement_number} · ${selectedCandidate.customer_name}`}
          onClose={() => {
            setSelectedCandidate(null);
            setForm(null);
          }}
        >
          <form className="finance-deposit__form" onSubmit={recordDeposit}>
            <section className="finance-deposit__review">
              <div><span>Machine</span><strong>{selectedCandidate.asset_code} · {selectedCandidate.asset_name}</strong></div>
              <div><span>Deposit required</span><strong>{money(selectedCandidate.deposit_required)}</strong></div>
              <div><span>Already received</span><strong>{money(selectedCandidate.deposit_received)}</strong></div>
              <div><span>Remaining requirement</span><strong>{money(selectedCandidate.deposit_remaining)}</strong></div>
            </section>

            <section className="finance-deposit__warning">
              <strong>{completingSelectedDeposit ? "This action will reserve the machine" : "This is a partial deposit"}</strong>
              <p>
                {completingSelectedDeposit
                  ? "After confirmation, the machine becomes unavailable to Hire and other sale agreements. No delivery or ownership transfer is created."
                  : "The receipt will be recorded, but the machine remains available and unreserved until the full required deposit is complete."}
              </p>
            </section>

            <div className="finance-deposit__form-grid">
              <Field
                title="Deposit amount"
                hint={`Maximum remaining amount: ${money(selectedCandidate.deposit_remaining)}`}
              >
                <input
                  required
                  type="number"
                  min="0"
                  max={selectedRemaining}
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => updateForm("amount", event.target.value)}
                />
              </Field>
              <Field title="Payment method">
                <select
                  required={amountValue > 0}
                  disabled={amountValue <= 0}
                  value={form.payment_method}
                  onChange={(event) => updateForm("payment_method", event.target.value)}
                >
                  {PAYMENT_METHODS.map(([value, title]) => (
                    <option key={value} value={value}>{title}</option>
                  ))}
                </select>
              </Field>
              <Field title="Payment reference">
                <input
                  value={form.reference_number}
                  onChange={(event) => updateForm("reference_number", event.target.value)}
                  placeholder="MoMo, bank or cheque reference"
                />
              </Field>
              <Field title="Finance notes" wide>
                <textarea
                  rows="4"
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                  placeholder="Record the source and any verification completed by Finance."
                />
              </Field>
            </div>

            {completingSelectedDeposit ? (
              <label className="finance-deposit__confirmation">
                <input
                  type="checkbox"
                  checked={form.confirm_reservation}
                  onChange={(event) => updateForm("confirm_reservation", event.target.checked)}
                />
                <span>
                  <strong>Reserve this exact machine for the Finance agreement</strong>
                  <small>
                    I confirm the required deposit is complete. This creates a Finance sale lock
                    only; it creates no Hire job, delivery, ownership transfer or SMS.
                  </small>
                </span>
              </label>
            ) : null}

            <div className="finance-deposit__form-actions">
              <button
                type="button"
                onClick={() => {
                  setSelectedCandidate(null);
                  setForm(null);
                }}
              >
                Cancel
              </button>
              <button className="is-primary" type="submit" disabled={saving}>
                {saving
                  ? "Recording…"
                  : completingSelectedDeposit
                    ? "Confirm deposit and reserve"
                    : "Record partial deposit"}
              </button>
            </div>
          </form>
        </Drawer>
      ) : null}
    </main>
  );
}
