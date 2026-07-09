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
              Simple daily guide for using the Chalin 03 Sales & Inventory
              System in <strong>{currentStoreCode} — {currentStoreName}</strong>.
              Use this page to train staff, support managers and remind users how
              each part of the system works.
            </p>
          </div>

          <div style={styles.heroCard}>
            <span>📘</span>
            <div>
              <strong>{guideSections.length}</strong>
              <small>guide sections</small>
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
          This system helps Chalin 03 manage sales, stock, debts, purchases,
          expenses, reports, receipts, audit controls, daily closing, stock
          transfers, stock adjustments, stock movement ledger, SMS alerts and
          multi-store records.
        </p>
      </div>

      <div style={styles.topGrid}>
        <QuickGuideCard
          icon="🛒"
          title="Cashier Daily Flow"
          items={["Login", "Confirm store", "Record sale", "Print receipt"]}
        />

        <QuickGuideCard
          icon="📦"
          title="Stock Control"
          items={["Products", "Adjust stock", "View ledger", "Transfers"]}
        />

        <QuickGuideCard
          icon="🧾"
          title="Management Work"
          items={["Reports", "Daily closing", "Audit", "Exports"]}
        />

        <QuickGuideCard
          icon="🔐"
          title="Safety"
          items={["Passwords", "Backups", "Permissions", "Maintenance"]}
        />
      </div>

      <section style={styles.searchPanel}>
        <div>
          <p style={styles.eyebrowDark}>Find Help Quickly</p>
          <h2 style={styles.panelTitle}>Search the user guide</h2>
          <p style={styles.panelSubtitle}>
            Type a word like sale, stock, debt, audit, transfer, backup or SMS.
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
          <p style={styles.eyebrow}>Boss Reminder</p>
          <h2>Before real business starts</h2>
          <p>
            Confirm products, users, branches, backup, SMS, audit controls,
            receipt settings and maintenance cleanup before the boss starts using
            the system with real data.
          </p>
        </div>

        <div style={styles.footerMiniGrid}>
          <div>
            <span>Most Important</span>
            <strong>Correct Store</strong>
          </div>

          <div>
            <span>Daily Control</span>
            <strong>Daily Closing</strong>
          </div>

          <div>
            <span>Stock Audit</span>
            <strong>Movement Ledger</strong>
          </div>

          <div>
            <span>Safety</span>
            <strong>Backup First</strong>
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
  { key: "all", label: "All" },
  { key: "daily", label: "Daily Work" },
  { key: "stock", label: "Stock" },
  { key: "sales", label: "Sales & Debts" },
  { key: "management", label: "Management" },
  { key: "safety", label: "Safety" },
];

