import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import "../styles/workspaceHelp.css";

const helpContent = {
  mining: {
    icon: "⛏️",
    title: "Mining Operations User Guide",
    label: "Mining Operations",
    home: "/mining",
    searchExample: "site, shift, production, fuel, incident, worker, document",
    sections: [
      ["1. Mining login and site context", "Use a Mining account and select an authorized Mining site. Spare Parts stores and Equipment Sales & Hire locations do not apply. The selected site controls all operational records and direct links to another category are blocked.", ["Confirm the active site", "Use your own login", "Request site access from Mining administration"]],
      ["2. Sites, staff access and administration", "Authorized Mining administrators create sites, maintain targets and assign users to approved locations. Site codes, material, units, status and contact details must reflect the real operation. Deactivate obsolete sites rather than deleting history.", ["Do not reuse store or Hire codes", "Review staff assignments", "Preserve inactive history"]],
      ["3. Daily site and shift logs", "Create the correct daily or shift log, record supervisor, crew, weather, opening condition, start and end times, and closing notes. Approve only after checking production, fuel, equipment, expense and incident evidence.", ["Use one site and shift", "Record real times", "Keep preparation and approval independent"]],
      ["4. Production, stockpiles and dispatch", "Record measured production against the correct site, date, shift, material and unit. Track stockpile movements and dispatch references so opening quantity, production, movement and closing quantity reconcile.", ["Use measured quantities", "Reference source records", "Investigate differences before closing"]],
      ["5. Equipment, meters and maintenance", "Assign the correct registered fleet asset and operator, then record opening and closing meters, working time, idle time, breakdowns and inspections. Open maintenance evidence when a defect, service interval or safety condition requires action.", ["Check asset availability", "Record meter evidence", "Do not ignore maintenance alerts"]],
      ["6. Fuel receipts, issues and reconciliation", "Record fuel receipts, tank balances, machine issues and transfers using measured quantities. Every issue needs the correct site, asset, quantity, meter or shift context, responsible person and supporting reference.", ["Measure balances", "Avoid duplicate issues", "Explain every variance"]],
      ["7. Expenses, contractors and approvals", "Record genuine Mining costs under the correct site, category, contractor or supplier and funding context. Mining expenses never post through a Spare Parts store or a Hire customer account. Sensitive changes require the appropriate reason and approval.", ["Use the correct category", "Attach references", "Review approval evidence"]],
      ["8. Incidents and corrective action", "Record safety, environmental, security, production and equipment incidents promptly. Preserve the original report, record severity honestly, assign corrective actions and close only after evidence and independent verification.", ["Report promptly", "Assign a responsible person", "Verify closure evidence"]],
      ["9. Site closing and management review", "Complete closing after production, stockpile, dispatch, fuel, equipment, expenses and incidents are reviewed. Never force unexplained differences to zero. Management sign-off confirms review and does not erase a real variance.", ["Reconcile before submission", "Explain differences", "Use independent verification"]],
      ["10. Reports, notifications and shared controls", "Use Mining reports, shared documents, notifications and audit evidence for the selected site and period. Automatic rule refresh raises low-stockpile, low-fuel, approval, variance, incident and closing alerts; administrators may still run a manual sync during investigation. Confirm filters before exporting and keep operational, staff and contractor information private.", ["Confirm site and dates", "Review notifications", "Protect exported records"]],
      ["11. Workers, employment documents and signatures", "Mining worker profiles, assignments, licences and documents belong only to Mining. Employment letters may be prepared before worker registration. Approved documents can use the protected boss signature; historical approved signature snapshots do not change when the saved signature is updated.", ["Use the Mining workforce only", "Review before approval", "Protect private worker files"]],
      ["12. Security, passwords and support", "Use password-only sign-in, least-privilege permissions and controlled corrections. Wrong operational entries must use controlled cancellation, adjustment, status correction or a documented replacement record; do not delete database rows directly. Review Activity Log evidence and notify the System Administrator before repeating a failed sensitive action. Never share passwords, OTPs, private files or production backup data.", ["Keep your password private", "Escalate unusual errors", "Do not bypass permissions"]],
    ],
  },
  equipment_hire: {
    icon: "🏗️",
    title: "Equipment Sales & Hire User Guide",
    label: "Equipment Sales & Hire",
    home: "/equipment-hire-operations",
    searchExample: "catalogue, sale, installment, enquiry, quotation, dispatch, return",
    sections: [
      ["1. Sales & Hire login and location context", "Use an Equipment Sales & Hire account and select an authorized base, yard, office or depot. Mining sites and Spare Parts stores are independent. The selected Hire location controls customers, commercial records, payments and reports.", ["Confirm the active location", "Use your own login", "Do not follow cross-category workarounds"]],
      ["2. Locations, users and administration", "Authorized administrators create locations and assign staff access. Maintain accurate location codes, addresses, contacts and status. Deactivate obsolete locations rather than deleting records needed for contracts, sales, payments or audits.", ["Do not reuse store or site records", "Review access assignments", "Preserve inactive history"]],
      ["3. Equipment Catalogue and secure pictures", "Register each machine once with its identity, serial, chassis, engine, condition, location, Hire rate and selling price. Add clear protected photographs and evidence. The same fleet asset supports sale, Hire or both according to its approved availability state.", ["Search before registering", "Verify serial and chassis", "Use clear condition evidence"]],
      ["4. Equipment sales enquiries and quotations", "Record the buyer, requested machine, terms and supporting evidence. Prepare an itemized quotation with validity, price, deposit, delivery and finance terms. Required approval must be completed before creating a sale agreement.", ["Confirm the customer", "Review all commercial terms", "Preserve rejected and expired quotations"]],
      ["5. Equipment sale agreements and installments", "Create agreements only from approved terms. Record deposit, schedule, payment cadence, due dates, delivery controls and ownership conditions. Every payment must be allocated once, receipted and reflected in the outstanding balance. Equipment installments exist here, not in Spare Parts.", ["Review the schedule", "Avoid duplicate payments", "Use controlled rescheduling"]],
      ["6. Equipment delivery and ownership", "Before delivery, confirm required deposit or approval, asset identity, customer acknowledgement, condition and evidence. Ownership transfer or final release must follow the agreement and complete payment/approval rules; never release an asset merely because a frontend button is visible.", ["Verify asset identity", "Capture delivery evidence", "Confirm ownership conditions"]],
      ["7. Hire customers and enquiries", "Create or select the correct customer, then record requested machine, job site, dates, charging basis, operator and fuel responsibility, mobilization needs and special conditions.", ["Search before creating a customer", "Confirm the job site", "Record request evidence"]],
      ["8. Availability and rate cards", "Check sale locks, maintenance, existing contracts and asset condition before quoting. Use approved rates, minimum charges, overtime, mobilization, demobilization, deposits and damage rules. Do not double-book or hire a machine reserved for sale.", ["Check real availability", "Use approved rates", "Explain approved exceptions"]],
      ["9. Hire quotations, contracts and amendments", "Prepare complete terms, obtain required approval and convert only approved quotations. Record assigned assets, dates, customer obligations and deposit conditions. Commercial amendments require a truthful reason, preserved revision history and approval where configured.", ["Confirm asset and dates", "Preserve revisions", "Use controlled approval"]],
      ["10. Dispatch, job cards and work logs", "Dispatch records the opening meter, fuel, operator, condition and evidence. Work logs record billable time, idle time, customer acknowledgement and responsibility. Approved work is the basis for invoicing.", ["Photograph condition", "Record meters accurately", "Approve billable work"]],
      ["11. Invoices, deposits, payments and balances", "Invoice approved work and commercial charges, then record every deposit, payment, allocation and receipt through the correct location and payment channel. Never duplicate a payment or allocate more than the amount received.", ["Avoid duplicate invoices", "Allocate payments correctly", "Review outstanding balances"]],
      ["12. Return inspection and damage settlement", "Record closing meter, fuel, condition, missing items and damage. Compare return evidence with dispatch evidence, complete assessment and approval, and settle deposits or additional charges before final equipment release.", ["Compare opening and closing evidence", "Document damage clearly", "Complete release controls"]],
      ["13. Maintenance, reports and shared documents", "Use the Maintenance Register for inspections, service history, meters and defects. Use Sales Documents & Reports, Hire Reports, shared controls and notifications for the correct location and period. Automatic rule refresh raises overdue-invoice, overdue-contract, pending-approval, draft-work-log and open-damage alerts. Protect customer, finance and machine records.", ["Review maintenance status", "Confirm report filters", "Protect exported files"]],
      ["14. Workers, employment documents, signatures and security", "Equipment Sales & Hire workers, permissions and private files are category-isolated. Employment documents may use the protected boss signature after review and approval. Use password-only sign-in, least privilege and Activity Log evidence. Wrong commercial or operational entries must use controlled cancellation, adjustment, void or amendment with truthful reasons; do not delete database rows directly. Report unexpected failures before retrying a sensitive action.", ["Use the correct workforce", "Review documents before approval", "Never share passwords or private files"]],
    ],
  },
};

