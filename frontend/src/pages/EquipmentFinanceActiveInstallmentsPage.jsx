import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceAccountsCompletion.css";

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

function paymentProgress(account) {
  const total = Number(account.total_amount || 0);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(account.amount_paid || 0) / total) * 100));
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
      }
    } catch (error) {
      setProblem(errorMessage(error, "Could not load active installment accounts."));
    } finally {
      setLoading(false);
    }
  }, [loadDetail, requestedAgreement]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    return accounts.reduce(
      (result, account) => {
        const tone = accountTone(account);
        if (!["completed"].includes(tone)) result.active += 1;
        if (tone === "overdue" || tone === "defaulted") result.overdue += 1;
        result.sales += Number(account.total_amount || 0);
        result.paid += Number(account.amount_paid || 0);
        result.outstanding += Number(account.outstanding_balance || 0);
        result.overdueAmount += Number(account.overdue_amount || 0);
        return result;
      },
      { active: 0, overdue: 0, sales: 0, paid: 0, outstanding: 0, overdueAmount: 0 }
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

  return (
    <main className="finance-accounts" data-testid="finance-active-installments">
      <header className="finance-accounts__hero">
        <div>
          <p>Account monitoring only</p>
          <h1>Active Installments</h1>
          <span>
            Review every approved customer account, official balance, overdue amount,
            payment progress and next due date. Payments are recorded only in the Payments Centre.
          </span>
        </div>
        <div className="finance-accounts__hero-actions">
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=collections">
            Record a Payment
          </Link>
          <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">
            Customer Profiles
          </Link>
        </div>
      </header>

      {problem ? <div className="finance-accounts__notice is-error" role="alert">{problem}</div> : null}
      <div className="finance-accounts__notice">
        Official balances come from committed receipts, allocations, schedule lines and the Finance ledger.
        This screen never changes financial records.
      </div>

      <section className="finance-accounts__metrics">
        <article><span>Active accounts</span><strong>{metrics.active}</strong></article>
        <article><span>Overdue accounts</span><strong>{metrics.overdue}</strong></article>
        <article><span>Total collected</span><strong>{money(metrics.paid)}</strong></article>
        <article><span>Outstanding</span><strong>{money(metrics.outstanding)}</strong></article>
        <article className={metrics.overdueAmount > 0 ? "is-warning" : ""}><span>Overdue amount</span><strong>{money(metrics.overdueAmount)}</strong></article>
      </section>

      <section className="finance-accounts__panel">
        <div className="finance-accounts__toolbar">
          <div>
            <p>Installment register</p>
            <h2>{visible.length} account(s)</h2>
          </div>
          <div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Agreement, customer, phone or excavator"
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

        <div className="finance-accounts__grid">
          {visible.map((account) => {
            const tone = accountTone(account);
            const progress = paymentProgress(account);
            return (
              <article key={account.agreement_id} className={`finance-accounts__card is-${tone}`}>
                <div className="finance-accounts__card-head">
                  <div>
                    <small>{account.agreement_number}</small>
                    <h3>{account.customer_name}</h3>
                    <p>{account.asset_code} — {account.asset_name}</p>
                  </div>
                  <span>{label(tone)}</span>
                </div>
                <div className="finance-accounts__progress" aria-label={`${Math.round(progress)} percent paid`}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="finance-accounts__facts">
                  <div><span>Purchase price</span><strong>{money(account.total_amount)}</strong></div>
                  <div><span>Paid</span><strong>{money(account.amount_paid)}</strong></div>
                  <div><span>Balance</span><strong>{money(account.outstanding_balance)}</strong></div>
                  <div><span>Overdue</span><strong>{money(account.overdue_amount)}</strong></div>
                  <div><span>Next due</span><strong>{dateLabel(account.next_due_date)}</strong></div>
                  <div><span>Last payment</span><strong>{dateLabel(account.last_payment_at)}</strong></div>
                </div>
                {!account.reconciliation_consistent ? (
                  <div className="finance-accounts__inline-warning">Account reconciliation requires attention.</div>
                ) : null}
                <div className="finance-accounts__actions">
                  <button type="button" onClick={() => loadDetail(account)}>Open Account</button>
                  {Number(account.outstanding_balance || 0) > 0.01 ? (
                    <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${account.agreement_id}`}>
                      Record Payment
                    </Link>
                  ) : null}
                  <Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${account.customer_id}`}>
                    Customer Profile
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selected ? (
        <div className="finance-accounts__backdrop" role="presentation" onMouseDown={() => { setSelected(null); setDetail(null); }}>
          <section className="finance-accounts__dialog" role="dialog" aria-modal="true" aria-label="Installment account file" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-accounts__dialog-head">
              <div>
                <p>Authoritative account file</p>
                <h2>{selected.agreement_number}</h2>
                <span>{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span>
              </div>
              <button type="button" onClick={() => { setSelected(null); setDetail(null); }}>Close</button>
            </div>

            {detailLoading ? <div className="finance-accounts__empty">Loading account file…</div> : null}
            {!detailLoading ? (
              <>
                {selected.main_image_url ? (
                  <div className="finance-accounts__machine-image">
                    <img src={selected.main_image_url} alt={selected.asset_name || "Excavator"} />
                  </div>
                ) : null}
                {detail?.reconciliation?.consistent === false ? (
                  <div className="finance-accounts__notice is-error">
                    Payment and completion actions must remain blocked until receipts, allocations,
                    schedule and ledger evidence reconcile.
                  </div>
                ) : null}
                <div className="finance-accounts__summary">
                  <article><span>Official balance</span><strong>{money(selected.outstanding_balance)}</strong></article>
                  <article><span>Overdue</span><strong>{money(selected.overdue_amount)}</strong></article>
                  <article><span>Next due</span><strong>{dateLabel(selected.next_due_date)}</strong></article>
                  <article><span>Delivery</span><strong>{label(selected.delivery_status)}</strong></article>
                  <article><span>Ownership</span><strong>{label(selected.ownership_status)}</strong></article>
                </div>

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

                <div className="finance-accounts__dialog-actions">
                  <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${selected.agreement_id}`}>
                    Record Payment
                  </Link>
                  <Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${selected.customer_id}`}>
                    Customer Profile
                  </Link>
                  <Link to={`/equipment-installment-finance/applications?stage=case-operations&case_type=agreement&case_id=${selected.agreement_id}`}>
                    Case History
                  </Link>
                  <Link to="/equipment-installment-finance/applications?stage=corrections">
                    Corrections & Reversals
                  </Link>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
