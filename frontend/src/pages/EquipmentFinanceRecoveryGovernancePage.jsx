import { useCallback, useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import {
  equipmentWorkspaceRole,
  isEquipmentAdministrator,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentFinanceRecoveryGovernance.css";

const API = "/equipment-catalogue/sales/installment-command/governance";

const QUEUES = [
  ["all", "All governed accounts"],
  ["pending_reschedules", "Pending reschedules"],
  ["pending_defaults", "Pending defaults"],
  ["eligible_for_default", "Eligible for default review"],
  ["defaulted", "Defaulted accounts"],
  ["recovery_due", "Recovery follow-up due"],
  ["recent_reschedules", "Rescheduled accounts"],
];

const RECOVERY_ACTIONS = [
  ["customer_demand", "Customer demand"],
  ["guarantor_demand", "Guarantor demand"],
  ["settlement_review", "Settlement review"],
  ["voluntary_surrender_review", "Voluntary surrender review"],
  ["repossession_review", "Repossession review"],
  ["legal_referral", "Legal referral"],
  ["asset_condition_check", "Asset condition check"],
  ["recovery_note", "Recovery note"],
];

const EMPTY_RESCHEDULE = {
  payment_frequency: "monthly",
  installment_count: 6,
  first_due_date: "",
  customer_consent_reference: "",
  affordability_notes: "",
  reason: "",
};
const EMPTY_DEFAULT = {
  reason: "",
  evidence_reference: "",
  customer_demand_summary: "",
  guarantor_contact_summary: "",
};
const EMPTY_DECISION = { decision: "approve", reason: "" };
const EMPTY_RECOVERY = {
  action_type: "customer_demand",
  notes: "",
  next_action_date: "",
  evidence_reference: "",
  contact_person: "",
  contact_phone: "",
  action_location: "",
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

function addPeriod(dateValue, frequency, periods) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + periods * 7);
  else if (frequency === "fortnightly") date.setUTCDate(date.getUTCDate() + periods * 14);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + periods);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

function buildPreview(total, countValue, firstDueDate, frequency) {
  const count = Math.max(1, Math.min(Number(countValue) || 1, 60));
  const totalCents = Math.round(Number(total || 0) * 100);
  const baseCents = Math.floor(totalCents / count);
  let assigned = 0;
  return Array.from({ length: count }, (_, index) => {
    const cents = index === count - 1 ? totalCents - assigned : baseCents;
    assigned += cents;
    return {
      sequence: index + 1,
      due_date: addPeriod(firstDueDate, frequency, index),
      amount: cents / 100,
    };
  });
}

function Pill({ value, tone = "neutral" }) {
  return (
    <span className={`finance-governance__pill is-${tone} is-${String(value || "none")}`}>
      {label(value)}
    </span>
  );
}

function Metric({ title, value, detail, tone = "neutral" }) {
  return (
    <article className={`finance-governance__metric is-${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Empty({ title, detail }) {
  return (
    <div className="finance-governance__empty">
      <span aria-hidden="true">🛡️</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function AccountCard({ account, onOpen }) {
  return (
    <article className="finance-governance__card">
      <header>
        <div>
          <small>{account.agreement_number}</small>
          <h3>{account.customer_name_snapshot || account.customer_name}</h3>
          <p>
            {account.asset_code_snapshot || account.asset_code} ·{" "}
            {account.asset_name_snapshot || account.asset_name}
          </p>
        </div>
        <div className="finance-governance__pill-row">
          <Pill value={account.governance_status} tone="governance" />
          <Pill value={account.agreement_status} tone="status" />
        </div>
      </header>
      <div className="finance-governance__figures">
        <div><span>Outstanding</span><strong>{money(account.outstanding_balance)}</strong></div>
        <div className={Number(account.overdue_amount || 0) > 0 ? "is-danger" : ""}>
          <span>Overdue</span><strong>{money(account.overdue_amount)}</strong>
        </div>
        <div><span>Days past due</span><strong>{Number(account.days_past_due || 0)}</strong></div>
        <div><span>Next due</span><strong>{dateLabel(account.next_due_date)}</strong></div>
      </div>
      <div className="finance-governance__signals">
        <div>
          <span>Reschedule review</span>
          <strong>
            {account.pending_reschedule_request
              ? `Pending #${account.pending_reschedule_request.id}`
              : account.latest_approved_reschedule
                ? `Approved ${dateLabel(account.latest_approved_reschedule.created_at)}`
                : "None"}
          </strong>
        </div>
        <div>
          <span>Default review</span>
          <strong>
            {account.pending_default_request
              ? `Pending #${account.pending_default_request.id}`
              : account.agreement_status === "defaulted"
                ? "Default declared"
                : account.eligible_for_default
                  ? "Eligible"
                  : "Not eligible"}
          </strong>
        </div>
        <div>
          <span>Recovery follow-up</span>
          <strong>{label(account.recovery_next_action_status)}</strong>
          <small>{dateLabel(account.recovery_next_action_date)}</small>
        </div>
      </div>
      <footer>
        <button type="button" onClick={() => onOpen(account.id)}>Open governance file</button>
      </footer>
    </article>
  );
}

function Schedule({ rows = [] }) {
  if (!rows.length) {
    return <Empty title="No schedule evidence" detail="No installment rows are available." />;
  }
  return (
    <div className="finance-governance__table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Due</th><th>Scheduled</th><th>Paid</th><th>Remaining</th><th>Status</th></tr>
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
                <td>{row.sequence_number}</td>
                <td>{dateLabel(row.due_date)}</td>
                <td>{money(row.scheduled_amount)}</td>
                <td>{money(row.amount_paid)}</td>
                <td>{money(remaining)}</td>
                <td><Pill value={row.schedule_status} tone="status" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ events = [] }) {
  if (!events.length) {
    return (
      <Empty
        title="No governance history"
        detail="Requests, decisions and recovery actions will appear here without overwriting earlier evidence."
      />
    );
  }
  return (
    <div className="finance-governance__timeline">
      {events.map((event) => (
        <article key={event.id}>
          <div className="finance-governance__timeline-marker" />
          <header>
            <div>
              <strong>{label(event.action)}</strong>
              <span>#{event.id} · {dateLabel(event.created_at, true)}</span>
            </div>
            <Pill value={event.outcome} tone="governance" />
          </header>
          <p>{event.details}</p>
          <small>Recorded by {event.recorded_by_name || "System"}</small>
          {event.metadata?.decision_reason ? (
            <blockquote>{event.metadata.decision_reason}</blockquote>
          ) : null}
          {event.metadata?.next_action_date ? (
            <small>Next action: {dateLabel(event.metadata.next_action_date)}</small>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default function EquipmentFinanceRecoveryGovernancePage() {
  const { user } = useAuth();
  const role = equipmentWorkspaceRole(user);
  const administrator = isEquipmentAdministrator(user);
  const canPrepare =
    administrator ||
    ["finance_manager", "finance_accountant", "collections_officer", "credit_officer"].includes(role);
  const canDecide = administrator || role === "finance_manager";
  const canRecover =
    administrator ||
    ["finance_manager", "finance_accountant", "collections_officer"].includes(role);

  const [queue, setQueue] = useState("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState({ accounts: [], summary: {}, options: {}, policy: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("overview");
  const [reschedule, setReschedule] = useState(EMPTY_RESCHEDULE);
  const [defaultRequest, setDefaultRequest] = useState(EMPTY_DEFAULT);
  const [decision, setDecision] = useState(EMPTY_DECISION);
  const [recovery, setRecovery] = useState(EMPTY_RECOVERY);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(API, {
        params: { queue, search: search.trim(), limit: 500 },
      });
      setData(response.data || { accounts: [], summary: {} });
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load Finance governance accounts."));
    } finally {
      setLoading(false);
    }
  }, [queue, search]);

  useEffect(() => {
    const timer = window.setTimeout(loadList, 180);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  async function openAccount(agreementId, preserveTab = false) {
    setSelectedLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(`${API}/agreements/${agreementId}`);
      setSelected(response.data || null);
      if (!preserveTab) setTab("overview");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not open the governance file."));
    } finally {
      setSelectedLoading(false);
    }
  }

  async function refreshSelected() {
    const agreementId = selected?.account?.id;
    if (!agreementId) return;
    await Promise.all([openAccount(agreementId, true), loadList()]);
  }

  async function submit(path, payload, busyKey, successText) {
    setBusy(busyKey);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(path, payload);
      setMessage(response.data?.message || successText);
      await refreshSelected();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError, "The Finance governance action failed."));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function handleReschedule(event) {
    event.preventDefault();
    if (!selected?.account?.id) return;
    const done = await submit(
      `${API}/agreements/${selected.account.id}/reschedule-requests`,
      reschedule,
      "reschedule",
      "Reschedule request recorded."
    );
    if (done) setReschedule(EMPTY_RESCHEDULE);
  }

  async function handleDefault(event) {
    event.preventDefault();
    if (!selected?.account?.id) return;
    const done = await submit(
      `${API}/agreements/${selected.account.id}/default-requests`,
      defaultRequest,
      "default",
      "Default review request recorded."
    );
    if (done) setDefaultRequest(EMPTY_DEFAULT);
  }

  async function handleDecision(event, requestId) {
    event.preventDefault();
    const done = await submit(
      `${API}/requests/${requestId}/decisions`,
      decision,
      `decision:${requestId}`,
      "Governance decision recorded."
    );
    if (done) setDecision(EMPTY_DECISION);
  }

  async function handleRecovery(event) {
    event.preventDefault();
    if (!selected?.account?.id) return;
    const done = await submit(
      `${API}/agreements/${selected.account.id}/recovery-actions`,
      recovery,
      "recovery",
      "Recovery action recorded."
    );
    if (done) setRecovery(EMPTY_RECOVERY);
  }

  const summary = data.summary || {};
  const account = selected?.account;
  const pendingRequests =
    selected?.governance?.requests?.filter(
      (request) => request.request_status === "pending"
    ) || [];
  const proposalPreview = account
    ? buildPreview(
        account.outstanding_balance,
        reschedule.installment_count,
        reschedule.first_due_date,
        reschedule.payment_frequency
      )
    : [];

  return (
    <main className="finance-governance">
      <section className="finance-governance__hero">
        <div>
          <span className="finance-governance__eyebrow">Piece 4C · Independent Finance control</span>
          <h1>Rescheduling, Default & Recovery Governance</h1>
          <p>
            Prepare controlled account changes, require a different Finance Manager to decide them,
            and preserve every request, decision and recovery action in the protected ledger.
          </p>
        </div>
        <aside>
          <strong>Company-wide Finance</strong>
          <span>No Hire location selection</span>
          <span>No automatic SMS or WhatsApp</span>
          <span>No Hire, payment, balance or fleet recovery shortcut</span>
        </aside>
      </section>

      {message ? <div className="finance-governance__notice is-success">{message}</div> : null}
      {error ? <div className="finance-governance__notice is-error">{error}</div> : null}

      <section className="finance-governance__metrics">
        <Metric title="Pending reschedules" value={summary.pending_reschedules || 0} detail="Awaiting independent decision" tone="warning" />
        <Metric title="Pending defaults" value={summary.pending_defaults || 0} detail="Status has not changed" tone="danger" />
        <Metric title="Default eligible" value={summary.eligible_for_default || 0} detail={`At least ${data.options?.minimum_default_days || 30} days past due`} tone="danger" />
        <Metric title="Defaulted accounts" value={summary.defaulted_accounts || 0} detail="Recovery governance active" tone="critical" />
        <Metric title="Recovery due" value={summary.recovery_actions_due || 0} detail="Next action today or overdue" tone="warning" />
        <Metric title="Governed exposure" value={money(summary.outstanding_amount)} detail="Outstanding Finance balance" />
      </section>

      <section className="finance-governance__controls">
        <label>
          <span>Search Finance accounts</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, agreement, phone or machine" />
        </label>
        <label>
          <span>Governance queue</span>
          <select value={queue} onChange={(event) => setQueue(event.target.value)}>
            {QUEUES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <button type="button" className="is-secondary" onClick={loadList} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh governance"}
        </button>
      </section>

      <section className="finance-governance__list-head">
        <div>
          <h2>{QUEUES.find(([value]) => value === queue)?.[1]}</h2>
          <p>{data.count || 0} account{Number(data.count || 0) === 1 ? "" : "s"}</p>
        </div>
        <div className="finance-governance__legend">
          <span><i className="is-request" /> Request</span>
          <span><i className="is-decision" /> Independent decision</span>
          <span><i className="is-recovery" /> Recovery evidence</span>
        </div>
      </section>

      {loading ? (
        <div className="finance-governance__loading">Loading protected Finance governance…</div>
      ) : data.accounts?.length ? (
        <section className="finance-governance__grid">
          {data.accounts.map((item) => (
            <AccountCard key={item.id} account={item} onOpen={openAccount} />
          ))}
        </section>
      ) : (
        <Empty title="No accounts in this queue" detail="Change the queue or search to review other Finance accounts." />
      )}

      {selected || selectedLoading ? (
        <div
          className="finance-governance__backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setSelected(null);
          }}
        >
          <section className="finance-governance__drawer" role="dialog" aria-modal="true" aria-label="Finance governance file">
            {selectedLoading && !selected ? (
              <div className="finance-governance__loading">Opening governance evidence…</div>
            ) : account ? (
              <>
                <header className="finance-governance__drawer-head">
                  <div>
                    <small>{account.agreement_number}</small>
                    <h2>{account.customer_name_snapshot || account.customer_name}</h2>
                    <p>{account.asset_code_snapshot || account.asset_code} · {account.asset_name_snapshot || account.asset_name}</p>
                  </div>
                  <div className="finance-governance__drawer-actions">
                    <Pill value={account.governance_status} tone="governance" />
                    <button type="button" aria-label="Close" onClick={() => !busy && setSelected(null)}>×</button>
                  </div>
                </header>

                <nav className="finance-governance__tabs">
                  {["overview", "schedule", "requests", "recovery", "timeline"].map((value) => (
                    <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
                      {label(value)}
                    </button>
                  ))}
                </nav>

                <div className="finance-governance__drawer-body">
                  {tab === "overview" ? (
                    <div className="finance-governance__overview">
                      <section className="finance-governance__account-grid">
                        <div><span>Agreement status</span><strong>{label(account.agreement_status)}</strong></div>
                        <div><span>Outstanding</span><strong>{money(account.outstanding_balance)}</strong></div>
                        <div><span>Overdue</span><strong>{money(account.overdue_amount)}</strong></div>
                        <div><span>Days past due</span><strong>{Number(account.days_past_due || 0)}</strong></div>
                        <div><span>Next due</span><strong>{dateLabel(account.next_due_date)}</strong></div>
                        <div><span>Risk</span><strong>{label(account.risk_band)}</strong></div>
                        <div><span>Customer phone</span><strong>{account.customer_phone_snapshot || account.customer_phone || "—"}</strong></div>
                        <div><span>Machine</span><strong>{account.asset_code_snapshot || account.asset_code}</strong></div>
                      </section>
                      <div className="finance-governance__boundary">
                        <strong>Protected boundary</strong>
                        <p>
                          A request does not change the agreement. Approval never edits payment receipts or balances,
                          never creates Hire work and never executes repossession or legal action automatically.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {tab === "schedule" ? <Schedule rows={selected.schedule || []} /> : null}

                  {tab === "requests" ? (
                    <div className="finance-governance__forms-grid">
                      {canPrepare && !account.pending_reschedule_request ? (
                        <form onSubmit={handleReschedule} className="finance-governance__form">
                          <header><h3>Prepare reschedule request</h3><p>No schedule changes until independent approval.</p></header>
                          <div className="finance-governance__form-grid">
                            <label>
                              <span>Frequency</span>
                              <select value={reschedule.payment_frequency} onChange={(event) => setReschedule((current) => ({ ...current, payment_frequency: event.target.value }))}>
                                <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option>
                              </select>
                            </label>
                            <label><span>Installments</span><input type="number" min="1" max="60" value={reschedule.installment_count} onChange={(event) => setReschedule((current) => ({ ...current, installment_count: event.target.value }))} /></label>
                            <label><span>First due date</span><input type="date" required value={reschedule.first_due_date} onChange={(event) => setReschedule((current) => ({ ...current, first_due_date: event.target.value }))} /></label>
                            <label><span>Customer consent / meeting reference</span><input required value={reschedule.customer_consent_reference} onChange={(event) => setReschedule((current) => ({ ...current, customer_consent_reference: event.target.value }))} /></label>
                          </div>
                          <label><span>Affordability review notes</span><textarea value={reschedule.affordability_notes} onChange={(event) => setReschedule((current) => ({ ...current, affordability_notes: event.target.value }))} /></label>
                          <label><span>Detailed reason</span><textarea required minLength="15" value={reschedule.reason} onChange={(event) => setReschedule((current) => ({ ...current, reason: event.target.value }))} /></label>
                          {reschedule.first_due_date ? (
                            <div className="finance-governance__preview">
                              <strong>Replacement plan preview · {money(account.outstanding_balance)}</strong>
                              <div>
                                {proposalPreview.slice(0, 6).map((row) => (
                                  <span key={row.sequence}>#{row.sequence} {dateLabel(row.due_date)} · {money(row.amount)}</span>
                                ))}
                              </div>
                              {proposalPreview.length > 6 ? <small>Plus {proposalPreview.length - 6} additional installment(s).</small> : null}
                            </div>
                          ) : null}
                          <button type="submit" disabled={busy === "reschedule"}>{busy === "reschedule" ? "Recording request…" : "Record reschedule request"}</button>
                        </form>
                      ) : null}

                      {canPrepare && account.eligible_for_default && !account.pending_default_request ? (
                        <form onSubmit={handleDefault} className="finance-governance__form is-danger">
                          <header><h3>Prepare default review</h3><p>Status remains unchanged until an independent decision.</p></header>
                          <label><span>Supporting evidence reference</span><input required value={defaultRequest.evidence_reference} onChange={(event) => setDefaultRequest((current) => ({ ...current, evidence_reference: event.target.value }))} /></label>
                          <label><span>Customer demand summary</span><textarea value={defaultRequest.customer_demand_summary} onChange={(event) => setDefaultRequest((current) => ({ ...current, customer_demand_summary: event.target.value }))} /></label>
                          <label><span>Guarantor contact summary</span><textarea value={defaultRequest.guarantor_contact_summary} onChange={(event) => setDefaultRequest((current) => ({ ...current, guarantor_contact_summary: event.target.value }))} /></label>
                          <label><span>Detailed default-review reason</span><textarea required minLength="15" value={defaultRequest.reason} onChange={(event) => setDefaultRequest((current) => ({ ...current, reason: event.target.value }))} /></label>
                          <button type="submit" className="is-danger" disabled={busy === "default"}>{busy === "default" ? "Recording review…" : "Record default review request"}</button>
                        </form>
                      ) : null}

                      {pendingRequests.map((request) => (
                        <article key={request.id} className="finance-governance__pending">
                          <header>
                            <div><small>Pending request #{request.id}</small><h3>{label(request.request_type)}</h3></div>
                            <Pill value="pending" tone="governance" />
                          </header>
                          <p>{request.details}</p>
                          <dl>
                            <div><dt>Prepared by</dt><dd>{request.recorded_by_name}</dd></div>
                            <div><dt>Prepared</dt><dd>{dateLabel(request.created_at, true)}</dd></div>
                            {request.request_type === "reschedule" ? (
                              <>
                                <div><dt>Frequency</dt><dd>{label(request.metadata.proposed_payment_frequency)}</dd></div>
                                <div><dt>Installments</dt><dd>{request.metadata.proposed_installment_count}</dd></div>
                              </>
                            ) : <div><dt>Days past due</dt><dd>{request.metadata.days_past_due_snapshot}</dd></div>}
                          </dl>
                          {canDecide ? (
                            <form onSubmit={(event) => handleDecision(event, request.id)} className="finance-governance__decision">
                              <label><span>Decision</span><select value={decision.decision} onChange={(event) => setDecision((current) => ({ ...current, decision: event.target.value }))}><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
                              <label><span>Independent decision reason</span><textarea required minLength="10" value={decision.reason} onChange={(event) => setDecision((current) => ({ ...current, reason: event.target.value }))} /></label>
                              <button type="submit" className={decision.decision === "approve" ? "" : "is-danger"} disabled={busy === `decision:${request.id}`}>{busy === `decision:${request.id}` ? "Saving decision…" : `${label(decision.decision)} request`}</button>
                            </form>
                          ) : <p className="finance-governance__role-note">A different Finance Manager must decide this request.</p>}
                        </article>
                      ))}

                      {!canPrepare && !pendingRequests.length ? (
                        <Empty title="Read-only governance access" detail="Your Finance role can review evidence but cannot prepare or decide requests." />
                      ) : null}
                    </div>
                  ) : null}

                  {tab === "recovery" ? (
                    <div className="finance-governance__recovery">
                      {account.agreement_status === "defaulted" && canRecover ? (
                        <form onSubmit={handleRecovery} className="finance-governance__form is-critical">
                          <header>
                            <h3>Record recovery action</h3>
                            <p>This records evidence only. It does not execute repossession, legal action or fleet changes.</p>
                          </header>
                          <div className="finance-governance__form-grid">
                            <label><span>Action</span><select value={recovery.action_type} onChange={(event) => setRecovery((current) => ({ ...current, action_type: event.target.value }))}>{RECOVERY_ACTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                            <label><span>Next action date</span><input type="date" value={recovery.next_action_date} onChange={(event) => setRecovery((current) => ({ ...current, next_action_date: event.target.value }))} /></label>
                            <label><span>Evidence reference</span><input value={recovery.evidence_reference} onChange={(event) => setRecovery((current) => ({ ...current, evidence_reference: event.target.value }))} /></label>
                            <label><span>Action location</span><input value={recovery.action_location} onChange={(event) => setRecovery((current) => ({ ...current, action_location: event.target.value }))} /></label>
                            <label><span>Contact person</span><input value={recovery.contact_person} onChange={(event) => setRecovery((current) => ({ ...current, contact_person: event.target.value }))} /></label>
                            <label><span>Contact phone</span><input value={recovery.contact_phone} onChange={(event) => setRecovery((current) => ({ ...current, contact_phone: event.target.value }))} /></label>
                          </div>
                          <label><span>Recovery evidence notes</span><textarea required minLength="10" value={recovery.notes} onChange={(event) => setRecovery((current) => ({ ...current, notes: event.target.value }))} /></label>
                          <button type="submit" disabled={busy === "recovery"}>{busy === "recovery" ? "Recording action…" : "Record recovery evidence"}</button>
                        </form>
                      ) : account.agreement_status !== "defaulted" ? (
                        <Empty title="Independent default required" detail="Recovery actions become available only after an independently approved default decision." />
                      ) : (
                        <Empty title="Read-only recovery access" detail="Your Finance role can review recovery evidence but cannot add actions." />
                      )}
                      <Timeline events={selected.governance?.recovery_actions || []} />
                    </div>
                  ) : null}

                  {tab === "timeline" ? <Timeline events={selected.governance_events || []} /> : null}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
