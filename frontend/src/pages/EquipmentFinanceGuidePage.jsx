import { Link } from "react-router";
import "../styles/equipmentFinancePhaseOne.css";

const GUIDES = [
  {
    title: "1. Start a new installment",
    points: [
      "Open Start New Installment.",
      "Search for the customer before creating a new record.",
      "Select the exact available excavator.",
      "Set the selling price, deposit, payment frequency and number of payments.",
      "Complete KYC, affordability and consent, then create the draft.",
    ],
  },
  {
    title: "2. What is an Installment Offer?",
    points: [
      "It is the commercial offer for the selected excavator.",
      "It contains the agreed price, deposit, payment frequency, number of payments and first due date.",
      "The wizard creates and approves it automatically in the background.",
      "Staff no longer need to search for a separate quotation page before creating the credit application.",
    ],
  },
  {
    title: "3. Create or update customers",
    points: [
      "Use the Finance Customer Centre for reusable customer profiles.",
      "Search by name, phone, code or email to prevent duplicates.",
      "Start another installment directly from the customer card.",
      "Finance customers are company-wide; do not select a Hire location.",
    ],
  },
  {
    title: "4. Register and edit excavators",
    points: [
      "Use the single Excavators page for registration, reference and photos.",
      "Capture at least one complete main photo and the serial or chassis number.",
      "Enter the target sale value and protected minimum price.",
      "Details can be edited only before an active installment application, reservation or agreement begins.",
    ],
  },
  {
    title: "5. KYC and guarantor",
    points: [
      "Record the customer Ghana Card or other approved ID, address, work or business and emergency contact.",
      "A guarantor is required by the current internal policy when the financed balance reaches GHS 100,000.",
      "The person creating the draft does not mark evidence verified.",
      "An authorised reviewer checks identity, address, income and guarantor evidence independently.",
    ],
  },
  {
    title: "6. Affordability",
    points: [
      "Enter all monthly income, business costs, household expenses and existing monthly debt.",
      "The system estimates the payment burden, monthly surplus, debt-service ratio and risk.",
      "Manual review or an ineligible result must be addressed before approval.",
      "Never change income figures merely to force an approval.",
    ],
  },
  {
    title: "7. Submit and approve",
    points: [
      "Draft or changes-requested applications may be recalculated and submitted.",
      "The manager starts review, verifies KYC, requests corrections, approves or declines.",
      "Approval is only a credit decision; it does not collect money or transfer the excavator.",
      "Keep a clear reason for every rejection, requested change or decline.",
    ],
  },
  {
    title: "8. Agreement and signatures",
    points: [
      "After approval, activate the agreement from the approved application.",
      "Generate the professional PDF and editable Word-compatible agreement pack.",
      "Capture the seller, buyer, witness and guarantor signatures required by Finance settings.",
      "Do not treat an unsigned draft as a completed legal agreement.",
    ],
  },
  {
    title: "9. Deposit and reservation",
    points: [
      "Record the opening deposit only after the agreement is ready.",
      "The system reserves the exact excavator through the controlled deposit workflow.",
      "A payment receipt and boss alert are separate evidence steps.",
      "Do not mark the excavator sold from the machine editor.",
    ],
  },
  {
    title: "10. Payments and arrears",
    points: [
      "Record partial, exact or excess payments using Installment Collections.",
      "The system allocates money to the oldest due installments first.",
      "Use Payments & Arrears for due, overdue, promise and follow-up work.",
      "Never delete a posted payment; use the controlled correction or reversal process.",
    ],
  },
  {
    title: "11. Delivery and ownership",
    points: [
      "Delivery follows the configured deposit, percentage or full-payment rule.",
      "Capture handover condition, meter, photos and signatures.",
      "Ownership transfer is completed only after settlement and all required evidence.",
      "Delivery is not the same as legal ownership transfer.",
    ],
  },
  {
    title: "12. Common problems",
    points: [
      "No excavator appears: check sale purpose, sale status, active Hire work, required identity and a complete photo.",
      "Cannot edit excavator: an active application, reservation or agreement has locked the protected record.",
      "Cannot submit: required KYC, consent, guarantor or affordability information is incomplete.",
      "Large values should wrap fully on phones; report any remaining clipped amount with a screenshot and page name.",
    ],
  },
];

export default function EquipmentFinanceGuidePage() {
  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Beginner-friendly operating guide</p>
          <h1>Installment Finance Help &amp; Guide</h1>
          <span>
            This guide is only for Equipment Installment Finance. It does not mix Hire
            enquiries, Hire contracts, dispatches or returns into the Finance workflow.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">
            Start New Installment
          </Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications">
            Applications &amp; Approvals
          </Link>
        </div>
      </header>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">What should I do first?</p>
        <h2>Follow one simple journey</h2>
        <div className="finance-simple__summary">
          <article><span>1</span><strong>Create or select the customer</strong></article>
          <article><span>2</span><strong>Select the exact excavator</strong></article>
          <article><span>3</span><strong>Set price and payment plan</strong></article>
          <article><span>4</span><strong>Complete KYC and affordability</strong></article>
          <article><span>5</span><strong>Submit for independent approval</strong></article>
          <article><span>6</span><strong>Agreement → deposit → payments → delivery → ownership</strong></article>
        </div>
        <div className="finance-simple__notice is-info">
          The system creates the Installment Offer automatically during Start New Installment.
          Finance is company-wide, so a worker should never be blocked by a Hire-location selector.
        </div>
      </section>

      <section className="finance-simple__guide-grid">
        {GUIDES.map((guide) => (
          <article className="finance-simple__guide-card" key={guide.title}>
            <h3>{guide.title}</h3>
            <ul className="finance-simple__guide-list">
              {guide.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </article>
        ))}
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Quick page map</p>
        <h2>Where to go</h2>
        <div className="finance-simple__guide-grid">
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=customers"><h3>Customers</h3><p>Create, search or update a reusable customer profile.</p></Link>
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=machines"><h3>Excavators</h3><p>Register, view complete photos and safely edit available machines.</p></Link>
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications"><h3>Applications &amp; Approvals</h3><p>Submit, verify, review, approve or request corrections.</p></Link>
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=collections"><h3>Active Installments</h3><p>Open active accounts and record collections.</p></Link>
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/applications?stage=arrears"><h3>Payments &amp; Arrears</h3><p>Work due, overdue and follow-up cases.</p></Link>
          <Link className="finance-simple__guide-card" to="/equipment-installment-finance/reports"><h3>Documents &amp; Reports</h3><p>Use agreement documents, evidence and management reports.</p></Link>
        </div>
      </section>
    </main>
  );
}
