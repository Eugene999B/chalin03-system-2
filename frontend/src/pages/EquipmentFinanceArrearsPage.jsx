import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceArrears.css";

const API = "/equipment-catalogue/sales/installment-command";

const QUEUES = [
  ["all", "All accounts"],
  ["due_today", "Due today"],
  ["overdue", "Overdue"],
  ["broken_promises", "Broken promises"],
  ["follow_up_due", "Follow-up due"],
  ["never_contacted", "Never contacted"],
  ["high_risk", "High risk"],
];

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["active", "Active"],
  ["due_soon", "Due soon"],
  ["payment_due", "Payment due"],
  ["overdue", "Overdue"],
  ["defaulted", "Defaulted"],
  ["completed", "Completed"],
];

const RISK_OPTIONS = [
  ["", "All risk bands"],
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

const AGING_OPTIONS = [
  ["", "All aging"],
  ["current", "Current"],
  ["1_7_days", "1–7 days"],
  ["8_30_days", "8–30 days"],
  ["31_60_days", "31–60 days"],
  ["61_90_days", "61–90 days"],
  ["over_90_days", "Over 90 days"],
];

const TABS = [
  ["overview", "Overview"],
  ["schedule", "Schedule"],
  ["payments", "Payments"],
  ["follow_ups", "Follow-ups & promises"],
];

const emptyFollowUp = {
  follow_up_type: "phone_call",
  outcome: "reached",
  promise_date: "",
  promise_amount: "",
  next_action_date: "",
  notes: "",
};

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value, includeTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Metric({ title, value, detail, tone = "neutral" }) {
  return (
    <article className={`finance-arrears__metric is-${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Pill({ value, kind = "status" }) {
  return (
    <span className={`finance-arrears__pill is-${kind}-${String(value || "none")}`}>
      {label(value)}
    </span>
  );
}

function Info({ title, value, wide = false }) {
  return (
    <div className={`finance-arrears__info ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="finance-arrears__empty">
      <span aria-hidden="true">📋</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function AccountCard({ account, onOpen, onDocument, busyDocument }) {
  const outstanding = Number(account.outstanding_balance || 0);
  const overdue = Number(account.overdue_amount || 0);

  return (
    <article className="finance-arrears__account-card">
      <header>
        <div>
          <small>{account.agreement_number}</small>
          <h3>{account.customer_name_snapshot || account.customer_name}</h3>
          <p>
            {account.asset_code_snapshot || account.asset_code} ·{" "}
            {account.asset_name_snapshot || account.asset_name}
          </p>
        </div>
        <div className="finance-arrears__pill-row">
          <Pill value={account.risk_band} kind="risk" />
          <Pill value={account.agreement_status} />
        </div>
      </header>

      <div className="finance-arrears__money-grid">
        <div>
          <span>Outstanding</span>
          <strong>{money(outstanding)}</strong>
        </div>
        <div className={overdue > 0 ? "is-danger" : ""}>
          <span>Overdue</span>
          <strong>{money(overdue)}</strong>
        </div>
        <div>
          <span>Next due</span>
          <strong>{dateLabel(account.next_due_date)}</strong>
        </div>
        <div>
          <span>Days past due</span>
          <strong>{Number(account.days_past_due || 0)}</strong>
        </div>
      </div>

      <div className="finance-arrears__evidence-row">
        <div>
          <span>Promise</span>
          <Pill value={account.promise_status} kind="promise" />
          {account.promise_date ? (
            <small>
              {dateLabel(account.promise_date)} · {money(account.promise_amount)}
            </small>
          ) : (
            <small>No promise recorded</small>
          )}
        </div>
        <div>
          <span>Next action</span>
          <Pill value={account.next_action_status} kind="action" />
          <small>{dateLabel(account.next_action_date)}</small>
        </div>
      </div>

      <p className="finance-arrears__recommended">
        <strong>Recommended action:</strong> {account.recommended_action}
      </p>

      <footer>
        <button type="button" onClick={() => onOpen(account.id)}>
          Open collection account
        </button>
        <button
          type="button"
          className="is-secondary"
          onClick={() => onDocument(account.id, "statement")}
          disabled={busyDocument === `${account.id}:statement`}
        >
          {busyDocument === `${account.id}:statement` ? "Preparing…" : "Statement"}
        </button>
        {overdue > 0 ? (
          <button
            type="button"
            className="is-warning"
            onClick={() => onDocument(account.id, "overdue")}
            disabled={busyDocument === `${account.id}:overdue`}
          >
            {busyDocument === `${account.id}:overdue`
              ? "Preparing…"
              : "Overdue notice"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function ScheduleTable({ rows = [] }) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No installment schedule"
        detail="This account does not have schedule rows available."
      />
    );
  }

  return (
    <div className="finance-arrears__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Installment</th>
            <th>Due date</th>
            <th>Scheduled</th>
            <th>Paid</th>
            <th>Charges</th>
            <th>Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const remaining = Math.max(
              Number(row.scheduled_amount || 0) +
                Number(row.late_charge_amount || 0) -
                Number(row.waived_charge_amount || 0) -
                Number(row.amount_paid || 0),
              0
            );
            return (
              <tr key={row.id}>
                <td>#{row.sequence_number}</td>
                <td>{dateLabel(row.due_date)}</td>
                <td>{money(row.scheduled_amount)}</td>
                <td>{money(row.amount_paid)}</td>
                <td>
                  {money(
                    Number(row.late_charge_amount || 0) -
                      Number(row.waived_charge_amount || 0)
                  )}
                </td>
                <td>{money(remaining)}</td>
                <td>
                  <Pill value={row.schedule_status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTable({ rows = [] }) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No Finance payments"
        detail="No collection receipt is recorded for this agreement."
      />
    );
  }

  return (
    <div className="finance-arrears__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Date</th>
            <th>Category</th>
            <th>Method</th>
            <th>Reference</th>
            <th>Amount</th>
            <th>Received by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((payment) => (
            <tr key={payment.id} className={payment.is_voided ? "is-voided" : ""}>
              <td>
                <strong>{payment.receipt_number}</strong>
                {payment.is_voided ? <small>Voided</small> : null}
              </td>
              <td>{dateLabel(payment.payment_date, true)}</td>
              <td>{label(payment.payment_category)}</td>
              <td>{label(payment.payment_method)}</td>
              <td>{payment.reference_number || "—"}</td>
              <td>{money(payment.amount)}</td>
              <td>{payment.received_by_name || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FollowUpForm({
  form,
  setForm,
  options,
  onSubmit,
  busy,
  title = "Record collection follow-up",
  submitLabel = "Save follow-up evidence",
  correctionReason,
  setCorrectionReason,
  onCancel,
}) {
  const promised = form.outcome === "promised_payment";
  return (
    <form className="finance-arrears__form" onSubmit={onSubmit}>
      <header>
        <div>
          <small>Append-only Finance evidence</small>
          <h3>{title}</h3>
        </div>
        {onCancel ? (
          <button type="button" className="is-text" onClick={onCancel}>
            Cancel correction
          </button>
        ) : null}
      </header>

      <div className="finance-arrears__form-grid">
        <label>
          Follow-up type
          <select
            value={form.follow_up_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                follow_up_type: event.target.value,
              }))
            }
          >
            {(options.follow_up_types || []).map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Outcome
          <select
            value={form.outcome}
            onChange={(event) =>
              setForm((current) => ({ ...current, outcome: event.target.value }))
            }
          >
            {(options.follow_up_outcomes || []).map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Promise date
          <input
            type="date"
            value={form.promise_date}
            required={promised}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                promise_date: event.target.value,
              }))
            }
          />
        </label>

        <label>
          Promise amount
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.promise_amount}
            required={promised}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                promise_amount: event.target.value,
              }))
            }
          />
        </label>

        <label>
          Next action date
          <input
            type="date"
            value={form.next_action_date}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                next_action_date: event.target.value,
              }))
            }
          />
        </label>

        {setCorrectionReason ? (
          <label>
            Correction reason
            <input
              type="text"
              minLength="5"
              required
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Explain why the saved evidence needs correction"
            />
          </label>
        ) : null}

        <label className="is-wide">
          Collection note
          <textarea
            rows="4"
            minLength="3"
            required
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="Record what happened, what the customer said and the agreed next action."
          />
        </label>
      </div>

      <p className="finance-arrears__form-notice">
        This action records evidence only. It cannot change balances, schedules,
        receipts, Hire jobs or automatic messaging.
      </p>

      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function FollowUpTimeline({ rows, canManage, onCorrect }) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No follow-up evidence"
        detail="Record the first call, visit, promise or account note for this Finance agreement."
      />
    );
  }

  return (
    <div className="finance-arrears__timeline">
      {rows.map((entry) => (
        <article key={entry.id}>
          <span className="finance-arrears__timeline-dot" aria-hidden="true" />
          <div>
            <header>
              <div>
                <strong>{label(entry.metadata?.follow_up_type)}</strong>
                <small>
                  {dateLabel(entry.created_at, true)} · {entry.recorded_by_name}
                </small>
              </div>
              <div className="finance-arrears__pill-row">
                <Pill value={entry.metadata?.outcome || entry.outcome} />
                {entry.corrected_at ? <Pill value="corrected" kind="action" /> : null}
              </div>
            </header>
            <p>{entry.metadata?.notes || entry.details}</p>
            <dl>
              <div>
                <dt>Promise</dt>
                <dd>
                  {entry.metadata?.promise_date
                    ? `${dateLabel(entry.metadata.promise_date)} · ${money(
                        entry.metadata.promise_amount
                      )}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{dateLabel(entry.metadata?.next_action_date)}</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>{label(entry.metadata?.outcome || entry.outcome)}</dd>
              </div>
            </dl>
            {entry.corrected_at ? (
              <aside>
                Corrected {dateLabel(entry.corrected_at, true)} by{" "}
                {entry.corrected_by_name}. Reason: {entry.correction_reason || "—"}.
                The original record remains preserved.
              </aside>
            ) : null}
            {canManage ? (
              <button type="button" className="is-text" onClick={() => onCorrect(entry)}>
                Correct this evidence
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function AccountDrawer({
  detail,
  tab,
  setTab,
  loading,
  onClose,
  canManage,
  followUp,
  setFollowUp,
  submitFollowUp,
  correction,
  setCorrection,
  correctionReason,
  setCorrectionReason,
  submitCorrection,
  busy,
  downloadDocument,
  busyDocument,
}) {
  const account = detail?.account;

  return (
    <div
      className="finance-arrears__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="finance-arrears__drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Finance arrears collection account"
      >
        <header className="finance-arrears__drawer-header">
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{account?.customer_name_snapshot || account?.customer_name || "Account"}</h2>
            <span>
              {account?.agreement_number || "Loading"}
              {account?.customer_phone_snapshot || account?.customer_phone
                ? ` · ${account.customer_phone_snapshot || account.customer_phone}`
                : ""}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close collection account">
            ×
          </button>
        </header>

        {loading ? (
          <div className="finance-arrears__drawer-loading">Loading Finance account…</div>
        ) : account ? (
          <>
            <div className="finance-arrears__drawer-actions">
              <button
                type="button"
                onClick={() => downloadDocument(account.id, "statement")}
                disabled={busyDocument === `${account.id}:statement`}
              >
                Download statement
              </button>
              {Number(account.overdue_amount || 0) > 0 ? (
                <button
                  type="button"
                  className="is-warning"
                  onClick={() => downloadDocument(account.id, "overdue")}
                  disabled={busyDocument === `${account.id}:overdue`}
                >
                  Download overdue notice
                </button>
              ) : null}
            </div>

            <div className="finance-arrears__drawer-summary">
              <div>
                <span>Outstanding</span>
                <strong>{money(account.outstanding_balance)}</strong>
              </div>
              <div>
                <span>Overdue</span>
                <strong>{money(account.overdue_amount)}</strong>
              </div>
              <div>
                <span>Promise</span>
                <Pill value={account.promise_status} kind="promise" />
              </div>
              <div>
                <span>Next action</span>
                <Pill value={account.next_action_status} kind="action" />
              </div>
            </div>

            <nav className="finance-arrears__tabs" aria-label="Collection account sections">
              {TABS.map(([value, title]) => (
                <button
                  type="button"
                  key={value}
                  className={tab === value ? "is-active" : ""}
                  onClick={() => setTab(value)}
                >
                  {title}
                </button>
              ))}
            </nav>

            <div className="finance-arrears__drawer-body">
              {tab === "overview" ? (
                <div className="finance-arrears__overview">
                  <section>
                    <header>
                      <span aria-hidden="true">👤</span>
                      <div>
                        <small>Customer and equipment</small>
                        <h3>Account identity</h3>
                      </div>
                    </header>
                    <div className="finance-arrears__info-grid">
                      <Info
                        title="Customer"
                        value={account.customer_name_snapshot || account.customer_name}
                      />
                      <Info
                        title="Phone"
                        value={account.customer_phone_snapshot || account.customer_phone}
                      />
                      <Info title="Email" value={account.customer_email} />
                      <Info
                        title="Address"
                        value={account.customer_location_snapshot || account.customer_address}
                      />
                      <Info
                        title="Equipment"
                        value={`${account.asset_code_snapshot || account.asset_code} · ${
                          account.asset_name_snapshot || account.asset_name
                        }`}
                      />
                      <Info title="Serial number" value={account.serial_number_snapshot || account.serial_number} />
                      <Info title="Finance origin" value={account.finance_location_name || account.hire_location_name} />
                      <Info title="Agreement status" value={label(account.agreement_status)} />
                    </div>
                  </section>

                  <section>
                    <header>
                      <span aria-hidden="true">⚠️</span>
                      <div>
                        <small>Collections intelligence</small>
                        <h3>Risk and action</h3>
                      </div>
                    </header>
                    <div className="finance-arrears__info-grid">
                      <Info title="Risk band" value={label(account.risk_band)} />
                      <Info title="Risk score" value={String(account.risk_score || 0)} />
                      <Info title="Aging bucket" value={label(account.aging_bucket)} />
                      <Info title="Days past due" value={String(account.days_past_due || 0)} />
                      <Info title="Last payment" value={dateLabel(account.last_payment_at)} />
                      <Info title="Next due date" value={dateLabel(account.next_due_date)} />
                      <Info title="Promise date" value={dateLabel(account.promise_date)} />
                      <Info title="Promise amount" value={money(account.promise_amount)} />
                      <Info
                        title="Recommended action"
                        value={account.recommended_action}
                        wide
                      />
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "schedule" ? <ScheduleTable rows={detail.schedule || []} /> : null}
              {tab === "payments" ? <PaymentsTable rows={detail.payments || []} /> : null}

              {tab === "follow_ups" ? (
                <div className="finance-arrears__follow-up-layout">
                  <section>
                    <header className="finance-arrears__section-header">
                      <div>
                        <small>Immutable collection history</small>
                        <h3>Follow-up timeline</h3>
                      </div>
                      <Pill value={`${detail.follow_ups?.length || 0}_records`} />
                    </header>
                    <FollowUpTimeline
                      rows={detail.follow_ups || []}
                      canManage={canManage}
                      onCorrect={(entry) => {
                        setCorrection({
                          id: entry.id,
                          follow_up_type: entry.metadata?.follow_up_type || "phone_call",
                          outcome: entry.metadata?.outcome || entry.outcome || "reached",
                          promise_date: String(entry.metadata?.promise_date || "").slice(0, 10),
                          promise_amount: entry.metadata?.promise_amount || "",
                          next_action_date: String(
                            entry.metadata?.next_action_date || ""
                          ).slice(0, 10),
                          notes: entry.metadata?.notes || entry.details || "",
                        });
                        setCorrectionReason("");
                      }}
                    />
                  </section>

                  {canManage ? (
                    <section>
                      {correction ? (
                        <FollowUpForm
                          form={correction}
                          setForm={setCorrection}
                          options={detail.options || {}}
                          onSubmit={submitCorrection}
                          busy={busy}
                          title={`Correct follow-up #${correction.id}`}
                          submitLabel="Record append-only correction"
                          correctionReason={correctionReason}
                          setCorrectionReason={setCorrectionReason}
                          onCancel={() => {
                            setCorrection(null);
                            setCorrectionReason("");
                          }}
                        />
                      ) : (
                        <FollowUpForm
                          form={followUp}
                          setForm={setFollowUp}
                          options={detail.options || {}}
                          onSubmit={submitFollowUp}
                          busy={busy}
                        />
                      )}
                    </section>
                  ) : (
                    <aside className="finance-arrears__read-only">
                      This account is read-only for your Finance role. A Finance Manager,
                      Collections Officer, Credit Officer or Finance Accountant records
                      follow-up evidence.
                    </aside>
                  )}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            title="Account unavailable"
            detail="Close the drawer and open the account again."
          />
        )}
      </section>
    </div>
  );
}

