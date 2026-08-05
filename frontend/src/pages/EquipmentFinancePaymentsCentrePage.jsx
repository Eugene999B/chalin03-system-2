import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceCollectionsMinimalPage from "./EquipmentFinanceCollectionsMinimalPage";
import "../styles/equipmentFinanceAccountsCompletion.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

export default function EquipmentFinancePaymentsCentrePage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setProblem("");
      try {
        const response = await axiosClient.get(`${API}/accounts`);
        if (active) setAccounts(response.data?.accounts || []);
      } catch (error) {
        if (active) setProblem(errorMessage(error, "Could not load payment-ready accounts."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    return accounts.reduce(
      (result, account) => {
        const outstanding = Number(account.outstanding_balance || 0);
        const overdue = Number(account.overdue_amount || 0);
        if (outstanding > 0.01 && account.reserved && !account.ownership_id) {
          result.collectable += 1;
        }
        if (overdue > 0.01) result.overdue += 1;
        result.paid += Number(account.amount_paid || 0);
        result.outstanding += outstanding;
        result.overdueAmount += overdue;
        return result;
      },
      { collectable: 0, overdue: 0, paid: 0, outstanding: 0, overdueAmount: 0 }
    );
  }, [accounts]);

  const priorityAccounts = useMemo(
    () =>
      accounts
        .filter(
          (account) =>
            account.reserved &&
            !account.ownership_id &&
            Number(account.outstanding_balance || 0) > 0.01
        )
        .sort((left, right) => {
          const overdueDifference =
            Number(right.overdue_amount || 0) - Number(left.overdue_amount || 0);
          if (overdueDifference) return overdueDifference;
          return String(left.next_due_date || "9999").localeCompare(
            String(right.next_due_date || "9999")
          );
        })
        .slice(0, 8),
    [accounts]
  );

  return (
    <div className="finance-payments" data-testid="finance-payments-centre">
      <header className="finance-accounts__hero">
        <div>
          <p>Authorised payment entry</p>
          <h1>Payments &amp; Collections Centre</h1>
          <span>
            Select an active customer account, record the amount received, and let the backend
            allocate it oldest-due-first across the installment schedule before issuing the receipt.
          </span>
        </div>
        <div className="finance-accounts__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=accounts">Active Installments</Link>
          <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">Customer Profiles</Link>
          <Link to="/equipment-installment-finance/applications?stage=corrections">Corrections &amp; Reversals</Link>
        </div>
      </header>

      {problem ? <div className="finance-accounts__notice is-error" role="alert">{problem}</div> : null}
      <div className="finance-accounts__notice">
        Use this page for normal receipts only. Never delete or edit a committed payment.
        Incorrect receipts must go through Corrections &amp; Reversals with approval and audit evidence.
      </div>

      <section className="finance-accounts__metrics">
        <article><span>Ready for collection</span><strong>{metrics.collectable}</strong></article>
        <article className={metrics.overdue > 0 ? "is-warning" : ""}><span>Overdue accounts</span><strong>{metrics.overdue}</strong></article>
        <article><span>Total collected</span><strong>{money(metrics.paid)}</strong></article>
        <article><span>Outstanding</span><strong>{money(metrics.outstanding)}</strong></article>
        <article className={metrics.overdueAmount > 0 ? "is-warning" : ""}><span>Overdue amount</span><strong>{money(metrics.overdueAmount)}</strong></article>
      </section>

      <section className="finance-accounts__panel">
        <div className="finance-accounts__section-head">
          <div>
            <p>Priority payment actions</p>
            <h2>Choose the customer account</h2>
            <span>Overdue accounts appear first, followed by the nearest payment dates.</span>
          </div>
        </div>
        {loading ? <div className="finance-accounts__empty">Loading payment-ready accounts…</div> : null}
        {!loading && !priorityAccounts.length ? <div className="finance-accounts__empty">No active account currently has a collectible balance.</div> : null}
        <div className="finance-accounts__priority-grid">
          {priorityAccounts.map((account) => (
            <article key={account.agreement_id}>
              <small>{account.agreement_number}</small>
              <h3>{account.customer_name}</h3>
              <p>{account.asset_code} — {account.asset_name}</p>
              <div>
                <span>Balance <strong>{money(account.outstanding_balance)}</strong></span>
                <span>Overdue <strong>{money(account.overdue_amount)}</strong></span>
                <span>Next due <strong>{dateLabel(account.next_due_date)}</strong></span>
              </div>
              <div className="finance-accounts__actions">
                <Link className="is-primary" to={`/equipment-installment-finance/applications?stage=collections&agreement=${account.agreement_id}`}>
                  Record Payment
                </Link>
                <Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${account.customer_id}`}>
                  Customer Profile
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="finance-payments__entry" aria-label="Payment entry workspace">
        <EquipmentFinanceCollectionsMinimalPage />
      </section>
    </div>
  );
}
