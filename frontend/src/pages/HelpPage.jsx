import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/workspaceHelp.css";

const SPARE_PARTS_GUIDE = [
  {
    title: "1. Sign in to the correct Spare Parts store",
    detail:
      "Choose Spare Parts on the login page, select the correct store and use your own username or registered phone number. Mining and Equipment Hire accounts cannot enter this workspace. Store selection controls stock, sales, receipts, debts, closing and reports.",
    actions: ["Confirm store code and name", "Never share a login", "Logout before changing store"],
  },
  {
    title: "2. Products, stock and suppliers",
    detail:
      "Create each part once, record cost and selling price, set its low-stock level and keep supplier information current. Use Stock Adjustment only for a real counted correction and record a clear reason. Use Stock Transfer for movement between the two Spare Parts stores.",
    actions: ["Search before creating", "Count before adjusting", "Review the stock ledger"],
  },
  {
    title: "3. Ordinary sales and receipts",
    detail:
      "On New Sale, select products, confirm quantity, customer and payment channel, then review totals before completing the sale. Cash, MoMo, bank and mixed allocations must match what was actually received. The selected store’s Business Phone is printed as its receipt MoMo number.",
    actions: ["Check customer details", "Record exact payment channels", "Print or send the final receipt"],
  },
  {
    title: "4. Professional installment sales",
    detail:
      "Choose Installment Sale, identify the customer, enter the deposit, cadence, due dates, grace terms, guarantor/reference and delivery policy. Review the generated schedule before activation. Record every payment against the agreement and issue its installment receipt.",
    actions: ["Verify Ghana phone", "Review schedule and delivery", "Use controlled rescheduling"],
  },
  {
    title: "5. Credit, debts and customer statements",
    detail:
      "Credit balances must be attached to the correct customer. Record debt payments through the Debt module and preserve each payment channel. Use Customer Statement for a complete customer history rather than changing an old sale to hide a balance.",
    actions: ["Select the correct customer", "Issue payment evidence", "Review overdue balances"],
  },
  {
    title: "6. Purchases and supplier payments",
    detail:
      "Record supplier purchases with invoice/reference details, item quantities and cost prices. Record deposit and later supplier payments separately. Confirm received stock before approving the purchase so inventory and accounting remain aligned.",
    actions: ["Use supplier invoice reference", "Confirm quantities received", "Record each supplier payment"],
  },
  {
    title: "7. Expenses, returns and protected corrections",
    detail:
      "Record genuine store expenses with the correct date, category, amount and evidence. Process customer returns through Returns. Voids, refunds, corrections and post-closing changes require the appropriate permission, password confirmation and a truthful reason.",
    actions: ["Do not overwrite history", "Attach a clear reason", "Review Activity Log evidence"],
  },
  {
    title: "8. Daily Closing and cash control",
    detail:
      "At the end of the day, enter the actual counted Cash, MoMo, Bank and Other amounts. Optional denomination counting can support the cash figure. Investigate shortages or excesses; never force a variance to zero. Management verification must be independent.",
    actions: ["Count independently", "Explain every variance", "Complete manager verification"],
  },
  {
    title: "9. Reports, exports and accounting intelligence",
    detail:
      "Use Sales History, reports and accounting intelligence to review revenue, profit, stock, debts, purchases, expenses and closing variances for the selected store and date range. Export only the period and store requested by management.",
    actions: ["Confirm filters", "Review before exporting", "Protect customer information"],
  },
  {
    title: "10. Store settings and receipt identity",
    detail:
      "Administrators maintain each store’s business name, address, Business Phone / Receipt MoMo Number, receipt prefix and footer. Owner Security Alert Phone is separate and is not printed as the receipt MoMo number.",
    actions: ["Edit the selected store only", "Test one receipt", "Keep alert phone private"],
  },
  {
    title: "11. Users, category permissions and worker profiles",
    detail:
      "Spare Parts users, permissions and worker profiles are independent from Mining and Equipment Hire. User Permission Manager displays only Spare Parts permissions when this category is selected. Worker profiles and documents opened here belong only to Spare Parts.",
    actions: ["Assign one category", "Use least privilege", "Resolve conflicts as System Administrator"],
  },
  {
    title: "12. Security, backups and support",
    detail:
      "Review Security Centre and Activity Log, keep account recovery details current and download regular Full System Backups. Security messages may be dismissed from the Security Centre, but the protected audit evidence remains. Report unexpected errors before repeating a sensitive action.",
    actions: ["Keep one admin recovery path", "Download and verify backups", "Never share passwords"],
  },
];

export default function HelpPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
  const [search, setSearch] = useState("");

  const storeCode = branchCode || user?.branch_code || "STORE";
  const storeName = branchName || user?.branch_name || "Selected Store";
  const storeLocation = branchLocation || user?.branch_location || "";

  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return SPARE_PARTS_GUIDE;
    return SPARE_PARTS_GUIDE.filter((section) =>
      [section.title, section.detail, ...section.actions]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [search]);

  return (
    <section className="workspace-help-page">
      <header>
        <div className="workspace-help-icon" aria-hidden="true">🔩</div>
        <div>
          <p>Independent Business User Guide</p>
          <h1>Spare Parts User Guide</h1>
          <span>
            {storeCode} — {storeName}{storeLocation ? ` · ${storeLocation}` : ""}
          </span>
        </div>
      </header>

      <article className="workspace-help-boundary">
        <strong>Spare Parts boundary</strong>
        <p>
          This guide, its users, permissions, workers, stores, receipts and records belong only to Spare Parts. Mining Operations and Equipment Hire use their own independent guides and logins.
        </p>
      </article>

      <div className="workspace-help-search">
        <label htmlFor="spare-parts-help-search">Search this guide</label>
        <div>
          <input
            id="spare-parts-help-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Example: installment, closing, receipt, stock, backup"
          />
          <button type="button" onClick={() => setSearch("")}>Clear</button>
        </div>
      </div>

      <div className="workspace-help-grid">
        {sections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.detail}</p>
            <ul>
              {section.actions.map((action) => <li key={action}>{action}</li>)}
            </ul>
          </article>
        ))}
      </div>

      {sections.length === 0 ? (
        <div className="workspace-help-empty">No Spare Parts guide section matched that search.</div>
      ) : null}

      <footer>
        <Link to="/dashboard">← Return to Spare Parts dashboard</Link>
        <span>Use controlled corrections and contact the System Administrator before changing approved records.</span>
      </footer>
    </section>
  );
}
