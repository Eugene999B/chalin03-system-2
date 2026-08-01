import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceMinimalWorkflow.css";

const SALES_API = "/equipment-catalogue/sales";

const WORKFLOW_STEPS = [
  {
    number: 1,
    title: "Equipment list",
    description: "See every excavator that can be sold on installment and its current availability.",
    to: "/equipment-installment-finance/applications?stage=machines",
    action: "View equipment",
    key: "equipment",
  },
  {
    number: 2,
    title: "Add equipment",
    description: "Register the exact excavator, identifiers, selling price and photographs.",
    to: "/equipment-installment-finance/applications?stage=machines&action=add",
    action: "Add equipment",
    key: "equipment",
  },
  {
    number: 3,
    title: "Customer selection",
    description: "Select an existing Finance customer or create a new customer without duplicates.",
    to: "/equipment-installment-finance/applications?stage=start",
    action: "Choose customer",
    key: "customers",
  },
  {
    number: 4,
    title: "Create installment agreement",
    description: "Create the company-wide draft and its automatic Installment Offer.",
    to: "/equipment-installment-finance/applications?stage=start",
    action: "Start installment",
    key: "drafts",
  },
  {
    number: 5,
    title: "Configure terms",
    description: "Set selling price, deposit, payment interval, number of payments and first due date.",
    to: "/equipment-installment-finance/applications?stage=start",
    action: "Configure terms",
    key: "drafts",
  },
  {
    number: 6,
    title: "Preview schedule",
    description: "Use the backend-generated exact dates and amounts before saving the draft.",
    to: "/equipment-installment-finance/applications?stage=start",
    action: "Preview schedule",
    key: "drafts",
  },
  {
    number: 7,
    title: "Activate agreement",
    description: "Activate an approved application and create the authoritative installment schedule.",
    to: "/equipment-installment-finance/applications?stage=activation",
    action: "Activate agreement",
    key: "activation",
  },
  {
    number: 8,
    title: "Record payment",
    description: "Record the protected opening deposit and reserve the exact excavator; later payments continue in Collections.",
    to: "/equipment-installment-finance/applications?stage=deposit",
    action: "Record opening deposit",
    key: "collections",
  },
  {
    number: 9,
    title: "Balance and payment history",
    description: "View the official server balance, schedule allocation and complete payment history.",
    to: "/equipment-installment-finance/applications?stage=collections",
    action: "View account",
    key: "accounts",
  },
];

const PHASE_FOUR_ACTIONS = [
  "Cancel draft agreement",
  "Reverse incorrect payment",
  "Return or repossess equipment",
  "Post approved return credit",
  "Mark default",
  "Restructure schedule",
  "Waive charge with authorization",
  "Preserve the complete audit trail",
];

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "No payment recorded";
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

function StepStatus({ stepKey, data }) {
  if (stepKey === "equipment") {
    return <span>{data.availableMachines} available</span>;
  }
  if (stepKey === "customers") {
    return <span>{data.customers} customers</span>;
  }
  if (stepKey === "activation") {
    return <span>{data.activationCandidates} awaiting activation</span>;
  }
  if (["collections", "accounts"].includes(stepKey)) {
    return <span>{data.activeAccounts} active accounts</span>;
  }
  return <span>Guided workflow</span>;
}

