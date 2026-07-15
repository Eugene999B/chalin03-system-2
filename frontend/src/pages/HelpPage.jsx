import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function HelpPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const filteredSections = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    return guideSections.filter((section) => {
      const matchesCategory =
        activeCategory === "all" || section.category === activeCategory;

      const matchesSearch =
        !searchText ||
        [
          section.badge,
          section.title,
          section.category,
          ...section.items,
          section.warning || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchText);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, search]);

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>Chalin 03 System Manual</p>

            <h1 style={styles.heroTitle}>Help / User Guide</h1>

            <p style={styles.heroSubtitle}>
              Current operating guide for the Chalin 03 Group Operations Platform from
              <strong> {currentStoreCode} — {currentStoreName}</strong>. It includes
              Cash Control and Audit Security V2, protected corrections, grouped
              Activity Logs, Spare Parts, Mining, Equipment Hire and shared Fleet.
            </p>
          </div>

          <div style={styles.heroCard}>
            <span>📘</span>
            <div>
              <strong>{guideSections.length}</strong>
              <small> guide sections</small>
            </div>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            Current selected store: {currentStoreCode} — {currentStoreName}
          </strong>

          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}

          <p>
            Most daily records are separated by selected store. To work in
            another store, logout, choose the correct store on the login page,
            and login again.
          </p>
        </div>
      </div>

      <div style={styles.successPanel}>
        <strong>What this system does</strong>
        <p>
          This system manages sales, stock, debts, purchases, expenses, Daily Closing,
          protected corrections, refunds, audit evidence, Fleet equipment,
          Mining Operations, Equipment Hire, operational documents, SMS alerts
          and group-management records. Never force a shortage or excess to zero.
        </p>
      </div>

      <div style={styles.topGrid}>
        <QuickGuideCard
          icon="🛒"
          title="Cashier Daily Flow"
          items={["Confirm store", "Record payment channels", "Print receipt", "Count drawer"]}
        />

        <QuickGuideCard
          icon="💵"
          title="Cash Control V2"
          items={["Opening float", "Denominations", "Variance notes", "Manager verification"]}
        />

        <QuickGuideCard
          icon="📦"
          title="Stock Control"
          items={["Products", "Adjust stock", "View ledger", "Transfers"]}
        />

        <QuickGuideCard
          icon="🧾"
          title="Group Management"
          items={["Executive control", "Mining", "Hire", "Fleet"]}
        />

        <QuickGuideCard
          icon="🔐"
          title="Safety"
          items={["Own login", "Protected changes", "Activity Log", "Backups"]}
        />
      </div>

      <section style={styles.searchPanel}>
        <div>
          <p style={styles.eyebrowDark}>Find Help Quickly</p>
          <h2 style={styles.panelTitle}>Search the user guide</h2>
          <p style={styles.panelSubtitle}>
            Type a word like closing, cash, denomination, correction, refund, activity, sale, stock, mining, hire, audit or backup.
          </p>
        </div>

        <div style={styles.searchControls}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search guide..."
          />

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSearch("");
              setActiveCategory("all");
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <div style={styles.categoryTabs}>
        {guideCategories.map((category) => (
          <button
            key={category.key}
            type="button"
            style={{
              ...styles.categoryTab,
              ...(activeCategory === category.key ? styles.categoryTabActive : {}),
            }}
            onClick={() => setActiveCategory(category.key)}
          >
            {category.label}
          </button>
        ))}
      </div>

      {filteredSections.length === 0 ? (
        <div style={styles.emptyState}>
          No guide section matched your search. Clear the search and try again.
        </div>
      ) : (
        <div style={styles.guideGrid}>
          {filteredSections.map((section, index) => (
            <GuideCard key={section.title} section={section} index={index} />
          ))}
        </div>
      )}

      <section style={styles.footerPanel}>
        <div>
          <p style={styles.eyebrow}>Management Reminder</p>
          <h2>Cash Control and Audit Security V2 is live</h2>
          <p>
            Record the real figures, preserve the original evidence and review every
            shortage, excess, correction, refund and post-closing change. A closing
            is trustworthy because it was independently counted and verified, not
            because somebody forced the difference to zero.
          </p>
        </div>

        <div style={styles.footerMiniGrid}>
          <div>
            <span>First Check</span>
            <strong>Correct Store</strong>
          </div>

          <div>
            <span>Daily Control</span>
            <strong>Real Count</strong>
          </div>

          <div>
            <span>Security Review</span>
            <strong>Activity Log</strong>
          </div>

          <div>
            <span>Approval Rule</span>
            <strong>Different Manager</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickGuideCard({ icon, title, items }) {
  return (
    <div style={styles.quickCard}>
      <span style={styles.quickIcon}>{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{items.join(" • ")}</p>
      </div>
    </div>
  );
}

function GuideCard({ section, index }) {
  return (
    <article style={styles.guideCard}>
      <div style={styles.guideHeader}>
        <span style={styles.badge}>{section.badge}</span>
        <span style={styles.sectionNumber}>{index + 1}</span>
      </div>

      <h2>{section.title}</h2>

      {section.type === "unordered" ? (
        <ul style={styles.list}>
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <ol style={styles.list}>
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      )}

      {section.warning ? (
        <div style={styles.warningBox}>{section.warning}</div>
      ) : null}
    </article>
  );
}

const guideCategories = [
  {
    "key": "all",
    "label": "All"
  },
  {
    "key": "daily",
    "label": "Daily Work"
  },
  {
    "key": "cash",
    "label": "Cash Control"
  },
  {
    "key": "stock",
    "label": "Stock"
  },
  {
    "key": "sales",
    "label": "Sales & Debts"
  },
  {
    "key": "management",
    "label": "Management"
  },
  {
    "key": "group",
    "label": "Group Operations"
  },
  {
    "key": "safety",
    "label": "Safety"
  }
];

const guideSections = [
  {
    "category": "daily",
    "badge": "Store Control",
    "title": "1. Store Selection",
    "items": [
      "Choose the correct Spare Parts store on the login page before logging in.",
      "Always check the selected store name at the top of the system.",
      "Sales, debts, stock, purchases, expenses, returns, reports and Daily Closing belong to the selected store.",
      "Mining sites and Equipment Hire locations are separate workspaces and do not use Spare Parts stores.",
      "To change a Spare Parts store, logout, select the correct store, and login again.",
      "Do not save a business record until the active store, site or hire location is correct."
    ]
  },
  {
    "category": "daily",
    "badge": "Daily Work",
    "title": "2. Daily Workflow",
    "items": [
      "Login with your own username and password. Do not share an account.",
      "Confirm the active store before recording any Spare Parts work.",
      "Check Dashboard, low stock, debts and unfinished management tasks.",
      "Record sales with the correct payment channel and print or download the receipt.",
      "Record debt payments, purchases, expenses, returns and stock transfers when they happen.",
      "Do not wait until the end of the week to enter expenses or cash movements.",
      "At closing time, independently count Cash and confirm MoMo, Bank and Other.",
      "Enter explanations for every shortage, excess, deposit, withdrawal or unusual movement.",
      "Submit the closing and allow a different manager or administrator to verify it."
    ],
    "warning": "Never change a figure only to make the Daily Closing show Balanced."
  },
  {
    "category": "stock",
    "badge": "Inventory",
    "title": "3. Products",
    "items": [
      "Go to Products and confirm the selected store.",
      "Add product name, category, excavator type, price, cost, quantity and low-stock level.",
      "Search by name, barcode, category or excavator type.",
      "Product quantities and prices are separated by store.",
      "Use the product stock ledger when a quantity is questioned.",
      "Only authorized staff should edit prices, adjust stock, disable or delete products."
    ]
  },
  {
    "category": "stock",
    "badge": "Stock Control",
    "title": "4. Stock Adjustment",
    "items": [
      "Open Products and choose Adjust Stock on the correct product.",
      "Choose Increase Stock, Decrease Stock or Set Exact Stock.",
      "Enter the quantity and a clear business reason.",
      "Use this for damaged items, losses, physical-count corrections or wrong entries.",
      "The system records old stock, new stock, reason, date, user and store.",
      "Review frequent adjustments because they may indicate training problems, recording mistakes or stock loss."
    ],
    "warning": "Do not use stock adjustment to imitate a sale, purchase, return or transfer."
  },
  {
    "category": "stock",
    "badge": "Stock Audit",
    "title": "5. Product Stock Movement Ledger",
    "items": [
      "Open Products, find the item and click View Ledger.",
      "Review opening stock, purchases, sales, returns, adjustments and transfers.",
      "Follow the running balance to explain the current quantity.",
      "Use the ledger before deciding that stock was stolen or the system is wrong.",
      "Download the full Stock Movement Ledger from Exports for management review."
    ]
  },
  {
    "category": "stock",
    "badge": "Two Stores",
    "title": "6. Stock Transfers Between Stores",
    "items": [
      "Open Stock Transfers and choose the source and destination stores.",
      "Add the products and requested quantities.",
      "Create the request, obtain approval, dispatch from the source and receive at the destination.",
      "Approval alone does not move stock.",
      "Dispatch reduces the source store; Receive increases the destination store.",
      "Download and sign the Transfer Note when physical goods move."
    ],
    "warning": "Never reduce one store and manually increase another to imitate a transfer."
  },
  {
    "category": "sales",
    "badge": "Sales",
    "title": "7. New Sale and Payment Channels",
    "items": [
      "Open New Sale and confirm the selected store.",
      "Select the correct product, quantity, customer and discount.",
      "Choose Cash, MoMo, Bank, Credit or Mixed.",
      "For a Mixed or part-paid Credit sale, allocate the received amount to the exact channels.",
      "The payment allocations must equal the amount received.",
      "Only the Cash allocation enters expected physical cash; MoMo and Bank are confirmed separately.",
      "Save the sale, check the receipt and give it to the customer."
    ],
    "warning": "Do not put MoMo, Bank or an unknown part-payment into Cash merely to complete the sale."
  },
  {
    "category": "sales",
    "badge": "Protected Change",
    "title": "8. Completed-Sale Corrections",
    "items": [
      "Do not casually edit a completed sale from Sales History.",
      "Open the controlled correction action and enter a clear reason.",
      "A different active manager or administrator must authorize the change with their own credentials.",
      "The system preserves the original and corrected sale evidence.",
      "Product, quantity, price, discount, customer, amount paid, payment allocation, debt and stock effects are retained.",
      "A change affecting a closed date marks that Daily Closing for reconciliation.",
      "Do not use a shared manager account because it destroys accountability."
    ],
    "warning": "Never delete or hide the original transaction to make the records look clean."
  },
  {
    "category": "sales",
    "badge": "Customers",
    "title": "9. Debts and Debt Payments",
    "items": [
      "Credit and Mixed sales create debt when a balance remains.",
      "Open Debts to review unpaid customers for the selected store.",
      "Record each later payment with the correct Cash, MoMo, Bank or Other channel.",
      "The debt balance reduces and payment history remains available.",
      "Debt collections affect the matching Daily Closing payment channel.",
      "Review old debts and repeated part-payments with management."
    ]
  },
  {
    "category": "stock",
    "badge": "Purchasing",
    "title": "10. Purchases and Suppliers",
    "items": [
      "Use Purchases when stock is received from a supplier.",
      "Confirm the selected store before saving.",
      "Purchase items increase stock in that store.",
      "Record supplier balances and later purchase payments.",
      "Use purchase history to explain stock increases and cost changes.",
      "Do not manually increase products when a purchase record should be created."
    ]
  },
  {
    "category": "management",
    "badge": "Business Costs",
    "title": "11. Expenses",
    "items": [
      "Record shop expenses when they happen, not later from memory.",
      "Choose the correct store, category, date and payment method.",
      "Cash expenses reduce expected physical cash; MoMo and Bank expenses reduce their own channels.",
      "Add notes or references for unusual expenses.",
      "An expense entered after closing may mark the closing for management review.",
      "Managers should review repeated, late or unusually large expenses."
    ]
  },
  {
    "category": "management",
    "badge": "Returns",
    "title": "12. Returns and Financial Refunds",
    "items": [
      "Use a Stock-Only Return when goods return to stock but no money is refunded.",
      "Use a Financial Refund only when money is actually returned to the customer.",
      "Enter the exact refund amount and Cash, MoMo, Bank or Other refund channel.",
      "Add a reference for electronic refunds and a clear reason.",
      "A different manager or administrator must approve a financial refund.",
      "Approved refunds reduce the matching Daily Closing channel.",
      "A refund after closing marks the affected closing for reconciliation."
    ],
    "warning": "Returning stock and refunding money are different actions. Select the correct return type."
  },
  {
    "category": "cash",
    "badge": "Preparation",
    "title": "13. Daily Closing Preparation",
    "items": [
      "Finish recording all sales, debt payments, expenses, returns and cash movements for the store.",
      "Confirm that no customer payment or expense is still waiting to be entered.",
      "Separate physical Cash from MoMo, Bank and Other.",
      "Use the actual business date and active store.",
      "After a date is closed, do not create additional transactions for that date without management review."
    ]
  },
  {
    "category": "cash",
    "badge": "Cash Drawer",
    "title": "14. Opening Float and Cash Movements",
    "items": [
      "Opening cash float is the physical cash already in the drawer before sales begin.",
      "Cash deposits are amounts removed from the drawer and deposited elsewhere.",
      "Cash withdrawals are approved amounts taken from the drawer.",
      "Other cash-in and other cash-out cover approved movements not represented by sales, debt collections, expenses or refunds.",
      "Enter notes whenever a deposit, withdrawal, other cash-in or other cash-out is used.",
      "Do not record MoMo or Bank balances as opening physical cash."
    ]
  },
  {
    "category": "cash",
    "badge": "Physical Count",
    "title": "15. Denomination Counting",
    "items": [
      "Count GHS 200, 100, 50, 20, 10, 5, 2 and 1 notes separately.",
      "Enter the quantity of each note.",
      "Enter the total value of coins.",
      "The denomination total must equal Cash Counted.",
      "Recount when the denomination total and Cash Counted do not agree.",
      "Do not enter the system-expected cash as the count unless the physical notes and coins truly equal it."
    ]
  },
  {
    "category": "cash",
    "badge": "Reconciliation",
    "title": "16. Expected Versus Counted",
    "items": [
      "Expected Cash is calculated from opening float, cash receipts and approved cash outflows.",
      "Expected MoMo, Bank and Other are calculated separately.",
      "Counted Cash is the physical denomination count.",
      "Confirmed MoMo and Bank should be checked against the actual account or transaction history.",
      "A negative difference is a shortage; a positive difference is an excess.",
      "Enter a clear explanation whenever any channel differs.",
      "Submit the real difference. Do not adjust the count to manufacture a zero variance."
    ]
  },
  {
    "category": "cash",
    "badge": "Independent Check",
    "title": "17. Manager Verification",
    "items": [
      "The cashier or submitter completes and submits the Daily Closing.",
      "A different active manager or administrator reviews the records and recounts or verifies the balances.",
      "The verifier uses their own password.",
      "The person who submitted the closing cannot verify the same closing.",
      "A closing changed after submission cannot be verified until its revision is reviewed.",
      "Verification confirms review; it does not erase a genuine shortage or excess."
    ]
  },
  {
    "category": "cash",
    "badge": "Evidence History",
    "title": "18. Revisions and Changed-After-Closing Review",
    "items": [
      "Revision 1 preserves the original submitted or historical closing.",
      "A later approved sale change, void, refund, expense or debt-payment change may mark the closing Changed After Closing.",
      "The original closing is not silently overwritten.",
      "A different manager or administrator enters revision notes and reconciles the changed expected figures.",
      "The revision history shows what changed, why it changed, who reviewed it and when.",
      "Historical closings created before Cash Control V2 remain legacy records and must not be described as independently verified."
    ]
  },
  {
    "category": "management",
    "badge": "Reports",
    "title": "19. Reports, Exports and Clean-Hands Closing Reports",
    "items": [
      "Use Reports and Exports with the correct store and date range.",
      "Products, Low Stock, Stock Adjustments, Transfers, Stock Movement, Sales, Debts, Debt Payments, Expenses, Purchases, Returns and Daily Closings are available.",
      "Use Excel for analysis, PDF for fixed presentation and Word for editable management notes.",
      "Daily Closing reports include payment channels, cash movements, denominations, exceptions, verification and revision evidence.",
      "Review the report before presenting it to the boss or accountant.",
      "A report showing a difference is evidence for investigation, not a reason to alter the figures."
    ]
  },
  {
    "category": "management",
    "badge": "Security Timeline",
    "title": "20. Activity Log Categories and Downloads",
    "items": [
      "Open Activity Log to review who performed important actions and when.",
      "Filter by date, store, user, action and category.",
      "Categories include Logins, Sales, Products and Stock, Daily Closing, Debts, Expenses and Purchases, Returns, Users and Access, Audit and Security, Backups and Exports, Mining, Equipment Hire and Other.",
      "Download the selected category as Excel, PDF, Word or CSV.",
      "Use the Login category when reviewing account access.",
      "Use Sales and Daily Closing categories when investigating shortages, corrections or post-closing changes.",
      "Preserve downloaded logs during an investigation; do not edit the exported evidence."
    ]
  },
  {
    "category": "management",
    "badge": "Accounting",
    "title": "21. Advanced Accounting Intelligence",
    "items": [
      "Review sales, cost, profit, expenses, debt movement, returns and stock together.",
      "Investigate unusual discounts, voids, refunds, adjustments and closing variances.",
      "Compare stores only when the user has authorized all-store access.",
      "Use the signals as management warnings, not automatic accusations.",
      "Confirm findings with source records, receipts, Activity Logs and staff explanations."
    ]
  },
  {
    "category": "management",
    "badge": "SMS",
    "title": "22. SMS Center",
    "items": [
      "Use SMS Center for approved customer messages, receipts, reminders and alerts.",
      "Confirm recipient numbers before sending.",
      "Check the SMS log for successful and failed messages.",
      "Retry only after correcting the cause of failure.",
      "Only authorized users should send bulk SMS.",
      "SMS failures must never cancel a valid sale."
    ]
  },
  {
    "category": "management",
    "badge": "Audit",
    "title": "23. Audit Controls",
    "items": [
      "Audit Sign-Off locks approved accounting periods.",
      "Locked periods block unauthorized changes.",
      "Use an unlock request when a legitimate correction is required.",
      "Management reviews the request, correction evidence and reapproval history.",
      "Daily Closing revisions and protected-sale evidence support the audit trail.",
      "Approve a period only after reviewing cash, stock, debts, expenses, returns and exceptions."
    ]
  },
  {
    "category": "safety",
    "badge": "System Safety",
    "title": "24. Backup, Restore and Maintenance",
    "items": [
      "Website backup and restore are full-system actions.",
      "Download a fresh backup before migrations, major deployments or investigations.",
      "Do not run database/schema.sql on production because it is a fresh-install/reset schema.",
      "Use reviewed additive migration files for live database upgrades.",
      "Do not rerun an already successful migration unless the verification procedure specifically requires it.",
      "Maintenance clear-data actions are for authorized emergency or test use only.",
      "Never clear real business data merely to fix a display or login problem."
    ],
    "warning": "Git rollback restores code; it does not automatically reverse database changes."
  },
  {
    "category": "safety",
    "badge": "Permissions",
    "title": "25. User Roles and Separation of Duties",
    "type": "unordered",
    "items": [
      "Cashier: Daily sales, receipts and allowed customer/debt actions for Spare Parts.",
      "Manager: Operational review, corrections, refunds, Daily Closing verification, reports and approved management actions.",
      "Admin: Users, settings, permissions, backups, Activity Logs and sensitive administration.",
      "Auditor: Read-only or controlled audit, accounting, document and executive-review work.",
      "System Administrator: Emergency system maintenance and technical administration.",
      "Mining and Equipment Hire staff receive workspace-specific roles and assigned sites or locations.",
      "The creator or submitter should not approve or verify their own sensitive transaction."
    ]
  },
  {
    "category": "daily",
    "badge": "PWA",
    "title": "26. Install the App",
    "items": [
      "Click Install App in the sidebar when the browser offers it.",
      "On iPhone, use Share then Add to Home Screen.",
      "Always use https://chalin03.com or https://www.chalin03.com.",
      "After a deployment, use Incognito or hard refresh when an old cached interface remains.",
      "Do not install from an unofficial link."
    ]
  },
  {
    "category": "safety",
    "badge": "Security",
    "title": "27. Important Safety Rules",
    "type": "unordered",
    "items": [
      "Use your own account and keep the password private.",
      "Confirm the active business workspace and location before saving.",
      "Never force a closing to balance.",
      "Never erase original sale, return, refund or closing evidence.",
      "Use protected correction and approval workflows.",
      "Enter clear reasons for adjustments, corrections, refunds and cash movements.",
      "Review Activity Logs when records are questioned.",
      "Back up before migrations and major releases.",
      "Do not expose Railway passwords, JWT secrets, SMS keys or customer data.",
      "Report unexplained shortages to management without automatically accusing a person."
    ]
  },
  {
    "category": "group",
    "badge": "Executive",
    "title": "28. Group Executive Control",
    "items": [
      "Review Spare Parts, Mining, Equipment Hire and Fleet from the Group Executive workspace.",
      "Choose the reporting period and authorized business scope.",
      "Review revenue, costs, debts, production, utilization, incidents and critical alerts.",
      "Download the executive workbook for the boss, accountant or auditor.",
      "Use recommendations as review prompts and confirm them against source records."
    ]
  },
  {
    "category": "group",
    "badge": "Shared Fleet",
    "title": "29. Fleet and Equipment",
    "items": [
      "Register each excavator or machine once in the shared Fleet register.",
      "Record meter readings, location, operator, fuel, inspections and maintenance.",
      "A machine assigned to Mining, Hire, maintenance or breakdown must not be double-booked.",
      "Review service-due, breakdown and document-expiry alerts.",
      "Archive retired assets rather than deleting operational history."
    ]
  },
  {
    "category": "group",
    "badge": "Mining",
    "title": "30. Mining Operations",
    "items": [
      "Administrators create Mining sites; they are separate from Spare Parts stores.",
      "Record daily logs, production, equipment shifts, fuel, expenses and incidents under the active site.",
      "Approve operational records using the assigned Mining roles.",
      "Equipment meter records update the shared Fleet context.",
      "Review fuel, downtime, unapproved logs and safety incidents before closing a period.",
      "Use Mining Documents for daily reports and management packs."
    ]
  },
  {
    "category": "group",
    "badge": "Equipment Hire",
    "title": "31. Equipment Hire Operations",
    "items": [
      "Administrators create Hire bases or locations; they are separate from Spare Parts stores.",
      "Register customers and enquiries, then prepare and approve quotations.",
      "Confirm Fleet availability before contract, assignment and dispatch.",
      "Record opening meter, job cards, billable hours, invoices, deposits and payments.",
      "Complete the return inspection before the machine becomes available again.",
      "Use the correct Hire role for dispatch, accounting and closure actions."
    ]
  },
  {
    "category": "group",
    "badge": "Documents",
    "title": "32. Operations Documents",
    "items": [
      "Download Hire quotations, agreements, dispatch notes, job cards, invoices, receipts and statements.",
      "Download Mining daily reports, site management packs and incident reports.",
      "Use the correct date, customer, site or location filters.",
      "Auditors may review and download authorized documents without entering ordinary sales work.",
      "Protected direct links require an active login."
    ]
  }
];

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "42px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 48%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.26)",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.34)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "860px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  heroCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    minWidth: "180px",
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.15)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  successPanel: {
    marginBottom: "18px",
    padding: "16px",
    borderRadius: "20px",
    background: "linear-gradient(135deg, #ecfdf3, #ffffff)",
    border: "1px solid #bbf7d0",
    color: "#14532d",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
    fontWeight: "800",
  },

  topGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  quickCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
  },

  quickIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    background: "#fef3c7",
    color: "#92400e",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    flexShrink: 0,
  },

  searchPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.75fr)",
    gap: "16px",
    alignItems: "end",
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    marginBottom: "14px",
  },

  searchControls: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  categoryTabs: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },

  categoryTab: {
    border: "1px solid #dbe3ef",
    borderRadius: "999px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "9px 13px",
    fontWeight: "900",
    cursor: "pointer",
  },

  categoryTabActive: {
    background: "#07182c",
    color: "#e0ba28",
    borderColor: "#07182c",
  },

  guideGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "18px",
  },

  guideCard: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    minWidth: 0,
  },

  guideHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    marginBottom: "10px",
  },

  badge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: "12px",
    fontWeight: "950",
  },

  sectionNumber: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "#07182c",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    fontWeight: "950",
    flexShrink: 0,
  },

  list: {
    lineHeight: "1.85",
    paddingLeft: "20px",
    marginBottom: 0,
    color: "#334155",
    fontWeight: "650",
  },

  warningBox: {
    marginTop: "14px",
    padding: "12px",
    borderRadius: "14px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    fontWeight: "800",
  },

  emptyState: {
    padding: "20px",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
  },

  footerPanel: {
    marginTop: "20px",
    borderRadius: "24px",
    padding: "22px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(7, 24, 44, 0.25)",
  },

  footerMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },
};
