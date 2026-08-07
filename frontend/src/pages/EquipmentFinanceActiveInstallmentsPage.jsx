import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceAccountsCompletion.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";
import "../styles/equipmentFinanceIntegrityHealth.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";

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
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function accountTone(account) {
  if (Number(account.outstanding_balance || 0) <= 0.01) return "completed";
  if (Number(account.overdue_amount || 0) > 0.01) return "overdue";
  if (account.agreement_status === "defaulted") return "defaulted";
  return "active";
}

function accountHealth(account, detail) {
  if (detail?.reconciliation?.consistent === false) {
    return {
      tone: "danger",
      mark: "!",
      title: "Integrity review required",
      note: "Receipts, allocations, schedule or ledger evidence do not reconcile. Financial mutations remain blocked.",
    };
  }
  if (account.agreement_status === "defaulted") {
    return {
      tone: "danger",
      mark: "!",
      title: "Defaulted account",
      note: "The Finance account requires controlled recovery or correction handling.",
    };
  }
  if (Number(account.outstanding_balance || 0) <= 0.01) {
    return {
      tone: "settled",
      mark: "✓",
      title: "Financially settled",
      note: account.ownership_id
        ? "The account is settled and ownership completion is recorded."
        : "The account is settled. Complete any outstanding delivery or ownership controls.",
    };
  }
  if (Number(account.overdue_amount || 0) > 0.01) {
    return {
      tone: "warning",
      mark: "!",
      title: "Payment attention required",
      note: `${money(account.overdue_amount)} is overdue. The underlying account evidence is still reconciled.`,
    };
  }
  return {
    tone: "healthy",
    mark: "✓",
    title: "Account healthy",
    note: "The Finance evidence reconciles and the account is currently within its payment lifecycle.",
  };
}

function lifecycleSteps(account, detail) {
  const paymentCount = detail?.payments?.filter((payment) => !payment.is_voided).length || 0;
  const reserved = account.equipment_commitment_status === "reserved";
  const delivered = Boolean(account.delivery_id || account.delivery_datetime);
  const transferred = Boolean(account.ownership_id || account.transfer_number);
  const fullyPaid = Number(account.outstanding_balance || 0) <= 0.01;

  const steps = [
    {
      key: "application",
      title: "Approved Application",
      note: account.application_number || "Approved credit file",
      complete: true,
    },
    {
      key: "agreement",
      title: "Agreement",
      note: account.agreement_number,
      complete: true,
    },
    {
      key: "reservation",
      title: "Deposit & Reservation",
      note: reserved ? "Machine reserved" : "Awaiting required deposit",
      complete: reserved,
    },
    {
      key: "collections",
      title: "Collections",
      note: fullyPaid
        ? "Fully settled"
        : paymentCount
          ? `${paymentCount} payment record${paymentCount === 1 ? "" : "s"}`
          : "No installment collection yet",
      complete: fullyPaid,
      current: reserved && !fullyPaid,
    },
    {
      key: "delivery",
      title: "Delivery",
      note: delivered ? dateLabel(account.delivery_datetime) : "Not handed over",
      complete: delivered,
      current: fullyPaid && !delivered,
    },
    {
      key: "ownership",
      title: "Ownership",
      note: transferred ? dateLabel(account.transfer_date) : "Not transferred",
      complete: transferred,
      current: fullyPaid && delivered && !transferred,
    },
  ];

  const currentAssigned = steps.some((step) => step.current);
  if (!currentAssigned) {
    const firstIncomplete = steps.find((step) => !step.complete);
    if (firstIncomplete) firstIncomplete.current = true;
  }
  return steps;
}