export default function EquipmentFinanceArrearsPage() {
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.workspace_role || user?.access_role || user?.role || "")
    .trim()
    .toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["finance_manager", "credit_officer", "collections_officer", "finance_accountant"].includes(
      role
    ) ||
    Boolean(user?.is_original_system_administrator);

  const [filters, setFilters] = useState({
    queue: "all",
    search: "",
    status: "",
    risk: "",
    aging: "",
  });
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [followUp, setFollowUp] = useState(emptyFollowUp);
  const [correction, setCorrection] = useState(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyDocument, setBusyDocument] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const activeQueueTitle = useMemo(
    () => QUEUES.find(([value]) => value === filters.queue)?.[1] || "All accounts",
    [filters.queue]
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(`${API}/collections`, {
        params: { ...filters, limit: 500 },
      });
      setAccounts(response.data?.accounts || []);
      setSummary(response.data?.summary || {});
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load Finance arrears control."));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(loadQueue, filters.search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue, filters.search]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function openAccount(agreementId) {
    setDrawerLoading(true);
    setDetail({ account: { id: agreementId } });
    setTab("overview");
    setError("");
    setCorrection(null);
    setCorrectionReason("");
    try {
      const response = await axiosClient.get(`${API}/agreements/${agreementId}`);
      setDetail(response.data || null);
      setFollowUp({
        ...emptyFollowUp,
        next_action_date: response.data?.account?.next_action_date || "",
      });
    } catch (requestError) {
      setDetail(null);
      setError(errorMessage(requestError, "Could not load the Finance collection account."));
    } finally {
      setDrawerLoading(false);
    }
  }

  async function submitFollowUp(event) {
    event.preventDefault();
    const agreementId = detail?.account?.id;
    if (!agreementId) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `${API}/agreements/${agreementId}/follow-ups`,
        followUp
      );
      setDetail(response.data || null);
      setFollowUp(emptyFollowUp);
      setMessage(response.data?.message || "Finance follow-up recorded.");
      await loadQueue();
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not record the Finance follow-up."));
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(event) {
    event.preventDefault();
    const agreementId = detail?.account?.id;
    if (!agreementId || !correction?.id) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `${API}/agreements/${agreementId}/follow-ups/${correction.id}/corrections`,
        {
          correction_reason: correctionReason,
          corrected_follow_up: {
            follow_up_type: correction.follow_up_type,
            outcome: correction.outcome,
            promise_date: correction.promise_date,
            promise_amount: correction.promise_amount,
            next_action_date: correction.next_action_date,
            notes: correction.notes,
          },
        }
      );
      setDetail(response.data || null);
      setCorrection(null);
      setCorrectionReason("");
      setMessage(
        response.data?.message ||
          "Correction recorded and the original evidence preserved."
      );
      await loadQueue();
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not record the correction."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadDocument(agreementId, type) {
    const key = `${agreementId}:${type}`;
    setBusyDocument(key);
    setError("");
    try {
      const response = await axiosClient.get(
        `/equipment-catalogue/sales/agreements/${agreementId}/documents/${type}.pdf`,
        { responseType: "blob" }
      );
      const disposition = String(response.headers?.["content-disposition"] || "");
      const matchedName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const filename =
        matchedName || `finance-${type}-${String(agreementId)}.pdf`;
      const href = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(href);
    } catch (requestError) {
      setError(errorMessage(requestError, `Could not download the ${type} PDF.`));
    } finally {
      setBusyDocument("");
    }
  }

  return (
    <main className="finance-arrears">
      <section className="finance-arrears__hero">
        <div>
          <p>Piece 4B · Company-wide Finance control</p>
          <h1>Arrears & Collections Control</h1>
          <span>
            Due-today work, overdue aging, promises to pay, next actions,
            statements and append-only corrections.
          </span>
        </div>
        <aside>
          <strong>Finance-only evidence</strong>
          <p>
            This centre does not create Hire work, change balances, rewrite
            receipts or send automatic SMS.
          </p>
        </aside>
      </section>

      {message ? <div className="finance-arrears__message">{message}</div> : null}
      {error ? <div className="finance-arrears__error">{error}</div> : null}

      <section className="finance-arrears__metrics">
        <Metric
          title="Outstanding portfolio"
          value={money(summary.outstanding_amount)}
          detail={`${Number(summary.accounts || 0)} approved Finance accounts`}
        />
        <Metric
          title="Overdue exposure"
          value={money(summary.overdue_amount)}
          detail={`${Number(summary.overdue_accounts || 0)} overdue accounts`}
          tone="danger"
        />
        <Metric
          title="Due today"
          value={Number(summary.due_today || 0)}
          detail={`${Number(summary.promises_due_today || 0)} promises also due`}
          tone="warning"
        />
        <Metric
          title="Broken promises"
          value={Number(summary.broken_promises || 0)}
          detail="Requires immediate customer review"
          tone="danger"
        />
        <Metric
          title="Follow-ups due"
          value={Number(summary.follow_ups_due || 0)}
          detail="Due today or already overdue"
          tone="warning"
        />
        <Metric
          title="Never contacted"
          value={Number(summary.never_contacted || 0)}
          detail={`${Number(summary.high_risk || 0)} high or critical risk`}
        />
      </section>

      <section className="finance-arrears__queues">
        {QUEUES.map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={filters.queue === value ? "is-active" : ""}
            onClick={() => setFilters((current) => ({ ...current, queue: value }))}
          >
            {title}
            <small>
              {value === "due_today"
                ? summary.due_today
                : value === "overdue"
                  ? summary.overdue_accounts
                  : value === "broken_promises"
                    ? summary.broken_promises
                    : value === "follow_up_due"
                      ? summary.follow_ups_due
                      : value === "never_contacted"
                        ? summary.never_contacted
                        : value === "high_risk"
                          ? summary.high_risk
                          : summary.accounts}
            </small>
          </button>
        ))}
      </section>

      <section className="finance-arrears__control">
        <header>
          <div>
            <p>Collections work queue</p>
            <h2>{activeQueueTitle}</h2>
          </div>
          <button type="button" className="is-secondary" onClick={loadQueue}>
            Refresh evidence
          </button>
        </header>

        <div className="finance-arrears__filters">
          <label className="is-search">
            Search
            <input
              type="search"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Customer, phone, agreement or equipment"
            />
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
            >
              {STATUS_OPTIONS.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Risk
            <select
              value={filters.risk}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  risk: event.target.value,
                }))
              }
            >
              {RISK_OPTIONS.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aging
            <select
              value={filters.aging}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  aging: event.target.value,
                }))
              }
            >
              {AGING_OPTIONS.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <div className="finance-arrears__loading">Loading Finance collection evidence…</div>
      ) : accounts.length ? (
        <section className="finance-arrears__account-grid">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onOpen={openAccount}
              onDocument={downloadDocument}
              busyDocument={busyDocument}
            />
          ))}
        </section>
      ) : (
        <EmptyState
          title="No accounts in this queue"
          detail="Change the queue or filters. No financial record has been altered."
        />
      )}

      {detail ? (
        <AccountDrawer
          detail={detail}
          tab={tab}
          setTab={setTab}
          loading={drawerLoading}
          onClose={() => setDetail(null)}
          canManage={canManage}
          followUp={followUp}
          setFollowUp={setFollowUp}
          submitFollowUp={submitFollowUp}
          correction={correction}
          setCorrection={setCorrection}
          correctionReason={correctionReason}
          setCorrectionReason={setCorrectionReason}
          submitCorrection={submitCorrection}
          busy={busy}
          downloadDocument={downloadDocument}
          busyDocument={busyDocument}
        />
      ) : null}
    </main>
  );
}
