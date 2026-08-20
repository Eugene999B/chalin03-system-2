import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import {
  equipmentWorkspaceRole,
  isEquipmentAdministrator,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentFinanceCorrections.css";

const API = "/equipment-catalogue/sales/finance-corrections";
const REQUEST_TYPES = [
  ["draft_cancellation", "Cancel draft agreement"],
  ["payment_reversal", "Reverse incorrect payment"],
  ["asset_return", "Voluntary equipment return"],
  ["repossession", "Repossess equipment"],
  ["charge_waiver", "Waive late charge"],
];
const CONDITIONS = [
  ["excellent", "Excellent"],
  ["good", "Good"],
  ["fair", "Fair"],
  ["poor", "Poor"],
  ["damaged", "Damaged"],
  ["under_inspection", "Under inspection"],
];

const EMPTY_REQUEST = {
  request_type: "asset_return",
  reason: "",
  evidence_reference: "",
  payment_id: "",
  schedule_id: "",
  amount: "",
  return_date: new Date().toISOString().slice(0, 10),
  condition_status: "good",
  meter_reading: "",
  approved_return_credit: "0",
  refundable_amount: "0",
  penalty_amount: "0",
  damage_amount: "0",
  notes: "",
};

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

function dateLabel(value, includeTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleString("en-GH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Pill({ value }) {
  return <span className={`finance-corrections__pill is-${String(value || "neutral")}`}>{label(value)}</span>;
}

function Metric({ title, value, detail }) {
  return (
    <article className="finance-corrections__metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Empty({ title, detail }) {
  return (
    <div className="finance-corrections__empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function AccountCard({ account, selected, onOpen }) {
  return (
    <button
      type="button"
      className={`finance-corrections__account ${selected ? "is-selected" : ""}`}
      onClick={() => onOpen(account.agreement_id)}
      data-testid="phase4-account-card"
    >
      <div>
        <small>{account.agreement_number}</small>
        <strong>{account.customer_name}</strong>
        <span>{account.asset_code} · {account.asset_name}</span>
      </div>
      <div>
        <Pill value={account.agreement_status} />
        <strong>{money(account.outstanding_balance)}</strong>
        <small>{account.pending_correction_count} pending · {account.ledger_entry_count} ledger</small>
      </div>
    </button>
  );
}

function SettlementFormula({ preview, account }) {
  if (!preview) {
    return (
      <div className="finance-corrections__formula is-empty">
        Enter the approved amounts and preview the settlement before requesting approval.
      </div>
    );
  }
  return (
    <div className="finance-corrections__formula" data-testid="phase4-settlement-preview">
      <p>
        <span>{money(preview.outstanding_balance)}</span>
        <b>−</b><span>{money(preview.approved_return_credit)}</span>
        <b>−</b><span>{money(preview.refundable_amount)}</span>
        <b>+</b><span>{money(preview.penalty_amount)}</span>
        <b>+</b><span>{money(preview.damage_amount)}</span>
      </p>
      <div>
        <span>Preview final settlement</span>
        <strong>{money(preview.final_settlement_balance)}</strong>
        {preview.refund_due > 0 ? <small>Customer refund due: {money(preview.refund_due)}</small> : null}
      </div>
      <small>
        Current official account balance: {money(account?.outstanding_balance)}. Approval rechecks this balance.
      </small>
    </div>
  );
}

export default function EquipmentFinanceCorrectionsPage() {
  const { user } = useAuth();
  const role = equipmentWorkspaceRole(user);
  const administrator = isEquipmentAdministrator(user);
  const canPrepare =
    administrator ||
    ["finance_manager", "finance_accountant", "collections_officer", "credit_officer"].includes(role);
  const canDecide = administrator || role === "finance_manager";
  const canEditPolicy = administrator || role === "finance_manager";

  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("request");
  const [request, setRequest] = useState(EMPTY_REQUEST);
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [policyForm, setPolicyForm] = useState(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [accountResponse, policyResponse] = await Promise.all([
        axiosClient.get(`${API}/accounts`, {
          params: { search: search.trim(), status: statusFilter },
        }),
        axiosClient.get(`${API}/policy`),
      ]);
      const nextAccounts = accountResponse.data?.accounts || [];
      setAccounts(nextAccounts);
      const nextPolicy = policyResponse.data?.policy || null;
      setPolicy(nextPolicy);
      setPolicyForm((current) => current || (nextPolicy ? {
        policy_version: nextPolicy.policy_version,
        default_return_credit_percent: nextPolicy.default_return_credit_percent,
        maximum_penalty_percent: nextPolicy.maximum_penalty_percent,
        maximum_damage_charge_percent: nextPolicy.maximum_damage_charge_percent,
        allow_customer_refund_due: nextPolicy.allow_customer_refund_due,
        return_terms: nextPolicy.return_terms,
        change_reason: "",
      } : null));
      if (!selectedId && nextAccounts.length) setSelectedId(nextAccounts[0].agreement_id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load Finance corrections."));
    } finally {
      setLoading(false);
    }
  }, [search, selectedId, statusFilter]);

  const openAccount = useCallback(async (agreementId) => {
    if (!agreementId) return;
    setSelectedLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(`${API}/accounts/${agreementId}`);
      setSelected(response.data || null);
      setSelectedId(Number(agreementId));
      setPreview(null);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not open the Finance correction file."));
    } finally {
      setSelectedLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadList, 180);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (selectedId) openAccount(selectedId);
  }, [openAccount, selectedId]);

  const account = selected?.account;
  const activePayments = useMemo(
    () => (selected?.payments || []).filter((payment) => !payment.is_voided),
    [selected]
  );
  const chargeRows = useMemo(
    () => (selected?.schedule || []).filter(
      (row) => Number(row.late_charge_amount || 0) > Number(row.waived_charge_amount || 0)
    ),
    [selected]
  );
  const pendingRequests = useMemo(
    () => (selected?.correction_requests || []).filter((item) => item.request_status === "pending"),
    [selected]
  );

  async function refreshAll(agreementId = selectedId) {
    await loadList();
    if (agreementId) await openAccount(agreementId);
  }

  async function previewSettlement() {
    if (!account) return;
    setBusy("preview");
    setError("");
    try {
      const response = await axiosClient.post(`${API}/settlement-preview`, {
        outstanding_balance: account.outstanding_balance,
        approved_return_credit: request.approved_return_credit,
        refundable_amount: request.refundable_amount,
        penalty_amount: request.penalty_amount,
        damage_amount: request.damage_amount,
      });
      setPreview(response.data?.settlement || null);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not preview the return settlement."));
    } finally {
      setBusy("");
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!account || !canPrepare) return;
    setBusy("request");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(`${API}/accounts/${account.agreement_id}/requests`, request);
      setMessage(response.data?.message || "Correction request recorded.");
      setRequest(EMPTY_REQUEST);
      setPreview(null);
      await refreshAll(account.agreement_id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not record the correction request."));
    } finally {
      setBusy("");
    }
  }

  async function decideRequest(event, correction) {
    event.preventDefault();
    const form = decisions[correction.id] || { decision: "approve", reason: "" };
    setBusy(`decision:${correction.id}`);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(`${API}/requests/${correction.id}/decision`, form);
      setMessage(response.data?.message || "Correction decision recorded.");
      setDecisions((current) => ({ ...current, [correction.id]: { decision: "approve", reason: "" } }));
      await refreshAll(correction.agreement_id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not record the independent decision."));
    } finally {
      setBusy("");
    }
  }

  async function savePolicy(event) {
    event.preventDefault();
    if (!policyForm || !canEditPolicy) return;
    setBusy("policy");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.put(`${API}/policy`, policyForm);
      const nextPolicy = response.data?.policy;
      setPolicy(nextPolicy);
      setPolicyForm({
        policy_version: nextPolicy.policy_version,
        default_return_credit_percent: nextPolicy.default_return_credit_percent,
        maximum_penalty_percent: nextPolicy.maximum_penalty_percent,
        maximum_damage_charge_percent: nextPolicy.maximum_damage_charge_percent,
        allow_customer_refund_due: nextPolicy.allow_customer_refund_due,
        return_terms: nextPolicy.return_terms,
        change_reason: "",
      });
      setMessage(response.data?.message || "Policy updated.");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not update the correction policy."));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="finance-corrections" data-testid="phase4-corrections-page">
      <header className="finance-corrections__hero">
        <div>
          <p>Phase 4 · Accounting-style corrections</p>
          <h1>Returns, Cancellations & Corrections</h1>
          <span>
            Preserve every original agreement, receipt and allocation. Approved corrections post through an append-only ledger.
          </span>
        </div>
        <Link to="/equipment-installment-finance/applications?stage=governance">
          Default & restructure governance
        </Link>
      </header>

      {error ? <div className="finance-corrections__notice is-error" role="alert">{error}</div> : null}
      {message ? <div className="finance-corrections__notice is-success" role="status">{message}</div> : null}

      <section className="finance-corrections__policy-strip">
        <div>
          <span>Active policy</span>
          <strong>{policy?.policy_version || "Loading…"}</strong>
        </div>
        <p>{policy?.return_terms || "Loading recorded return terms…"}</p>
        <button type="button" onClick={() => setTab("policy")}>View policy</button>
      </section>

      <section className="finance-corrections__metrics">
        <Metric title="Finance accounts" value={loading ? "…" : accounts.length} detail="Controlled installment agreements" />
        <Metric title="Pending approval" value={pendingRequests.length} detail="Selected account" />
        <Metric title="Ledger entries" value={selected?.ledger?.length || 0} detail="Selected account" />
        <Metric title="Official balance" value={money(account?.outstanding_balance)} detail="Returned by the backend" />
      </section>

      <section className="finance-corrections__workspace">
        <aside>
          <div className="finance-corrections__filters">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Agreement, customer or excavator"
              aria-label="Search correction accounts"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="active">Active</option>
              <option value="overdue">Overdue</option>
              <option value="defaulted">Defaulted</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="finance-corrections__account-list">
            {loading ? <Empty title="Loading accounts…" detail="Reading official Finance balances." /> : null}
            {!loading && !accounts.length ? (
              <Empty title="No matching accounts" detail="Change the search or status filter." />
            ) : null}
            {accounts.map((item) => (
              <AccountCard
                key={item.agreement_id}
                account={item}
                selected={Number(item.agreement_id) === Number(selectedId)}
                onOpen={openAccount}
              />
            ))}
          </div>
        </aside>

        <div className="finance-corrections__file">
          {selectedLoading && !account ? <Empty title="Opening account file…" detail="Loading preserved records." /> : null}
          {!selectedLoading && !account ? (
            <Empty title="Choose an account" detail="Select an agreement to prepare or review a correction." />
          ) : null}
          {account ? (
            <>
              <header className="finance-corrections__account-head">
                <div>
                  <small>{account.agreement_number}</small>
                  <h2>{account.customer_name}</h2>
                  <p>{account.asset_code} · {account.asset_name}</p>
                </div>
                <div>
                  <Pill value={account.agreement_status} />
                  <span>Official settlement balance</span>
                  <strong data-testid="phase4-official-balance">{money(account.outstanding_balance)}</strong>
                </div>
              </header>

              <nav className="finance-corrections__tabs" aria-label="Correction account sections">
                {[
                  ["request", "Prepare correction"],
                  ["approvals", `Approvals (${pendingRequests.length})`],
                  ["ledger", "Ledger & history"],
                  ["policy", "Return policy"],
                ].map(([value, title]) => (
                  <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
                    {title}
                  </button>
                ))}
              </nav>

              {tab === "request" ? (
                <form className="finance-corrections__form" onSubmit={submitRequest}>
                  <div className="finance-corrections__section-head">
                    <div><p>Maker step</p><h3>Prepare a correction request</h3></div>
                    <span>A different Finance Manager must decide it.</span>
                  </div>
                  <label>
                    Correction type
                    <select
                      value={request.request_type}
                      onChange={(event) => {
                        setRequest((current) => ({ ...current, request_type: event.target.value }));
                        setPreview(null);
                      }}
                      data-testid="phase4-request-type"
                    >
                      {REQUEST_TYPES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
                    </select>
                  </label>

                  {request.request_type === "payment_reversal" ? (
                    <label>
                      Original receipt
                      <select value={request.payment_id} onChange={(event) => setRequest((current) => ({ ...current, payment_id: event.target.value }))}>
                        <option value="">Choose latest non-void receipt</option>
                        {activePayments.map((payment) => (
                          <option key={payment.id} value={payment.id}>
                            {payment.receipt_number} · {money(payment.amount)} · {dateLabel(payment.payment_date)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {["asset_return", "repossession"].includes(request.request_type) ? (
                    <>
                      <div className="finance-corrections__grid is-five">
                        <label>Approved return credit<input type="number" min="0" step="0.01" value={request.approved_return_credit} onChange={(event) => setRequest((current) => ({ ...current, approved_return_credit: event.target.value }))} /></label>
                        <label>Refundable amount<input type="number" min="0" step="0.01" value={request.refundable_amount} onChange={(event) => setRequest((current) => ({ ...current, refundable_amount: event.target.value }))} /></label>
                        <label>Penalty<input type="number" min="0" step="0.01" value={request.penalty_amount} onChange={(event) => setRequest((current) => ({ ...current, penalty_amount: event.target.value }))} /></label>
                        <label>Damage charge<input type="number" min="0" step="0.01" value={request.damage_amount} onChange={(event) => setRequest((current) => ({ ...current, damage_amount: event.target.value }))} /></label>
                        <button type="button" onClick={previewSettlement} disabled={busy === "preview"}>
                          {busy === "preview" ? "Previewing…" : "Preview formula"}
                        </button>
                      </div>
                      <SettlementFormula preview={preview} account={account} />
                      <div className="finance-corrections__grid">
                        <label>Return date<input type="date" value={request.return_date} onChange={(event) => setRequest((current) => ({ ...current, return_date: event.target.value }))} /></label>
                        <label>Inspected condition<select value={request.condition_status} onChange={(event) => setRequest((current) => ({ ...current, condition_status: event.target.value }))}>{CONDITIONS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
                        <label>Meter reading<input type="number" min="0" step="0.01" value={request.meter_reading} onChange={(event) => setRequest((current) => ({ ...current, meter_reading: event.target.value }))} /></label>
                      </div>
                      <label>Return notes<textarea rows="3" value={request.notes} onChange={(event) => setRequest((current) => ({ ...current, notes: event.target.value }))} /></label>
                    </>
                  ) : null}

                  {request.request_type === "charge_waiver" ? (
                    <div className="finance-corrections__grid">
                      <label>
                        Schedule charge
                        <select value={request.schedule_id} onChange={(event) => setRequest((current) => ({ ...current, schedule_id: event.target.value }))}>
                          <option value="">Choose charged schedule line</option>
                          {chargeRows.map((row) => (
                            <option key={row.id} value={row.id}>
                              #{row.sequence_number} · {dateLabel(row.due_date)} · available {money(Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>Amount to waive<input type="number" min="0.01" step="0.01" value={request.amount} onChange={(event) => setRequest((current) => ({ ...current, amount: event.target.value }))} /></label>
                    </div>
                  ) : null}

                  <label>
                    Detailed reason
                    <textarea rows="4" value={request.reason} onChange={(event) => setRequest((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain what happened, why this correction is necessary, and the financial effect." required />
                  </label>
                  {request.request_type !== "draft_cancellation" ? (
                    <label>
                      Evidence reference
                      <input value={request.evidence_reference} onChange={(event) => setRequest((current) => ({ ...current, evidence_reference: event.target.value }))} placeholder="Receipt, bank, MoMo, inspection or signed return reference" />
                    </label>
                  ) : null}
                  <button className="finance-corrections__primary" type="submit" disabled={!canPrepare || busy === "request"} data-testid="phase4-submit-request">
                    {busy === "request" ? "Recording…" : "Record request for approval"}
                  </button>
                </form>
              ) : null}

              {tab === "approvals" ? (
                <section className="finance-corrections__panel">
                  <div className="finance-corrections__section-head">
                    <div><p>Checker step</p><h3>Independent approval queue</h3></div>
                    <span>The requester cannot decide the same request.</span>
                  </div>
                  {!pendingRequests.length ? <Empty title="No pending correction" detail="Approved and rejected requests remain in history." /> : null}
                  {pendingRequests.map((correction) => {
                    const form = decisions[correction.id] || { decision: "approve", reason: "" };
                    return (
                      <article className="finance-corrections__approval" key={correction.id} data-testid="phase4-pending-request">
                        <header>
                          <div><small>{correction.request_number}</small><strong>{label(correction.request_type)}</strong></div>
                          <Pill value={correction.request_status} />
                        </header>
                        <p>{correction.reason}</p>
                        <small>Requested by {correction.requested_by_name || "Finance staff"} · {dateLabel(correction.requested_at, true)}</small>
                        <div className="finance-corrections__entries">
                          {(correction.proposed_entries || []).map((entry, index) => (
                            <span key={`${entry.entry_type}-${index}`}>
                              {label(entry.entry_type)} · {entry.direction} · {money(entry.amount)}
                            </span>
                          ))}
                        </div>
                        <form onSubmit={(event) => decideRequest(event, correction)}>
                          <select value={form.decision} onChange={(event) => setDecisions((current) => ({ ...current, [correction.id]: { ...form, decision: event.target.value } }))}>
                            <option value="approve">Approve and post</option>
                            <option value="reject">Reject and preserve</option>
                          </select>
                          <input value={form.reason} onChange={(event) => setDecisions((current) => ({ ...current, [correction.id]: { ...form, reason: event.target.value } }))} placeholder="Independent decision reason" required />
                          <button type="submit" disabled={!canDecide || busy === `decision:${correction.id}`} data-testid="phase4-decide-request">
                            {busy === `decision:${correction.id}` ? "Saving…" : "Record decision"}
                          </button>
                        </form>
                      </article>
                    );
                  })}
                </section>
              ) : null}

              {tab === "ledger" ? (
                <section className="finance-corrections__panel">
                  <div className="finance-corrections__section-head">
                    <div><p>Permanent evidence</p><h3>Correction ledger and original history</h3></div>
                    <span>No original receipt is silently deleted.</span>
                  </div>
                  <h4>Ledger entries</h4>
                  {!selected.ledger?.length ? <Empty title="No correction entries" detail="Approved corrections will appear here." /> : (
                    <div className="finance-corrections__table-wrap"><table><thead><tr><th>Entry</th><th>Type</th><th>Direction</th><th>Amount</th><th>Before</th><th>After</th><th>Posted</th></tr></thead><tbody>{selected.ledger.map((entry) => <tr key={entry.id} data-testid="phase4-ledger-entry"><td>{entry.entry_number}</td><td>{label(entry.entry_type)}</td><td><Pill value={entry.direction} /></td><td>{money(entry.amount)}</td><td>{money(entry.balance_before)}</td><td>{money(entry.balance_after)}</td><td>{dateLabel(entry.posted_at, true)}</td></tr>)}</tbody></table></div>
                  )}
                  <h4>Original payment receipts</h4>
                  <div className="finance-corrections__table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th>Category</th><th>Amount</th><th>Status</th><th>Void reason</th></tr></thead><tbody>{(selected.payments || []).map((payment) => <tr key={payment.id}><td>{payment.receipt_number}</td><td>{dateLabel(payment.payment_date, true)}</td><td>{label(payment.payment_category)}</td><td>{money(payment.amount)}</td><td><Pill value={payment.is_voided ? "reversed" : "posted"} /></td><td>{payment.void_reason || "—"}</td></tr>)}</tbody></table></div>
                  <h4>Return settlements</h4>
                  {!selected.asset_returns?.length ? <Empty title="No equipment return" detail="Approved voluntary returns and repossessions will appear here." /> : selected.asset_returns.map((item) => <article className="finance-corrections__return" key={item.id}><header><strong>{item.return_number}</strong><Pill value={item.return_type} /></header><p>{money(item.approved_return_credit)} return credit − {money(item.refundable_amount)} refundable + {money(item.penalty_amount)} penalty + {money(item.damage_amount)} damage</p><strong>Final balance: {money(item.settlement_balance)}</strong><small>Policy {item.policy_version} · {dateLabel(item.return_date)}</small></article>)}
                </section>
              ) : null}

              {tab === "policy" && policyForm ? (
                <form className="finance-corrections__form" onSubmit={savePolicy}>
                  <div className="finance-corrections__section-head">
                    <div><p>Recorded policy</p><h3>Return and correction terms</h3></div>
                    <span>Every change creates a policy-history record.</span>
                  </div>
                  <div className="finance-corrections__grid">
                    <label>Policy version<input value={policyForm.policy_version} onChange={(event) => setPolicyForm((current) => ({ ...current, policy_version: event.target.value }))} /></label>
                    <label>Default return credit %<input type="number" min="0" max="100" step="0.01" value={policyForm.default_return_credit_percent} onChange={(event) => setPolicyForm((current) => ({ ...current, default_return_credit_percent: event.target.value }))} /></label>
                    <label>Maximum penalty %<input type="number" min="0" max="100" step="0.01" value={policyForm.maximum_penalty_percent} onChange={(event) => setPolicyForm((current) => ({ ...current, maximum_penalty_percent: event.target.value }))} /></label>
                    <label>Maximum damage %<input type="number" min="0" max="100" step="0.01" value={policyForm.maximum_damage_charge_percent} onChange={(event) => setPolicyForm((current) => ({ ...current, maximum_damage_charge_percent: event.target.value }))} /></label>
                  </div>
                  <label className="finance-corrections__check"><input type="checkbox" checked={Boolean(policyForm.allow_customer_refund_due)} onChange={(event) => setPolicyForm((current) => ({ ...current, allow_customer_refund_due: event.target.checked }))} />Allow an approved excess credit to become a customer refund due</label>
                  <label>Return terms<textarea rows="8" value={policyForm.return_terms} onChange={(event) => setPolicyForm((current) => ({ ...current, return_terms: event.target.value }))} /></label>
                  <label>Policy change reason<input value={policyForm.change_reason} onChange={(event) => setPolicyForm((current) => ({ ...current, change_reason: event.target.value }))} placeholder="Why these limits or terms changed" required /></label>
                  <button className="finance-corrections__primary" type="submit" disabled={!canEditPolicy || busy === "policy"}>{busy === "policy" ? "Saving…" : "Save policy with history"}</button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
