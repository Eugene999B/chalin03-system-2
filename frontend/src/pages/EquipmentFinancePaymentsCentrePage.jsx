import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceCollectionsMinimalPage from "./EquipmentFinanceCollectionsMinimalPage";
import "../styles/equipmentFinanceAccountsCompletion.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
        if (outstanding > 0.01 && account.reserved && !account.ownership_id) result.collectable += 1;
        if (overdue > 0.01) result.overdue += 1;
        result.paid += Number(account.amount_paid || 0);
        result.outstanding += outstanding;
        result.overdueAmount += overdue;
        return result;
      },
      { collectable: 0, overdue: 0, paid: 0, outstanding: 0, overdueAmount: 0 }
    );
  }, [accounts]);

  return (
    <div className="finance-payments finance-simplified" data-testid="finance-payments-centre">
      <header className="finance-accounts__hero">
        <div>
          <p>One clean payment workspace</p>
          <h1>Payments &amp; Collections Centre</h1>
          <span>
            Search for the customer or agreement, select the correct account, then record the
            payment. Account details and payment history remain hidden until selection.
          </span>
        </div>
        <div className="finance-accounts__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=accounts">Active Installments</Link>
          <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">Customer Profiles</Link>
          <Link to="/equipment-installment-finance/applications?stage=corrections">Corrections &amp; Reversals</Link>
        </div>
      </header>

      {problem ? <div className="finance-accounts__notice is-error" role="alert">{problem}</div> : null}

      <section className="finance-accounts__metrics">
        <article><span>Ready for collection</span><strong>{loading ? "…" : metrics.collectable}</strong></article>
        <article className={metrics.overdue > 0 ? "is-warning" : ""}><span>Overdue accounts</span><strong>{loading ? "…" : metrics.overdue}</strong></article>
        <article><span>Total collected</span><strong>{money(metrics.paid)}</strong></article>
        <article><span>Outstanding</span><strong>{money(metrics.outstanding)}</strong></article>
        <article className={metrics.overdueAmount > 0 ? "is-warning" : ""}><span>Overdue amount</span><strong>{money(metrics.overdueAmount)}</strong></article>
      </section>

      <section className="finance-payments__entry" aria-label="Payment entry workspace">
        <EquipmentFinanceCollectionsMinimalPage embedded />
      </section>
    </div>
  );
}