export default function EquipmentFinanceMinimalWorkflowPage() {
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [bootstrap, setBootstrap] = useState({ customers: [], machines: [] });
  const [activationCandidates, setActivationCandidates] = useState([]);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setProblem("");
      const results = await Promise.allSettled([
        axiosClient.get(`${SALES_API}/phase-one/bootstrap`),
        axiosClient.get(`${SALES_API}/agreement-activations/candidates`),
        axiosClient.get(`${SALES_API}/finance-lifecycle/accounts`),
      ]);

      if (!active) return;

      const [bootstrapResult, activationResult, accountsResult] = results;
      if (bootstrapResult.status === "fulfilled") {
        setBootstrap({
          customers: bootstrapResult.value.data?.customers || [],
          machines: bootstrapResult.value.data?.machines || [],
        });
      }
      if (activationResult.status === "fulfilled") {
        setActivationCandidates(activationResult.value.data?.candidates || []);
      }
      if (accountsResult.status === "fulfilled") {
        setAccounts(accountsResult.value.data?.accounts || []);
      }

      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length === results.length) {
        setProblem(errorMessage(failures[0].reason, "Could not load the installment workflow."));
      }
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const status = useMemo(() => {
    const availableMachines = bootstrap.machines.filter(
      (machine) =>
        machine.sale_status === "available" &&
        machine.readiness?.ready !== false &&
        Number(machine.active_application_count || 0) === 0
    ).length;
    const activeAccounts = accounts.filter(
      (account) =>
        Number(account.outstanding_balance || 0) > 0 &&
        !["completed", "cancelled"].includes(String(account.agreement_status || ""))
    ).length;
    return {
      availableMachines,
      customers: bootstrap.customers.length,
      activationCandidates: activationCandidates.filter((item) => !item.agreement_id).length,
      activeAccounts,
    };
  }, [accounts, activationCandidates, bootstrap]);

  const recentAccounts = useMemo(
    () =>
      [...accounts]
        .sort((left, right) =>
          String(right.last_payment_date || right.created_at || "").localeCompare(
            String(left.last_payment_date || left.created_at || "")
          )
        )
        .slice(0, 5),
    [accounts]
  );

  return (
    <main className="finance-flow" data-testid="finance-minimal-workflow">
      <header className="finance-flow__hero">
        <div>
          <p>Equipment Installment Finance</p>
          <h1>Equipment Installment Workflow</h1>
          <span>
            Complete the essential sale journey in order. Official schedules, balances,
            payments and correction entries always come from the backend.
          </span>
        </div>
        <Link className="finance-flow__advanced" to="/equipment-installment-finance?view=advanced">
          Advanced command centre
        </Link>
      </header>

      {problem ? <div className="finance-flow__notice is-error" role="alert">{problem}</div> : null}
      <div className="finance-flow__notice" role="note">
        The frontend never calculates or stores the official debt balance. It displays the
        backend balance after every payment, reversal, waiver, return credit, penalty or damage entry.
      </div>

      <section className="finance-flow__summary" aria-label="Workflow status">
        <article><span>Available equipment</span><strong>{loading ? "…" : status.availableMachines}</strong></article>
        <article><span>Finance customers</span><strong>{loading ? "…" : status.customers}</strong></article>
        <article><span>Awaiting activation</span><strong>{loading ? "…" : status.activationCandidates}</strong></article>
        <article><span>Active accounts</span><strong>{loading ? "…" : status.activeAccounts}</strong></article>
      </section>

      <section className="finance-flow__section">
        <div className="finance-flow__section-head">
          <div>
            <p>Phase 3 · One controlled path</p>
            <h2>Complete these nine actions</h2>
          </div>
          <Link className="finance-flow__primary" to="/equipment-installment-finance/applications?stage=start">
            Start New Installment
          </Link>
        </div>

        <div className="finance-flow__steps">
          {WORKFLOW_STEPS.map((step) => (
            <article className="finance-flow__step" key={step.number} data-testid={`finance-step-${step.number}`}>
              <b>{step.number}</b>
              <div>
                <div className="finance-flow__step-title">
                  <h3>{step.title}</h3>
                  <StepStatus stepKey={step.key} data={status} />
                </div>
                <p>{step.description}</p>
                <Link to={step.to}>{step.action} →</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="finance-flow__section" data-testid="phase4-controls">
        <div className="finance-flow__section-head">
          <div>
            <p>Phase 4 · Sensitive financial scenarios</p>
            <h2>Corrections use approvals and accounting entries</h2>
          </div>
          <Link
            className="finance-flow__primary"
            to="/equipment-installment-finance/applications?stage=corrections"
          >
            Open Corrections & Returns
          </Link>
        </div>
        <div className="finance-flow__steps">
          {PHASE_FOUR_ACTIONS.map((action, index) => (
            <article className="finance-flow__step" key={action}>
              <b>{index + 1}</b>
              <div>
                <div className="finance-flow__step-title">
                  <h3>{action}</h3>
                  <span>Append-only evidence</span>
                </div>
                <p>
                  The original record remains unchanged or is explicitly voided; the approved
                  correction is preserved in the Finance ledger and audit trail.
                </p>
              </div>
            </article>
          ))}
        </div>
        <div className="finance-flow__notice" role="note">
          Returned equipment settlement: outstanding balance − approved return credit − refundable
          amounts + penalties or damages = final settlement balance. The active policy version and
          all approved components are recorded with the return.
        </div>
        <Link to="/equipment-installment-finance/applications?stage=governance">
          Open default and schedule-restructure governance →
        </Link>
      </section>

      <section className="finance-flow__section" data-testid="official-account-balances">
        <div className="finance-flow__section-head">
          <div>
            <p>Backend source of truth</p>
            <h2>Recent installment accounts</h2>
          </div>
          <Link to="/equipment-installment-finance/applications?stage=collections">Open collections</Link>
        </div>

        {loading ? <div className="finance-flow__empty">Loading official balances…</div> : null}
        {!loading && !recentAccounts.length ? (
          <div className="finance-flow__empty">No active installment account has been created yet.</div>
        ) : null}
        {!loading && recentAccounts.length ? (
          <div className="finance-flow__accounts">
            {recentAccounts.map((account) => (
              <article key={account.agreement_id || account.id} data-testid="finance-account-row">
                <div>
                  <small>{account.agreement_number}</small>
                  <strong>{account.customer_name}</strong>
                  <span>{account.asset_code} · {account.asset_name}</span>
                </div>
                <div>
                  <span>Official balance</span>
                  <strong data-testid="official-outstanding-balance">
                    {money(account.outstanding_balance)}
                  </strong>
                  <small>Last payment: {dateLabel(account.last_payment_date)}</small>
                </div>
                <Link
                  to={`/equipment-installment-finance/applications?stage=collections&agreement=${account.agreement_id || account.id}`}
                >
                  Payment history
                </Link>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
