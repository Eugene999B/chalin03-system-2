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
    searchExample: "site, shift, production, fuel, incident, closing",
    sections: [
      ["1. Mining login and site context", "Use a Mining worker account and select an authorized Mining site. Spare Parts stores and Hire locations do not apply. Direct links to another category are blocked.", ["Confirm active site", "Use your own login", "Request site access from Mining administration"]],
      ["2. Sites and administration", "Only authorized Mining administrators create sites, update targets and assign staff/site access. Site codes, locations, material, units and status must reflect the real operation.", ["Do not reuse store codes", "Deactivate rather than erase history", "Review access assignments"]],
      ["3. Daily site and shift logs", "Create the daily/shift log first, record supervisor, crew, weather, opening conditions and closing notes, then approve only after checking the supporting production and equipment records.", ["One site and shift", "Record real times", "Approve independently"]],
      ["4. Production, stockpiles and dispatch", "Record measured production against the correct site, date, shift, material and unit. Track stockpile movements and dispatch evidence so opening, produced, moved and closing quantities reconcile.", ["Use measured quantities", "Reference source records", "Investigate reconciliation differences"]],
      ["5. Equipment operations", "Assign Mining equipment and operators, record opening/closing meters, working, idle and breakdown hours. Fleet records opened here are limited to Mining context.", ["Check asset availability", "Record meter evidence", "Open maintenance when required"]],
      ["6. Fuel control", "Record tank receipts, issues, transfers and reconciliations. Every machine issue needs the site, asset, quantity, meter/shift context and responsible user.", ["Measure tank balances", "Avoid duplicate issues", "Review variance before closing"]],
      ["7. Expenses and contractors", "Record genuine site costs, contractor details, references and approvals. Mining expenses never post through a Spare Parts store or Equipment Hire customer account.", ["Use correct category", "Attach reference", "Separate preparation and approval"]],
      ["8. Incidents and corrective action", "Record safety, environmental, security and equipment incidents promptly. Assign corrective action, evidence and responsible persons; close only after verification.", ["Preserve original report", "Record severity honestly", "Verify closure"]],
      ["9. Site closing, reports and documents", "Complete site closing after production, fuel, stockpile, dispatch, expenses and incidents are reviewed. Use Mining reports and documents for the selected site and period.", ["Reconcile before approval", "Confirm report filters", "Protect operational documents"]],
      ["10. Mining workers, permissions and support", "Mining permissions and worker profiles are independent. The permission manager displays Mining permissions only, and the workforce page lists only Mining workers. Use Activity Log and the Mining guide during review.", ["One category per worker", "Use least privilege", "Escalate assignment conflicts"]],
    ],
  },
  equipment_hire: {
    icon: "🏗️",
    title: "Equipment Hire User Guide",
    label: "Equipment Hire",
    home: "/equipment-hire-operations",
    searchExample: "customer, enquiry, quotation, dispatch, invoice, return",
    sections: [
      ["1. Hire login and location context", "Use an Equipment Hire worker account and choose an authorized Hire base, yard, office or depot. Mining sites and Spare Parts stores are separate and cannot be used here.", ["Confirm active Hire location", "Use your own login", "Direct cross-category links are blocked"]],
      ["2. Hire locations and administration", "Authorized Hire administrators create locations and assign staff access. Maintain accurate location codes, addresses, contacts and active status.", ["Do not reuse store/site records", "Review location access", "Preserve inactive history"]],
      ["3. Customers and enquiries", "Create the customer and contact information, then record requested machine, job site, dates, charging basis, operator/fuel responsibility and special requirements.", ["Search before creating customer", "Confirm customer site", "Record request evidence"]],
      ["4. Availability and rate cards", "Check machine status, maintenance and existing assignments before quoting. Use approved rate cards, minimum charges, overtime, mobilization, demobilization and deposit rules.", ["Do not double-book", "Use current approved rate", "Explain exceptions"]],
      ["5. Quotations and approvals", "Prepare itemized commercial terms and validity dates. Required approvals must be completed before conversion to a contract; rejected or expired quotations remain as evidence.", ["Review all charges", "Use controlled approval", "Preserve revisions"]],
      ["6. Contracts and amendments", "Create contracts only from approved terms. Record assigned assets, dates, customer obligations, deposit and amendments. Sensitive commercial changes require reason and approval.", ["Confirm asset and dates", "Record deposit terms", "Use amendment history"]],
      ["7. Dispatch, job cards and work logs", "Dispatch records opening meter, condition, operator and evidence. Work logs capture approved billable time, idle time, fuel responsibility and customer acknowledgement.", ["Photograph condition", "Record meters accurately", "Approve billable work"]],
      ["8. Invoices, deposits and payments", "Invoice approved work and commercial charges. Record every deposit, payment, allocation and receipt through the correct Hire location and payment channel.", ["Avoid duplicate invoices", "Allocate payments correctly", "Review outstanding balance"]],
      ["9. Return inspection and damage settlement", "Record closing meter, fuel, condition, missing items and damage. Complete assessment/approval before releasing the asset or settling deposits and additional charges.", ["Compare dispatch evidence", "Document damage", "Complete equipment release"]],
      ["10. Hire workers, permissions, reports and support", "Hire permissions and worker profiles are independent. The permission manager and workforce page show only Equipment Hire records. Use Hire reports, documents, notifications and Activity Log for review.", ["One category per worker", "Confirm report location", "Escalate category conflicts"]],
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
          <p>Independent Business User Guide</p>
          <h1>{content.title}</h1>
          <span>Current access: {String(role || "staff").toUpperCase()} · {content.label} only</span>
        </div>
      </header>

      <article className="workspace-help-boundary">
        <strong>{content.label} boundary</strong>
        <p>Users, permissions, workers, locations and records in this guide belong only to {content.label}. The original System Administrator is the only account permitted to work across all three categories.</p>
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
