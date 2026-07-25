import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import "../styles/workspaceHelp.css";

const SPARE_PARTS_GUIDE = [
  {
    title: "1. Sign in to the correct Spare Parts store",
    detail:
      "Choose Spare Parts on the login page, select the correct authorized store and use your own username or registered phone number. Store context controls stock, sales, receipts, debts, expenses, closing and reports. Mining sites and Equipment Sales & Hire locations are separate business records.",
    actions: ["Confirm store code and name", "Never share a login", "Sign out before changing store"],
  },
  {
    title: "2. Products, suppliers and stock control",
    detail:
      "Search before creating a product, maintain accurate cost and selling prices, set a realistic low-stock level and keep supplier details current. Use purchases, returns, transfers and stock adjustments for their intended purposes; never edit quantity merely to hide an unexplained difference.",
    actions: ["Search before creating", "Count before adjusting", "Review stock history and reasons"],
  },
  {
    title: "3. New Sale, customers and payment channels",
    detail:
      "Select the correct products and quantities, identify the customer when required, and record exactly how money was received. Cash, MoMo, Bank, Other, Credit and Mixed transactions must reflect the real transaction and their channel allocations must reconcile to the total.",
    actions: ["Check customer details", "Review quantity and price", "Record exact payment allocations"],
  },
  {
    title: "4. Receipts and store identity",
    detail:
      "Review the completed transaction before printing or sharing its receipt. The selected store's configured business identity and Business Phone / Receipt MoMo Number appear on its documents. Do not use another store's receipt, phone number or prefix.",
    actions: ["Confirm receipt number", "Check store identity", "Preserve the final receipt evidence"],
  },
  {
    title: "5. Credit sales, debts and customer statements",
    detail:
      "Attach every credit balance to the correct customer and record later collections through the Debt module using the real payment channel. Use Customer Statement for the full history. Do not rewrite an old sale or delete payment evidence to make a balance appear correct.",
    actions: ["Select the correct customer", "Issue debt-payment evidence", "Review overdue balances"],
  },
  {
    title: "6. Spare Parts installment retirement",
    detail:
      "New Spare Parts installment sales are retired. Historical Spare Parts installment records remain preserved for authorized review, but staff must not create new agreements through old links or workarounds. Current equipment installment sales belong only to Equipment Sales & Hire.",
    actions: ["Do not create new Spare Parts installments", "Preserve historical records", "Use Equipment Sales & Hire for equipment finance"],
  },
  {
    title: "7. Purchases and supplier payments",
    detail:
      "Record supplier purchases with invoice or reference details, item quantities and cost prices. Confirm goods received before approval. Record deposits and later supplier payments separately so stock, supplier balance and accounting evidence remain aligned.",
    actions: ["Use supplier invoice reference", "Confirm quantities received", "Record each supplier payment"],
  },
  {
    title: "8. Expenses, returns, refunds and corrections",
    detail:
      "Record genuine store expenses with the correct funding source, date, category, amount and evidence. Process customer returns through Returns. Voids, refunds and post-closing corrections require the correct permission, password confirmation, truthful reason and independent approval where configured.",
    actions: ["Do not overwrite history", "Record funding source and reason", "Review approval and Activity Log evidence"],
  },
  {
    title: "9. Stock transfers and low-stock control",
    detail:
      "Use the controlled Request → Approve → Dispatch → Receive process for movement between the two Spare Parts stores. Approval alone does not move stock. Use Low Stock and restock exports to plan purchasing, and verify the destination receipt before considering a transfer complete.",
    actions: ["Confirm source and destination", "Dispatch and receive separately", "Investigate transfer differences"],
  },
  {
    title: "10. Daily Closing and cash control",
    detail:
      "At the end of the day, enter the actual counted Cash, MoMo, Bank and Other amounts. Investigate shortages or excesses; never force a variance to zero. Expenses funded from today's receipts and approved refunds reduce the matching channel, while externally funded expenses remain accounting expenses without reducing the drawer.",
    actions: ["Count independently", "Explain every variance", "Use independent manager verification"],
  },
  {
    title: "11. Reports, exports and accounting intelligence",
    detail:
      "Use Sales History, reports, customer statements, audit accounting and accounting intelligence to review revenue, profit, stock, debts, purchases, expenses, refunds and closing variances for the selected store and period. Confirm filters before exporting and protect customer information.",
    actions: ["Confirm store and dates", "Review figures before exporting", "Keep exported files private"],
  },
  {
    title: "12. Users, permissions, workers and documents",
    detail:
      "Spare Parts users, permissions, worker profiles and employment documents are category-isolated. Administrators should grant the least permission needed. Approved employment and business documents may use the protected boss signature configured in Document Signature Settings; changing the saved signature does not rewrite historical approved snapshots.",
    actions: ["Assign the correct category", "Use least privilege", "Review documents before approval"],
  },
  {
    title: "13. Security, notifications, backups and support",
    detail:
      "Use password-only sign-in, keep account recovery details secure, review notifications and the Activity Log, and download regular signed Full System Backups. Browser restore is blocked in production. Report unexpected errors before repeating a sensitive action, and never share passwords, OTPs, secrets or backup files.",
    actions: ["Keep recovery details current", "Download and protect signed backups", "Escalate unusual errors promptly"],
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
          <p>Independent Business User Guide · Version Three</p>
          <h1>Spare Parts User Guide</h1>
          <span>
            {storeCode} — {storeName}{storeLocation ? ` · ${storeLocation}` : ""}
          </span>
        </div>
      </header>

      <article className="workspace-help-boundary">
        <strong>Spare Parts boundary</strong>
        <p>
          This guide, its users, permissions, workers, stores, receipts and records belong only to Spare Parts. Mining Operations and Equipment Sales & Hire use independent sites, locations, guides and records.
        </p>
      </article>

      <div className="workspace-help-search">
        <label htmlFor="spare-parts-help-search">Search this guide</label>
        <div>
          <input
            id="spare-parts-help-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Example: credit, closing, receipt, transfer, worker, backup"
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
        <Link to="/">← Return to Spare Parts dashboard</Link>
        <span>Use controlled corrections and contact the System Administrator before changing approved records.</span>
      </footer>
    </section>
  );
}