export default function WorkspaceHelpPage({ workspace }) {
  const { role } = useAuth();
  const [search, setSearch] = useState("");
  const content = helpContent[workspace] || helpContent.mining;

  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return content.sections;
    return content.sections.filter(([title, detail, actions]) =>
      [title, detail, ...actions].join(" ").toLowerCase().includes(term)
    );
  }, [content, search]);

  return (
    <section className="workspace-help-page">
      <header>
        <div className="workspace-help-icon" aria-hidden="true">{content.icon}</div>
        <div>
          <p>Independent Business User Guide · Version Three</p>
          <h1>{content.title}</h1>
          <span>Current access: {String(role || "staff").toUpperCase()} · {content.label} only</span>
        </div>
      </header>

      <article className="workspace-help-boundary">
        <strong>{content.label} boundary</strong>
        <p>Users, permissions, workers, locations and records in this guide belong only to {content.label}. The original System Administrator is the only protected account permitted to administer all three categories.</p>
      </article>

      <div className="workspace-help-search">
        <label htmlFor="workspace-help-search">Search this guide</label>
        <div>
          <input id="workspace-help-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Example: ${content.searchExample}`} />
          <button type="button" onClick={() => setSearch("")}>Clear</button>
        </div>
      </div>

      <div className="workspace-help-grid">
        {sections.map(([title, description, actions]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
            <ul>{actions.map((action) => <li key={action}>{action}</li>)}</ul>
          </article>
        ))}
      </div>

      {sections.length === 0 ? <div className="workspace-help-empty">No {content.label} guide section matched that search.</div> : null}

      <footer>
        <Link to={content.home}>← Return to workspace dashboard</Link>
        <span>Use controlled corrections and contact the System Administrator before changing approved records.</span>
      </footer>
    </section>
  );
}