export default function EquipmentFinanceActiveInstallmentsPage() {
  const location = useLocation();
  const requestedAgreement = new URLSearchParams(location.search).get("agreement");
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [problem, setProblem] = useState("");

  const closeDetail = useCallback(() => {
    setSelected(null);
    setDetail(null);
  }, []);

  const loadDetail = useCallback(async (account) => {
    if (!account?.agreement_id) return;
    setDetailLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/accounts/${account.agreement_id}`);
      setSelected(response.data?.account || account);
      setDetail(response.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the selected installment account."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/accounts`);
      const next = response.data?.accounts || [];
      setAccounts(next);
      if (requestedAgreement) {
        const requested = next.find(
          (account) => String(account.agreement_id) === String(requestedAgreement)
        );
        if (requested) await loadDetail(requested);
      } else {
        closeDetail();
      }
    } catch (error) {
      setProblem(errorMessage(error, "Could not load active installment accounts."));
    } finally {
      setLoading(false);
    }
  }, [closeDetail, loadDetail, requestedAgreement]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    return accounts.reduce(
      (result, account) => {
        const tone = accountTone(account);
        if (tone !== "completed") result.active += 1;
        if (tone === "overdue" || tone === "defaulted") result.overdue += 1;
        result.paid += Number(account.amount_paid || 0);
        result.outstanding += Number(account.outstanding_balance || 0);
        result.overdueAmount += Number(account.overdue_amount || 0);
        return result;
      },
      { active: 0, overdue: 0, paid: 0, outstanding: 0, overdueAmount: 0 }
    );
  }, [accounts]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((account) => {
      const tone = accountTone(account);
      if (status === "active" && tone === "completed") return false;
      if (status === "overdue" && !["overdue", "defaulted"].includes(tone)) return false;
      if (status === "completed" && tone !== "completed") return false;
      if (!term) return true;
      return [
        account.agreement_number,
        account.application_number,
        account.customer_name,
        account.customer_phone,
        account.asset_code,
        account.asset_name,
        account.serial_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [accounts, search, status]);

  const health = selected ? accountHealth(selected, detail) : null;
  const lifecycle = selected ? lifecycleSteps(selected, detail) : [];

  return (
    <main className="finance-accounts finance-simplified" data-testid="finance-active-installments">
      <header className="finance-accounts__hero">
        <div>
          <p>Search first, open one account</p>
          <h1>Active Installments</h1>
          <span>
            Search the installment register, select the correct account, then view its complete
            schedule and payment history in a focused dialog.
          </span>
        </div>
        <div className="finance-accounts__hero-actions">
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=collections">Record a Payment</Link>
          <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">Customer Profiles</Link>
        </div>
      </header>

      {problem ? <div className="finance-accounts__notice is-error" role="alert">{problem}</div> : null}

      <section className="finance-accounts__metrics">
        <article><span>Active accounts</span><strong>{metrics.active}</strong></article>
        <article><span>Overdue accounts</span><strong>{metrics.overdue}</strong></article>
        <article><span>Total collected</span><strong>{money(metrics.paid)}</strong></article>
        <article><span>Outstanding</span><strong>{money(metrics.outstanding)}</strong></article>
        <article className={metrics.overdueAmount > 0 ? "is-warning" : ""}><span>Overdue amount</span><strong>{money(metrics.overdueAmount)}</strong></article>
      </section>

      <section className="finance-accounts__panel">
        <div className="finance-accounts__toolbar">
          <div><p>Choose installment account</p><h2>{visible.length} result(s)</h2></div>
          <div>
            <input
              aria-label="Search active installment accounts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Agreement, customer, phone or excavator"
              autoComplete="off"
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">Active accounts</option>
              <option value="overdue">Overdue / defaulted</option>
              <option value="completed">Completed</option>
              <option value="all">All accounts</option>
            </select>
            <button type="button" onClick={load} disabled={loading}>Refresh</button>
          </div>
        </div>

        {loading ? <div className="finance-accounts__empty">Loading authoritative accounts…</div> : null}
        {!loading && !visible.length ? <div className="finance-accounts__empty">No matching installment account.</div> : null}

        <div className="finance-simplified__compact-register">
          {visible.map((account) => {
            const tone = accountTone(account);
            return (
              <article key={account.agreement_id} className={`finance-simplified__compact-record ${["overdue", "defaulted"].includes(tone) ? "is-warning" : ""}`}>
                <div>
                  <small>{account.agreement_number}</small>
                  <h3>{account.customer_name}</h3>
                  <p>{account.asset_code} — {account.asset_name}</p>
                </div>
                <div className="finance-simplified__compact-fact">
                  <span>Official balance</span>
                  <strong>{money(account.outstanding_balance)}</strong>
                </div>
                <div className="finance-simplified__compact-fact">
                  <span>{Number(account.overdue_amount || 0) > 0 ? "Overdue" : "Next due"}</span>
                  <strong>{Number(account.overdue_amount || 0) > 0 ? money(account.overdue_amount) : dateLabel(account.next_due_date)}</strong>
                </div>
                <div className="finance-simplified__compact-record-actions">
                  <button type="button" onClick={() => loadDetail(account)}>Open Account</button>
                  {Number(account.outstanding_balance || 0) > 0.01 ? (
                    <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${account.agreement_id}`}>Record Payment</Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selected ? (
        <div className="finance-accounts__backdrop" role="presentation" onMouseDown={closeDetail}>
          <section className="finance-accounts__dialog" role="dialog" aria-modal="true" aria-label="Installment account file" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-accounts__dialog-head">
              <div>
                <p>Selected account</p>
                <h2>{selected.agreement_number}</h2>
                <span>{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span>
              </div>
              <button type="button" onClick={closeDetail}>Close</button>
            </div>

            {detailLoading ? <div className="finance-accounts__empty">Loading account file…</div> : null}
            {!detailLoading ? (
              <>
                {detail?.reconciliation?.consistent === false ? (
                  <div className="finance-accounts__notice is-error">
                    Payment and completion actions remain blocked until receipts, allocations,
                    schedule and ledger evidence reconcile.
                  </div>
                ) : null}

                {health ? (
                  <section className="finance-integrity-health" data-testid="finance-account-health">
                    <div className={`finance-integrity-health__banner is-${health.tone}`}>
                      <div className="finance-integrity-health__identity">
                        <div className="finance-integrity-health__mark">{health.mark}</div>
                        <div>
                          <small>Account health</small>
                          <strong>{health.title}</strong>
                          <span>{health.note}</span>
                        </div>
                      </div>
                      <div className="finance-integrity-health__chips">
                        <span>{detail?.reconciliation?.consistent === false ? "Reconciliation blocked" : "Reconciled"}</span>
                        <span>{selected.equipment_commitment_status === "reserved" ? "Machine reserved" : "Reservation pending"}</span>
                        <span>{Number(selected.overdue_amount || 0) > 0.01 ? `${money(selected.overdue_amount)} overdue` : "No overdue balance"}</span>
                      </div>
                    </div>

                    <div className="finance-integrity-health__timeline" aria-label="Installment lifecycle timeline">
                      {lifecycle.map((step, index) => (
                        <article
                          key={step.key}
                          className={`finance-integrity-health__step ${step.complete ? "is-complete" : ""} ${step.current ? "is-current" : ""}`}
                        >
                          <div className="finance-integrity-health__dot">
                            {step.complete ? "✓" : index + 1}
                          </div>
                          <strong>{step.title}</strong>
                          <span>{step.note}</span>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="finance-accounts__summary">
                  <article><span>Official balance</span><strong>{money(selected.outstanding_balance)}</strong></article>
                  <article><span>Overdue</span><strong>{money(selected.overdue_amount)}</strong></article>
                  <article><span>Next due</span><strong>{dateLabel(selected.next_due_date)}</strong></article>
                  <article><span>Delivery</span><strong>{label(selected.delivery_status)}</strong></article>
                  <article><span>Ownership</span><strong>{label(selected.ownership_status)}</strong></article>
                </div>

                <details>
                  <summary>Show installment schedule and payment history</summary>
                  <div className="finance-accounts__two-column">
                    <section>
                      <h3>Installment schedule</h3>
                      <div className="finance-accounts__rows">
                        {(detail?.schedule || []).map((row) => (
                          <article key={row.id || row.sequence_number}>
                            <span>Payment {row.sequence_number}</span>
                            <strong>{dateLabel(row.due_date)}</strong>
                            <b>{money(row.scheduled_amount)}</b>
                            <small>{label(row.schedule_status)}</small>
                          </article>
                        ))}
                      </div>
                    </section>
                    <section>
                      <h3>Payment history</h3>
                      <div className="finance-accounts__rows">
                        {(detail?.payments || []).map((payment) => (
                          <article key={payment.id}>
                            <span>{payment.receipt_number || payment.payment_number}</span>
                            <strong>{dateLabel(payment.payment_date)}</strong>
                            <b>{money(payment.amount)}</b>
                            <small>{label(payment.payment_method)}</small>
                          </article>
                        ))}
                        {!(detail?.payments || []).length ? <div className="finance-accounts__empty">No payment recorded.</div> : null}
                      </div>
                    </section>
                  </div>
                </details>

                <div className="finance-accounts__dialog-actions">
                  <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${selected.agreement_id}`}>Record Payment</Link>
                  <Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${selected.customer_id}`}>Customer Profile</Link>
                  <Link to={`/equipment-installment-finance/applications?stage=case-operations&case_type=agreement&case_id=${selected.agreement_id}`}>Case History</Link>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}