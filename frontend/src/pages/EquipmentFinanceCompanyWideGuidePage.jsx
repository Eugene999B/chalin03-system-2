import { Link } from "react-router";
import "../styles/equipmentFinancePhaseOne.css";

const steps = [
  {
    number: 1,
    title: "Create the draft",
    text: "Select an existing customer or create one with at least a name and phone number. Select the exact sale-ready excavator and enter the proposed price, deposit and payment plan. KYC, income and guarantor information may be completed later.",
    action: "Start New Installment",
    path: "/equipment-installment-finance/applications?stage=start",
  },
  {
    number: 2,
    title: "Confirm every payment date",
    text: "Choose weekly, every 14 days, monthly, or a custom number of days such as 10, 21 or 30. Choose the first due date and weekend rule. Review every exact date and the final adjusted payment before creating the draft.",
  },
  {
    number: 3,
    title: "Complete the assessment",
    text: "Open the draft in Applications. Add the customer ID, address, employment or business details, affordability income and expenses, consent and any required guarantor. Upload protected evidence in Case Operations. These details are required before submission, not before saving the draft.",
    action: "Applications & Approvals",
    path: "/equipment-installment-finance/applications",
  },
  {
    number: 4,
    title: "Submit for independent review",
    text: "Recalculate affordability and submit the completed file. The person who created or submitted the case cannot approve it. The reviewer sees the complete affordability figures, exact schedule, documents, open tasks and chronology in one file.",
  },
  {
    number: 5,
    title: "Activate the approved agreement",
    text: "Activation copies the approved customer, exact excavator, price, deposit, interval and every due date into the agreement. The first due date cannot be silently changed. A date change requires a numbered and approved schedule amendment.",
    action: "Activation queue",
    path: "/equipment-installment-finance/applications?stage=activation",
  },
  {
    number: 6,
    title: "Collect the opening deposit",
    text: "The Finance Manager or Accountant records partial opening deposits with an idempotency key. The exact machine is reserved only after the required deposit is complete and only when it is not active on Hire.",
    action: "Deposit & Reservation",
    path: "/equipment-installment-finance/applications?stage=deposit",
  },
  {
    number: 7,
    title: "Record installment payments",
    text: "Collections are allocated to the oldest unpaid schedule line first, then future lines. Partial payments and payments covering several periods are allowed, but payment above the remaining account balance is blocked. A thermal receipt and boss-alert status are recorded.",
    action: "Active Installments",
    path: "/equipment-installment-finance/applications?stage=collections",
  },
  {
    number: 8,
    title: "Follow arrears safely",
    text: "Use Payments & Arrears for due accounts, overdue balances, promises, reminders and follow-up notes. Never rewrite an original payment or schedule row. Use controlled corrections and approved amendments when a genuine change is required.",
    action: "Payments & Arrears",
    path: "/equipment-installment-finance/applications?stage=arrears",
  },
  {
    number: 9,
    title: "Deliver with verified evidence",
    text: "When the agreement reaches its approved delivery threshold, upload and verify the customer signature and delivery note in Case Operations. Select those protected files in the Delivery screen; do not paste an external URL.",
    action: "Delivery",
    path: "/equipment-installment-finance/applications?stage=delivery",
  },
  {
    number: 10,
    title: "Transfer ownership after settlement",
    text: "Ownership can transfer only after full settlement and controlled delivery. Upload and verify the ownership or registration-transfer document, then select it in the Ownership screen. The exact excavator is marked sold and the complete action is audit recorded.",
    action: "Ownership",
    path: "/equipment-installment-finance/applications?stage=ownership",
  },
];

const commonProblems = [
  {
    title: "Why can I create a draft without salary or ID details?",
    answer: "The first contact may not have every document available. The system permits a basic draft but blocks submission and approval until the required assessment is complete.",
  },
  {
    title: "Why is there no Hire location selector?",
    answer: "Installment Finance is one company-wide portfolio. Finance records do not store a Hire location. Hire locations remain only in Equipment Hire operations.",
  },
  {
    title: "Why can I not change the first due date during activation?",
    answer: "The customer and reviewer approved the dated Offer. Changing it during activation would bypass approval. Use a controlled schedule amendment instead.",
  },
  {
    title: "Why is a machine missing from Start New Installment?",
    answer: "It may be inactive, not authorised for sale, already reserved or sold, active on Hire, missing required identity information, or already linked to another live Finance case.",
  },
  {
    title: "Why can I not approve a case I created?",
    answer: "Independent review protects the company and customer. Another authorised Finance reviewer must inspect and decide the case. The protected original System Administrator retains emergency owner authority.",
  },
  {
    title: "Where do I upload delivery and ownership documents?",
    answer: "Open Case Operations, select the application or agreement, upload the protected file and have an authorised reviewer verify it. The lifecycle screen then lists the verified file for selection.",
  },
];

export default function EquipmentFinanceCompanyWideGuidePage() {
  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Company-wide operating guide</p>
          <h1>Finance Help & Guide</h1>
          <span>
            The complete safe path from the first customer discussion to final ownership—without any Hire-location requirement.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">Start New Installment</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance">Finance Home</Link>
        </div>
      </header>

      <div className="finance-simple__notice is-info">
        <strong>Installment Finance is company-wide.</strong>
        <p>No Finance application, agreement, payment, delivery or ownership transfer asks for or stores a Hire location.</p>
      </div>

      <section className="finance-simple__section">
        <div className="finance-simple__section-header">
          <div><p className="finance-simple__eyebrow">Daily process</p><h2>Ten controlled steps</h2></div>
        </div>
        <div className="finance-simple__cards">
          {steps.map((step) => (
            <article className="finance-simple__card" key={step.number}>
              <div className="finance-simple__card-body">
                <small>Step {step.number}</small>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                {step.path ? <Link className="finance-simple__button" to={step.path}>{step.action}</Link> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="finance-simple__section">
        <div className="finance-simple__section-header">
          <div><p className="finance-simple__eyebrow">Important rules</p><h2>What the system must never bypass</h2></div>
        </div>
        <div className="finance-simple__checks finance-simple__checks--cards">
          <span className="is-complete">✓ Exact customer and excavator identity</span>
          <span className="is-complete">✓ Exact dated schedule before approval</span>
          <span className="is-complete">✓ Independent application review</span>
          <span className="is-complete">✓ Full deposit before reservation</span>
          <span className="is-complete">✓ No machine active on Hire</span>
          <span className="is-complete">✓ Oldest-due-first payment allocation</span>
          <span className="is-complete">✓ Verified private lifecycle evidence</span>
          <span className="is-complete">✓ No ownership before full settlement</span>
          <span className="is-complete">✓ Original payments and documents remain immutable</span>
          <span className="is-complete">✓ Every decision and correction is audit recorded</span>
        </div>
      </section>

      <section className="finance-simple__section">
        <div className="finance-simple__section-header">
          <div><p className="finance-simple__eyebrow">Questions</p><h2>Common staff problems</h2></div>
        </div>
        {commonProblems.map((item) => (
          <details key={item.title}>
            <summary>{item.title}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </section>

      <section className="finance-simple__section">
        <h2>Need to investigate a specific case?</h2>
        <p>Open the complete application file or Case Operations. The timeline, protected documents, tasks, amendments, receipts and sharing evidence belong to that exact case.</p>
        <div className="finance-simple__actions">
          <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications">Applications & Approvals</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=operations&tab=case">Case Operations</Link>
        </div>
      </section>
    </main>
  );
}
