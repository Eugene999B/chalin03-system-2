import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinancePhaseOne.css";

const BOOTSTRAP_API = "/equipment-catalogue/sales/phase-one/bootstrap";
const APPLICATION_API = "/equipment-catalogue/sales/credit-applications";
const ACCOUNTS_API = "/equipment-catalogue/sales/finance-lifecycle/accounts";

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

export default function EquipmentInstallmentCommandPage() {
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [applications, setApplications] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [bootstrapResult, applicationResult, accountResult] = await Promise.allSettled([
        axiosClient.get(BOOTSTRAP_API),
        axiosClient.get(APPLICATION_API),
        axiosClient.get(ACCOUNTS_API),
      ]);
      if (bootstrapResult.status === "fulfilled") {
        setCustomers(bootstrapResult.value.data?.customers || []);
        setMachines(bootstrapResult.value.data?.machines || []);
      } else {
        throw bootstrapResult.reason;
      }
      if (applicationResult.status === "fulfilled") {
        setApplications(applicationResult.value.data?.applications || []);
      }
      if (accountResult.status === "fulfilled") {
        setAccounts(
          accountResult.value.data?.accounts ||
            accountResult.value.data?.agreements ||
            accountResult.value.data?.items ||
            []
        );
      }
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance home page."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const availableMachines = machines.filter(
      (machine) =>
        machine.readiness?.ready &&
        machine.sale_status === "available" &&
        Number(machine.active_application_count || 0) === 0
    );
    const draftApplications = applications.filter((application) =>
      ["draft", "changes_requested"].includes(application.application_status)
    );
    const reviewApplications = applications.filter((application) =>
      ["submitted", "under_review"].includes(application.application_status)
    );
    const activeAccounts = accounts.filter((account) =>
      !["completed", "cancelled"].includes(account.agreement_status || account.status)
    );
    const overdueAccounts = activeAccounts.filter(
      (account) => Number(account.overdue_amount || 0) > 0 || (account.agreement_status || account.status) === "overdue"
    );
    return {
      availableMachines,
      draftApplications,
      reviewApplications,
      activeAccounts,
      overdueAccounts,
      outstanding: activeAccounts.reduce(
        (sum, account) => sum + Number(account.outstanding_balance || account.balance || 0),
        0
      ),
    };
  }, [accounts, applications, machines]);

  const nextWork = [
    ...summary.reviewApplications.map((item) => ({
      key: `review-${item.id}`,
      title: `${item.application_number} needs review`,
      detail: `${item.customer_name} · ${item.asset_code || "Excavator"}`,
      status: item.application_status,
      path: "/equipment-installment-finance/applications",
    })),
    ...summary.draftApplications.map((item) => ({
      key: `draft-${item.id}`,
      title: `${item.application_number} is not submitted`,
      detail: `${item.customer_name} · KYC ${label(item.kyc_status)}`,
      status: item.application_status,
      path: "/equipment-installment-finance/applications",
    })),
    ...summary.overdueAccounts.map((item) => ({
      key: `arrears-${item.id}`,
      title: `${item.agreement_number || "Account"} has arrears`,
      detail: `${item.customer_name || "Customer"} · ${money(item.overdue_amount || item.outstanding_balance)}`,
      status: "overdue",
      path: "/equipment-installment-finance/applications?stage=arrears",
    })),
  ].slice(0, 12);

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Simple Finance home</p>
          <h1>What do you need to do today?</h1>
          <span>
            Begin with Start New Installment, or continue a draft, approval, payment or arrears task.
            Finance is company-wide and never requires a Hire-location selection.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">
            + Start New Installment
          </Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">
            Open Help &amp; Guide
          </Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      <div className="finance-simple__notice is-info">
        Normal journey: Customer → Excavator → Price &amp; Plan → KYC → Approval → Agreement → Deposit → Payments → Delivery → Ownership.
      </div>

      {loading ? <div className="finance-simple__empty">Preparing the Finance home page…</div> : null}

      {!loading ? (
        <>
          <section className="finance-simple__metrics">
            <article className="finance-simple__metric"><span>Finance customers</span><strong>{customers.length}</strong></article>
            <article className="finance-simple__metric"><span>Available excavators</span><strong>{summary.availableMachines.length}</strong></article>
            <article className="finance-simple__metric"><span>Awaiting review</span><strong>{summary.reviewApplications.length}</strong></article>
            <article className="finance-simple__metric"><span>Outstanding portfolio</span><strong>{money(summary.outstanding)}</strong></article>
          </section>

          <section className="finance-simple__section">
            <div className="finance-simple__section-header">
              <div><p className="finance-simple__eyebrow">Quick actions</p><h2>Begin or continue work</h2></div>
              <button type="button" onClick={load}>Refresh</button>
            </div>
            <div className="finance-simple__guide-grid">
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=start"><h3>Start New Installment</h3><p>Create or select the customer, choose the excavator and make the automatic Installment Offer.</p></Link>
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=customers"><h3>Add or Find Customer</h3><p>Search by phone or name, update details and start another installment.</p></Link>
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=machines"><h3>Register Excavator</h3><p>Add machine identity, sale values and complete uncropped photos.</p></Link>
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications"><h3>Review Applications</h3><p>Complete drafts, verify KYC and record independent decisions.</p></Link>
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=collections"><h3>Record Payment</h3><p>Open an active account and record a partial, exact or excess payment.</p></Link>
              <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=arrears"><h3>Work Arrears</h3><p>Review overdue accounts, reminders, promises and customer statements.</p></Link>
            </div>
          </section>

          <section className="finance-simple__section">
            <div className="finance-simple__section-header">
              <div><p className="finance-simple__eyebrow">Attention needed</p><h2>{nextWork.length} immediate item(s)</h2></div>
              <Link className="finance-simple__button" to="/equipment-installment-finance/applications">Open all applications</Link>
            </div>
            {!nextWork.length ? <div className="finance-simple__empty">No draft, review or arrears item needs immediate attention.</div> : null}
            <div className="finance-simple__cards">
              {nextWork.map((item) => (
                <article className="finance-simple__card" key={item.key}>
                  <div className="finance-simple__card-body">
                    <span className={`finance-simple__pill ${item.status === "overdue" ? "is-danger" : "is-warning"}`}>{label(item.status)}</span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <Link className="finance-simple__button is-primary" to={item.path}>Open work</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="finance-simple__section">
            <p className="finance-simple__eyebrow">Portfolio snapshot</p>
            <div className="finance-simple__summary">
              <article><span>Drafts / changes requested</span><strong>{summary.draftApplications.length}</strong></article>
              <article><span>Active installment accounts</span><strong>{summary.activeAccounts.length}</strong></article>
              <article><span>Accounts with arrears</span><strong>{summary.overdueAccounts.length}</strong></article>
              <article><span>Finance-ready machine value</span><strong className="finance-simple__money">{money(summary.availableMachines.reduce((sum, machine) => sum + Number(machine.target_selling_price || 0), 0))}</strong></article>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
