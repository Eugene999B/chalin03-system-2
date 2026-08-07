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
    description: "Monitor the active account, then record receipts from the dedicated Payments Centre.",
    to: "/equipment-installment-finance/applications?stage=accounts",
    action: "Open active accounts",
  },
];

export default function EquipmentFinanceCompletionHomePage() {
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
            Record Payment
          </Link>
          <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">
            Customer Profiles
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
          <Link className="installment-completion__button" to="/equipment-installment-finance?view=advanced">
            Advanced command centre
          </Link>
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
              Use Opening Deposits before activation. After activation, use Active Installments
              for read-only account monitoring and Payments & Collections for every normal receipt.
            </span>
          </div>
          <div className="installment-completion__quick-links">
            <Link to="/equipment-installment-finance/applications?stage=deposit">
              Opening Deposit
            </Link>
            <Link to="/equipment-installment-finance/applications?stage=accounts">
              Active Installments
            </Link>
            <Link to="/equipment-installment-finance/applications?stage=collections">
              Payments & Collections
            </Link>
            <Link to="/equipment-installment-finance/applications?stage=customer-portfolios">
              Customer Installment Profile
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
          <div><span>Active Installments</span><strong>Read-only balances and schedules</strong></div>
          <div><span>Payments & Collections</span><strong>Record receipts and allocations</strong></div>
          <div><span>Customer Profiles</span><strong>Complete customer installment history</strong></div>
        </div>
      </section>
    </main>
  );
}
