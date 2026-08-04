import { Link } from "react-router";
import "../styles/installmentCompletionPhaseOne.css";

const WORKFLOW = [
  {
    number: 1,
    title: "Customer & Excavator",
    description: "Choose the buyer and exact available excavator with its protected photographs.",
    to: "/equipment-installment-finance/applications?stage=start",
    action: "Start installment",
  },
  {
    number: 2,
    title: "Application",
    description: "Create the offer, payment plan and recoverable application draft.",
    to: "/equipment-installment-finance/applications",
    action: "Open applications",
  },
  {
    number: 3,
    title: "Review & Approval",
    description: "Submit, review, request corrections and record the manager decision.",
    to: "/equipment-installment-finance/applications?stage=inbox",
    action: "Open approval inbox",
  },
  {
    number: 4,
    title: "Agreement",
    description: "Prepare the approved agreement and authoritative installment schedule.",
    to: "/equipment-installment-finance/applications?stage=activation",
    action: "Prepare agreement",
  },
  {
    number: 5,
    title: "Deposit & Reservation",
    description: "Record the controlled opening deposit before reserving the exact machine.",
    to: "/equipment-installment-finance/applications?stage=deposit",
    action: "Record deposit",
  },
  {
    number: 6,
    title: "Account & Payments",
    description: "Open the active customer account, payment history, balance and next due date.",
    to: "/equipment-installment-finance/applications?stage=collections",
    action: "Open active accounts",
  },
];

export default function EquipmentFinanceCompletionHomePage({ legacyWorkflow }) {
  return (
    <main className="installment-completion" data-testid="installment-completion-home">
      <header className="installment-completion__hero">
        <div>
          <p className="installment-completion__eyebrow">One clear operating path</p>
          <h1>Equipment Installment Finance</h1>
          <p>
            Start with the customer and excavator, approve the application, prepare the
            agreement, collect the deposit, then manage every payment from the active account.
          </p>
        </div>
        <div className="installment-completion__actions">
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=start">
            Start New Installment
          </Link>
          <Link to="/equipment-installment-finance/applications?stage=collections">
            Record / View Payments
          </Link>
        </div>
      </header>

      <section className="installment-completion__panel">
        <div className="installment-completion__section-heading">
          <div>
            <p className="installment-completion__eyebrow">How the system works</p>
            <h2>Complete these six business stages</h2>
            <span>Each page below has one purpose and one obvious next action.</span>
          </div>
        </div>
        <div className="installment-completion__workflow">
          {WORKFLOW.map((step) => (
            <article key={step.number} data-testid={`completion-workflow-step-${step.number}`}>
              <b>{step.number}</b>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <Link to={step.to}>{step.action} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="installment-completion__payment-guide" data-testid="where-to-record-payments">
        <div className="installment-completion__section-heading">
          <div>
            <p className="installment-completion__eyebrow">Payment guidance</p>
            <h2>Where do I record a payment?</h2>
            <span>
              Use Opening Deposits before activation. After the account is active, open Active
              Installments to see the customer balance, schedule and complete payment history.
            </span>
          </div>
          <div className="installment-completion__quick-links">
            <Link to="/equipment-installment-finance/applications?stage=deposit">
              Opening Deposit
            </Link>
            <Link to="/equipment-installment-finance/applications?stage=collections">
              Active Installments & Payments
            </Link>
            <Link to="/equipment-installment-finance/applications?stage=case-operations">
              Customer Case History
            </Link>
          </div>
        </div>
      </section>

      <section className="installment-completion__panel">
        <div className="installment-completion__section-heading">
          <div>
            <p className="installment-completion__eyebrow">Page responsibilities</p>
            <h2>No more duplicate-looking pages</h2>
          </div>
        </div>
        <div className="installment-completion__facts">
          <div><span>Applications & Approvals</span><strong>Full register and decisions</strong></div>
          <div><span>Task & Approval Inbox</span><strong>Work requiring action</strong></div>
          <div><span>Case Operations</span><strong>One case timeline and evidence</strong></div>
          <div><span>Active Installments</span><strong>Balances and payments</strong></div>
        </div>
      </section>

      <details className="installment-completion__legacy-details">
        <summary>Open detailed operational controls</summary>
        {legacyWorkflow}
      </details>
    </main>
  );
}