const guideSections = [
  {
    category: "daily",
    badge: "Store Control",
    title: "1. Store Selection",
    items: [
      "Choose the correct store on the login page before logging in.",
      "Always check the selected store name at the top of the system.",
      "Sales, debts, stock, purchases, expenses, returns and reports belong to the selected store.",
      "To switch store, logout, select another store, and login again.",
      "Do not record a sale, purchase, transfer, return or stock adjustment until the selected store is correct.",
    ],
  },
  {
    category: "daily",
    badge: "Daily Work",
    title: "2. Daily Workflow",
    items: [
      "Login with your username, password and selected store.",
      "Check Dashboard for sales, debts, stock value and low stock.",
      "Add or update products if stock arrives.",
      "Use New Sale to sell products from the selected store.",
      "Print or download receipt after sale.",
      "Record debt payment when customer pays later.",
      "Record expenses, purchases and returns when needed.",
      "Use stock transfers when moving items between stores.",
      "Use Daily Closing for the selected store at the end of the day.",
    ],
  },
  {
    category: "stock",
    badge: "Inventory",
    title: "3. Products",
    items: [
      "Go to Products.",
      "Add product name, category, excavator type, price and quantity.",
      "Use low-stock level to know when to restock.",
      "Search products by name, barcode, category or excavator type.",
      "Product stock is separated by store.",
      "Admin or manager can edit products and adjust stock.",
      "Admin can delete or disable products when necessary.",
    ],
  },
  {
    category: "stock",
    badge: "Stock Control",
    title: "4. Stock Adjustment",
    items: [
      "Go to Products.",
      "Click Adjust Stock on the product.",
      "Choose Increase Stock, Decrease Stock or Set Exact Stock.",
      "Enter the quantity and the reason.",
      "Use this for damaged items, lost items, physical count correction, wrong entry correction or stock count update.",
      "The system records old stock, new stock, reason, date and user.",
      "Recent Stock Adjustment Records show at the bottom of the Products page.",
    ],
  },
  {
    category: "stock",
    badge: "Stock Audit",
    title: "5. Product Stock Movement Ledger",
    items: [
      "Go to Products.",
      "Find the product you want to inspect.",
      "Click View Ledger.",
      "The ledger shows how the product stock moved from opening stock to current stock.",
      "It includes purchases, sales, returns, stock adjustments, transfers in and transfers out.",
      "Use the running balance to understand why the current stock is what it is.",
      "This is useful when stock quantity is questioned during audit or physical counting.",
    ],
  },
  {
    category: "stock",
    badge: "Two Stores",
    title: "6. Stock Transfers Between Stores",
    items: [
      "Go to Stock Transfers.",
      "Select the source store and destination store.",
      "Add products and quantities to transfer.",
      "Create the transfer request.",
      "Approve the transfer when management agrees.",
      "Dispatch the transfer to reduce stock from the source store.",
      "Receive the transfer to add stock to the destination store.",
      "Download the Transfer Note PDF for printing or physical signing.",
    ],
    warning:
      "Approval does not move stock. Dispatch reduces the source store. Receive increases the destination store.",
  },
  {
    category: "sales",
    badge: "Sales",
    title: "7. New Sale",
    items: [
      "Go to New Sale.",
      "Confirm the selected store before selling.",
      "Search and select product.",
      "Enter quantity.",
      "Add customer details if needed.",
      "Select payment type: cash, MoMo, bank, credit or mixed.",
      "Save sale and print or download receipt.",
      "For credit sales, debt is created automatically.",
    ],
  },
  {
    category: "sales",
    badge: "Customers",
    title: "8. Debts",
    items: [
      "Credit sales automatically create debt records.",
      "Go to Debts to see unpaid customers for the selected store.",
      "Record payment when the customer pays.",
      "The balance reduces automatically.",
      "Paid debts will show as completed or paid.",
      "Debt records help management follow customers who owe money.",
    ],
  },
  {
    category: "stock",
    badge: "Purchasing",
    title: "9. Purchases & Suppliers",
    items: [
      "Use Purchases when buying stock from suppliers.",
      "Confirm the selected store before saving a purchase.",
      "Purchase items increase stock only in the selected store.",
      "Supplier records are also separated by store.",
      "Record supplier balance payments when paying later.",
      "Use purchase history to track how stock entered the business.",
    ],
  },
  {
    category: "management",
    badge: "Shop Costs",
    title: "10. Expenses & Returns",
    items: [
      "Use Expenses for shop costs like transport, rent and repairs.",
      "Expenses are saved under the selected store.",
      "Use Returns when a customer returns an item.",
      "Returns increase stock only in the selected store.",
      "Managers and admins should review returns carefully.",
      "Returns and expenses affect business reports.",
    ],
  },
  {
    category: "management",
    badge: "Reports",
    title: "11. Reports, Exports & Daily Closing",
    items: [
      "Managers and admins can view Reports.",
      "Use date filters to check sales performance.",
      "Reports show data for the selected store only.",
      "Use Exports to download selected-store business records.",
      "Export Stock Movement Ledger to download a full product stock audit workbook.",
      "Use Daily Closing to confirm end-of-day money for a store.",
      "Daily Closing helps compare system sales and cash available.",
    ],
  },
  {
    category: "management",
    badge: "Export Files",
    title: "12. Excel Exports",
    items: [
      "Go to Exports.",
      "Use the date filter if you want records within a date range.",
      "Products, Low Stock and Debts export all records for the store.",
      "Sales, Expenses, Purchases, Returns, Stock Adjustments, Stock Transfers, Stock Movement Ledger, Debt Payments and Daily Closings can use the date filter.",
      "Use Stock Movement Ledger export when management wants to review stock movements for all products.",
      "Use Stock Transfers export when management wants to review movements between stores.",
    ],
  },
  {
    category: "management",
    badge: "Accounting",
    title: "13. Advanced Accounting Intelligence",
    items: [
      "Use this page to review advanced accounting signals.",
      "Check profit, loss, stock movement and suspicious changes.",
      "Review sales, expenses, debts, purchases and returns together.",
      "Managers should use it to detect business mistakes early.",
      "The page helps management understand whether the store is healthy.",
    ],
  },
  {
    category: "management",
    badge: "SMS",
    title: "14. SMS Center",
    items: [
      "Use SMS Center to send business messages to customers.",
      "Use templates for debt reminders and customer notices.",
      "Confirm recipient numbers carefully before sending live SMS.",
      "Check SMS status to see successful and failed messages.",
      "Retry failed SMS only after confirming the phone number.",
      "Only approved users should send bulk SMS.",
    ],
  },
  {
    category: "management",
    badge: "Audit",
    title: "15. Audit Controls",
    items: [
      "Audit Sign-Off locks approved accounting periods.",
      "Locked periods stop changes inside approved records.",
      "Staff can request unlock when a correction is needed.",
      "Admin or manager must review unlock requests.",
      "Audit history and unlock requests are separated by store.",
      "Use audit controls before presenting final reports.",
    ],
  },
  {
    category: "safety",
    badge: "System Safety",
    title: "16. Backup, Restore & Maintenance",
    items: [
      "Backup and Restore are full-system actions.",
      "Maintenance clear test data is also a full-system action.",
      "These actions are not limited to the selected store.",
      "Backup before clearing test data.",
      "Only use Maintenance before real operation starts.",
      "Do not reset or clear real business data without approval.",
    ],
  },
  {
    category: "safety",
    badge: "Permissions",
    title: "17. User Roles",
    type: "unordered",
    items: [
      "Cashier: Can sell, view products, debts and basic records.",
      "Manager: Can access reports, purchases, expenses, returns, exports, stock adjustments, stock transfers, daily closing and audit review areas.",
      "Admin: Can manage users, settings, backups, activity logs and sensitive system areas.",
      "System Administrator: Can access System Maintenance and full reset actions.",
    ],
  },
  {
    category: "daily",
    badge: "PWA",
    title: "18. Install App",
    items: [
      "Click Install App in the sidebar.",
      "Accept the browser install prompt.",
      "The system will appear like an app on the phone or computer.",
      "On iPhone, use Share then Add to Home Screen.",
      "Always use the official Chalin 03 link when opening the app.",
    ],
  },
  {
    category: "safety",
    badge: "Security",
    title: "19. Important Safety Notes",
    type: "unordered",
    items: [
      "Do not share admin password.",
      "Change password regularly.",
      "Always confirm the selected store before recording sales.",
      "Always enter clear reasons for stock adjustments.",
      "Use stock transfers instead of manually reducing one store and increasing another.",
      "Use stock movement ledger when product quantity does not look correct.",
      "Backup before clearing test data.",
      "Only use System Maintenance before real operation starts.",
      "Do not delete data after real business starts unless approved.",
    ],
  },
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
