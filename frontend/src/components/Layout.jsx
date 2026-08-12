import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import CompactSidebarNavigation from "./CompactSidebarNavigation";
import SidebarAccountMenu from "./SidebarAccountMenu";
import "../styles/sidebarPolish.css";
import { useAuth } from "../context/AuthContext";

function getStoreCode(store) {
  return store?.code || store?.branch_code || "";
}

function getStoreName(store) {
  return store?.name || store?.branch_name || "";
}

function getStoreLocation(store) {
  return store?.location || store?.branch_location || "";
}

function getUserInitials(name) {
  const cleanName = String(name || "User").trim();

  if (!cleanName) return "U";

  return cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function Layout() {
  const {
    user,
    logout,
    selectedBranch,
    branchId,
    branchCode,
    branchName,
    branchLocation,
    canAccessAllBranches,
    hasPermission,
  } = useAuth();

  const navigate = useNavigate();

  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const isAuditor = role === "auditor";
  const canManage = role === "admin" || role === "manager";
  const canAudit = canManage || isAuditor;
  const isAdmin = role === "admin";

  const isSystemAdministrator = Boolean(
    user?.is_original_system_administrator ||
      (user?.primary_workspace_code === "*" && role === "admin")
  );

  const displayName = user?.full_name || user?.username || "User";
  const userInitials = getUserInitials(displayName);

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    getStoreName(selectedBranch) ||
    getStoreName(user?.selected_branch) ||
    "No store selected";

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    getStoreCode(selectedBranch) ||
    getStoreCode(user?.selected_branch) ||
    "STORE";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    getStoreLocation(selectedBranch) ||
    getStoreLocation(user?.selected_branch) ||
    "Location not set";

  const storeAccessLabel = canAccessAllBranches
    ? "All-store access"
    : branchId
    ? `Store ID ${branchId}`
    : "No store ID";

  const navigationSections = useMemo(() => {
    const mainWorkItems = isAuditor
      ? [
          {
            title: "Change Password",
            description: "Update your auditor login password",
            path: "/change-password",
            icon: "🔐",
            keywords: "password security change login auditor",
          },
          {
            title: "Notification Centre",
            description: "Store alerts, overdue debt and management notices",
            path: "/notifications",
            icon: "🔔",
            keywords: "notifications alerts reminders unread archive management",
          },
          {
            title: "Help / User Guide",
            description: "Open the built-in operating guide",
            path: "/help",
            icon: "📘",
            keywords: "help guide manual learn support instructions auditor",
          },
        ]
      : [
          {
            title: "Dashboard",
            description: "Open the business command center",
            path: "/",
            icon: "🏠",
            keywords: "home dashboard business command center overview boss",
          },
          {
            title: "Products",
            description: "Stock, prices, barcodes, ledger and adjustments",
            path: "/products",
            icon: "📦",
            keywords:
              "products inventory stock spare parts excavator barcode quantity ledger adjustment",
          },
          {
            title: "New Sale",
            description: "Record cash, MoMo, bank, mixed, credit or installment sale",
            path: "/new-sale",
            icon: "🛒",
            keywords: "sale sell receipt customer payment cash momo bank credit",
          },
          {
            title: "Sales History",
            description: "View previous sales, receipts and transactions",
            path: "/sales-history",
            icon: "🧾",
            keywords: "sales history receipt transaction old sale previous",
          },
          {
            title: "Installment Sales",
            description: "Agreements, due dates, collections and reminders",
            path: "/installments",
            icon: "📅",
            keywords:
              "installment instalment payment plan due overdue collection customer statement",
          },
          {
            title: "Debts",
            description: "Track customer balances and payments",
            path: "/debts",
            icon: "📞",
            keywords: "debt debts credit balance payment reminder whatsapp owing",
          },
          ...(hasPermission("payroll.view")
            ? [
                {
                  title: "Payroll Processing",
                  description: "Validate, approve, pay and reconcile protected salary cycles",
                  path: "/payroll",
                  icon: "💵",
                  keywords: "payroll salary wages approval payment reconciliation workforce",
                },
              ]
            : []),
          {
            title: "Change Password",
            description: "Update your staff login password",
            path: "/change-password",
            icon: "🔐",
            keywords: "password security change login",
          },
          {
            title: "Notification Centre",
            description: "Store alerts, overdue debt and management notices",
            path: "/notifications",
            icon: "🔔",
            keywords: "notifications alerts reminders unread archive management",
          },
          {
            title: "Help / User Guide",
            description: "Open the built-in operating guide",
            path: "/help",
            icon: "📘",
            keywords: "help guide manual learn support instructions",
          },
        ];

    const sections = [
      {
        title: isAuditor ? "Auditor Work" : "Main Work",
        items: mainWorkItems,
      },
    ];

    if (canAudit) {
      const auditItems = [
        {
          title: "Shared Reports & Documents",
          description: "Controlled reporting, document access and audit evidence",
          path: "/shared-controls",
          icon: "📚",
          keywords:
            "shared reports documents audit evidence exports role scope access reprint",
        },
        {
          title: "Customer Statement",
          description: "Review customer sales and debt records",
          path: "/customer-statement",
          icon: "👤",
          keywords: "customer statement account balance records history audit",
        },
        {
          title: "Reports",
          description: "Sales, stock, transfers and management reports",
          path: "/reports",
          icon: "📊",
          keywords:
            "reports analytics sales profit business performance stock transfers adjustments audit",
        },
        {
          title: "Audit & Accounting",
          description: "Review money, debts, expenses, stock and warnings",
          path: "/audit-accounting",
          icon: "🧮",
          keywords:
            "audit accounting accountant review cash sales expenses debts fuel discounts warnings",
        },
        {
          title: "Accounting Intelligence",
          description: "Advanced ledger, audit score, SMS and stock intelligence",
          path: "/advanced-accounting-intelligence",
          icon: "📈",
          keywords:
            "advanced accounting intelligence ledger profit loss audit score branch debt stock sms maintenance backup restore",
        },
        {
          title: "Audit Sign-Off History",
          description: "Saved approvals, certificates and audit history",
          path: "/audit-signoffs",
          icon: "✅",
          keywords:
            "audit signoff sign-off approval history approved period accountant certificate management",
        },
        {
          title: "Exports",
          description: "Export audit and management records",
          path: "/exports",
          icon: "📤",
          keywords:
            "exports excel download data report stock ledger transfers adjustments audit",
        },
      ];

      if (isSystemAdministrator) {
        auditItems.unshift({
          title: "Group Executive Control",
          description: "Boss-level view of Spare Parts, Mining, Hire and Fleet",
          path: "/group-executive-control",
          icon: "🏢",
          keywords:
            "group executive boss control centre dashboard spare parts mining equipment hire fleet revenue expenses debt alerts",
        });
      }

      if (canManage) {
        auditItems.unshift({
          title: "Employment & HR Documents",
          description: "Prepare new-hire letters before worker registration",
          path: "/employment-documents",
          icon: "✍️",
          keywords: "employment appointment hiring worker letter hr document candidate signature",
        });
        auditItems.splice(1, 0, {
          title: "SMS Center",
          description: "Send live SMS, review logs and retry failures",
          path: "/sms",
          icon: "📩",
          keywords:
            "sms text message customers phone bulk selected all reminder notice failed arkesel",
        });

        auditItems.splice(
          4,
          0,
          {
            title: "Audit Unlock Requests",
            description: "Approve or reject locked-period correction requests",
            path: "/audit-unlock-requests",
            icon: "🔓",
            keywords:
              "audit unlock requests approval correction locked period stock sms backup maintenance",
          },
          {
            title: "Stock Transfers",
            description: "Request, approve, dispatch and receive stock",
            path: "/stock-transfers",
            icon: "🔁",
            keywords:
              "stock transfers transfer between stores branches move dispatch receive approve inventory",
          },
          {
            title: "Inventory Control & Traceability",
            description: "Physical unit IDs, controlled labels, exact-item lookup and loss prevention",
            path: "/inventory-traceability",
            icon: "🏷️",
            keywords:
              "inventory traceability loss prevention theft serialized serial unit id labels qr missing stock physical count",
          },
          {
            title: "Low Stock / Restock",
            description: "View items that need restocking",
            path: "/low-stock",
            icon: "🚨",
            keywords: "low stock restock reorder shortage products inventory",
          },
          {
            title: "Expenses",
            description: "Fuel, transport, rent, salary and other costs",
            path: "/expenses",
            icon: "⛽",
            keywords: "expenses fuel transport rent salary internet repairs cost",
          },
          {
            title: "Purchases",
            description: "Supplier purchases and payment records",
            path: "/purchases",
            icon: "🚚",
            keywords: "purchases suppliers stock buying purchase payment",
          },
          {
            title: "Returns",
            description: "Record returned items and corrections",
            path: "/returns",
            icon: "↩️",
            keywords: "returns returned items refund exchange correction",
          },
          {
            title: "Daily Closing",
            description: "Close the day and compare cash movement",
            path: "/daily-closing",
            icon: "🌙",
            keywords: "daily closing close day cash sales summary",
          }
        );
      }

      sections.push({
        title: isAuditor ? "Auditor Accounting Work" : "Management",
        items: auditItems,
      });
    }

    if (isAdmin) {
      const adminItems = [
        {
          title: "Users & Settings",
          description: "Manage staff, roles and business settings",
          path: "/users-settings",
          icon: "⚙️",
          keywords: "users settings roles admin cashier manager auditor reset password",
        },
        {
          title: "User Permissions",
          description: "Grant or restrict individual pages and actions per user",
          path: "/user-permissions",
          icon: "🔑",
          keywords:
            "user permission manager allow deny restrict page action expiry session revoke",
        },
        {
          title: "Activity Log",
          description: "Review staff and system activities",
          path: "/activity-log",
          icon: "🕵️",
          keywords: "activity log audit staff actions security",
        },
        {
          title: "Worker Profiles",
          description: "Employees, assignments, licences, documents and property",
          path: "/workers",
          icon: "👷",
          keywords:
            "workers employees staff profiles assignments licences documents property workforce",
        },
        {
          title: "Document Signature Settings",
          description: "Boss signature used for approved employment documents",
          path: "/document-signature-settings",
          icon: "🖋️",
          keywords: "boss signature draw finger approval document settings",
        },
      ];

      if (isSystemAdministrator) {
        adminItems.push(
          {
            title: "Backup & Restore",
            description: "Download or restore the full system database",
            path: "/backup",
            icon: "💾",
            keywords: "backup restore database data safety full system",
          },
          {
            title: "Security Centre",
            description: "Sessions, locks, Break-Glass and privileged audit evidence",
            path: "/security-centre",
            icon: "🛡️",
            keywords: "security centre sessions locks login break glass privileged ledger recovery",
          },
          {
            title: "Professional Backups",
            description: "Module packages, manifests, checksums and verification",
            path: "/professional-backups",
            icon: "🔐",
            keywords: "professional backup manifest checksum verify full mining hire fleet workforce",
          },
          {
            title: "System Operations",
            description: "Health, readiness, diagnostics and local acceptance",
            path: "/system-operations",
            icon: "🖥️",
            keywords: "system operations health readiness diagnostics acceptance backup restore",
          },
          {
          title: "System Maintenance",
          description: "Clear test data and maintain the system",
          path: "/maintenance",
          icon: "🧰",
          keywords: "maintenance clear test data reset system administrator",
          }
        );
      }

      sections.push({
        title: "Admin Control",
        items: adminItems,
      });
    }

    return sections;
  }, [canManage, canAudit, isAuditor, isAdmin, isSystemAdministrator, hasPermission]);

  const commandItems = useMemo(() => {
    return navigationSections.flatMap((section) =>
      section.items.map((item) => ({ ...item, group: section.title }))
    );
  }, [navigationSections]);

  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();

    if (!query) return commandItems;

    return commandItems.filter((item) => {
      const searchableText = [
        item.title,
        item.description,
        item.keywords,
        item.group,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [commandItems, commandQuery]);

  useEffect(() => {
    function checkScreenSize() {
      const mobile = window.innerWidth <= 920;
      setIsMobile(mobile);

      if (!mobile) {
        setMenuOpen(false);
      }
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  useEffect(() => {
    if ((isMobile && menuOpen) || commandOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, menuOpen, commandOpen]);

  useEffect(() => {
    function handleKeyboard(event) {
      const isCommandShortcut = event.ctrlKey || event.metaKey;

      if (isCommandShortcut && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        openCommandCenter();
      }

      if (event.key === "Escape") {
        closeCommandCenter();
      }
    }

    window.addEventListener("keydown", handleKeyboard);

    return () => {
      window.removeEventListener("keydown", handleKeyboard);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function closeMobileMenu() {
    if (isMobile) {
      setMenuOpen(false);
    }
  }

  function goToChangePassword() {
    closeMobileMenu();
    navigate("/change-password");
  }

  function openCommandCenter() {
    setCommandOpen(true);
    setCommandQuery("");
    closeMobileMenu();
  }

  function closeCommandCenter() {
    setCommandOpen(false);
    setCommandQuery("");
  }

  function runCommand(path) {
    closeCommandCenter();
    closeMobileMenu();
    navigate(path);
  }

  return (
    <div className="premium-layout">
      <style>{`
        .premium-layout {
          --navy: #07182c;
          --navy-2: #0d2f55;
          --navy-3: #164777;
          --gold: #e0ba28;
          --paper: #f5f7fb;
          --text: #07182c;
          width: 100%;
          height: 100dvh;
          display: flex;
          overflow: hidden;
          background:
            radial-gradient(circle at 16% 12%, rgba(224, 186, 40, 0.18), transparent 30%),
            radial-gradient(circle at 88% 10%, rgba(59, 130, 246, 0.14), transparent 28%),
            linear-gradient(135deg, #eef3f9 0%, #f8fafc 54%, #eaf0f7 100%);
          color: var(--text);
        }

        .premium-layout * {
          box-sizing: border-box;
        }

        .premium-mobile-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 66px;
          z-index: 900;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 9px;
          padding: 0 11px;
          background:
            linear-gradient(135deg, rgba(7, 24, 44, 0.96), rgba(13, 47, 85, 0.96));
          color: #ffffff;
          border-bottom: 1px solid rgba(224, 186, 40, 0.24);
          box-shadow: 0 12px 30px rgba(7, 24, 44, 0.25);
          backdrop-filter: blur(18px);
        }

        .premium-mobile-button {
          border: none;
          border-radius: 14px;
          color: #ffffff;
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }

        .premium-mobile-menu-button {
          background: rgba(224, 186, 40, 0.18);
          border: 1px solid rgba(224, 186, 40, 0.32);
        }

        .premium-mobile-out-button {
          background: rgba(195, 38, 29, 0.92);
        }

        .premium-mobile-search {
          min-width: 0;
          border: 1px solid rgba(224, 186, 40, 0.42);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
          padding: 9px 11px;
          font-weight: 950;
          cursor: pointer;
          text-align: left;
          overflow: hidden;
        }

        .premium-mobile-search span,
        .premium-mobile-search small {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-mobile-search span {
          font-size: 13px;
          line-height: 1.1;
        }

        .premium-mobile-search small {
          margin-top: 2px;
          color: rgba(255, 255, 255, 0.68);
          font-size: 10px;
          line-height: 1;
        }

        .premium-sidebar {
          width: 286px;
          height: 100dvh;
          color: #ffffff;
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr) auto;
          overflow: hidden;
          flex-shrink: 0;
          z-index: 1000;
          background:
            radial-gradient(circle at 20% 0%, rgba(224, 186, 40, 0.18), transparent 28%),
            radial-gradient(circle at 88% 25%, rgba(22, 71, 119, 0.62), transparent 34%),
            linear-gradient(180deg, #07182c 0%, #0a213d 48%, #06101f 100%);
          border-right: 1px solid rgba(224, 186, 40, 0.18);
          box-shadow: 20px 0 55px rgba(7, 24, 44, 0.18);
          transition: transform 0.25s ease;
        }

        .premium-sidebar.mobile {
          width: min(100vw, 390px);
          position: fixed;
          top: 0;
          left: 0;
          transform: translateX(-110%);
          box-shadow: 30px 0 90px rgba(0, 0, 0, 0.42);
        }

        .premium-sidebar.mobile.open {
          transform: translateX(0);
        }

        .premium-sidebar-overlay {
          position: fixed;
          inset: 0;
          z-index: 980;
          background: rgba(2, 6, 23, 0.62);
          backdrop-filter: blur(4px);
        }

        .premium-brand {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 13px;
          padding: 18px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .premium-brand-logo {
          width: 58px;
          height: 58px;
          border-radius: 19px;
          object-fit: cover;
          background: var(--navy);
          border: 2px solid rgba(224, 186, 40, 0.92);
          box-shadow: 0 16px 36px rgba(224, 186, 40, 0.16);
        }

        .premium-brand h2 {
          margin: 0;
          font-size: 22px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -0.04em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-brand p {
          margin: 5px 0 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-close-button {
          border: none;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
        }

        .premium-sidebar-tools {
          padding: 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .premium-command-button {
          width: 100%;
          border: 1px solid rgba(224, 186, 40, 0.45);
          border-radius: 20px;
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.16), rgba(22, 71, 119, 0.52));
          color: #ffffff;
          padding: 13px;
          cursor: pointer;
          text-align: left;
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.2);
          overflow: hidden;
        }

        .premium-command-button-grid {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr) auto;
          gap: 11px;
          align-items: center;
        }

        .premium-command-icon {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: rgba(255, 255, 255, 0.10);
          font-size: 18px;
        }

        .premium-command-button strong,
        .premium-command-button small {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-command-button strong {
          font-size: 14px;
          line-height: 1.15;
          font-weight: 950;
        }

        .premium-command-button small {
          margin-top: 3px;
          color: rgba(255, 255, 255, 0.68);
          font-size: 11px;
          font-weight: 750;
        }

        .premium-command-shortcut {
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 9px;
          padding: 5px 7px;
          color: rgba(255, 255, 255, 0.78);
          font-size: 10px;
          font-weight: 950;
          line-height: 1;
        }

        .premium-store-card {
          margin-top: 13px;
          padding: 14px;
          border-radius: 22px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.05));
          border: 1px solid rgba(224, 186, 40, 0.32);
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.16);
        }

        .premium-store-card label {
          display: block;
          margin: 0;
          color: var(--gold);
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .premium-store-card h3 {
          margin: 6px 0 0;
          color: #ffffff;
          font-size: 14px;
          font-weight: 950;
          line-height: 1.25;
        }

        .premium-store-card p {
          margin: 5px 0 0;
          color: rgba(255, 255, 255, 0.70);
          font-size: 12px;
          font-weight: 750;
          line-height: 1.35;
        }

        .premium-nav-scroll {
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 14px 14px 18px;
        }

        .premium-nav-scroll::-webkit-scrollbar,
        .premium-command-list::-webkit-scrollbar {
          width: 8px;
        }

        .premium-nav-scroll::-webkit-scrollbar-thumb,
        .premium-command-list::-webkit-scrollbar-thumb {
          background: rgba(224, 186, 40, 0.24);
          border-radius: 999px;
        }

        .premium-nav-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 18px 8px 9px;
          color: rgba(255, 255, 255, 0.52);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .premium-nav-section-title::after {
          content: "";
          height: 1px;
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
        }

        .premium-nav-link {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          width: 100%;
          min-height: 46px;
          padding: 9px 11px;
          margin-bottom: 6px;
          border-radius: 16px;
          color: rgba(255, 255, 255, 0.84);
          text-decoration: none;
          font-weight: 850;
          font-size: 14px;
          line-height: 1.2;
          border: 1px solid transparent;
          transition: 0.18s ease;
        }

        .premium-nav-link:hover {
          transform: translateX(2px);
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.08);
        }

        .premium-nav-link.active {
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.24), rgba(22, 71, 119, 0.55));
          border-color: rgba(224, 186, 40, 0.38);
          box-shadow: 0 14px 28px rgba(0, 0, 0, 0.18);
          color: #ffffff;
        }

        .premium-nav-icon {
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.08);
          font-size: 17px;
        }

        .premium-nav-link.active .premium-nav-icon {
          background: rgba(224, 186, 40, 0.22);
        }

        .premium-nav-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-user-panel {
          padding: 14px 16px 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(2, 6, 23, 0.18);
        }

        .premium-user-row {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr);
          gap: 11px;
          align-items: center;
          margin-bottom: 12px;
        }

        .premium-avatar {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, var(--gold), #f5d76e);
          color: var(--navy);
          font-size: 15px;
          font-weight: 950;
          box-shadow: 0 12px 26px rgba(224, 186, 40, 0.18);
        }

        .premium-user-name {
          margin: 0;
          font-weight: 950;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-user-role {
          display: block;
          margin-top: 3px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.62);
          text-transform: uppercase;
          font-weight: 950;
          letter-spacing: 0.08em;
        }

        .premium-working-branch {
          margin-bottom: 12px;
          padding: 11px;
          border-radius: 17px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.10);
        }

        .premium-working-branch label {
          display: block;
          margin: 0;
          color: var(--gold);
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .premium-working-branch strong,
        .premium-working-branch span {
          display: block;
        }

        .premium-working-branch strong {
          margin-top: 5px;
          color: #ffffff;
          font-size: 12px;
          font-weight: 950;
          line-height: 1.35;
        }

        .premium-working-branch span {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.62);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.3;
        }

        .premium-side-action {
          width: 100%;
          border: none;
          border-radius: 13px;
          padding: 11px 12px;
          color: #ffffff;
          font-weight: 950;
          cursor: pointer;
          margin-top: 9px;
        }

        .premium-password-button {
          background: var(--navy-3);
        }

        .premium-logout-button {
          background: #c3261d;
        }

        .premium-main {
          flex: 1;
          min-width: 0;
          width: 100%;
          height: 100dvh;
          overflow-y: auto;
          overflow-x: auto;
          padding: 24px 28px 32px;
        }

        .premium-main-topbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
          padding: 14px 16px;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(203, 213, 225, 0.82);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }

        .premium-main-topbar h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: -0.03em;
          color: var(--navy);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-main-topbar p {
          margin: 4px 0 0;
          color: #667085;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-topbar-button {
          border: 1px solid #dbe3ef;
          border-radius: 15px;
          background: #ffffff;
          color: var(--navy);
          padding: 11px 13px;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }

        .premium-topbar-command {
          border-color: rgba(224, 186, 40, 0.42);
          background: linear-gradient(135deg, #ffffff, #fff9df);
        }

        .premium-topbar-logout {
          background: #fff5f5;
          color: #b91c1c;
          border-color: #fecaca;
        }

        .premium-command-overlay {
          position: fixed;
          inset: 0;
          z-index: 3000;
          background: rgba(7, 24, 44, 0.74);
          backdrop-filter: blur(10px);
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .premium-command-modal {
          width: 100%;
          max-width: 800px;
          max-height: 84vh;
          background: #ffffff;
          border-radius: 30px;
          box-shadow: 0 34px 100px rgba(0, 0, 0, 0.38);
          overflow: hidden;
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
        }

        .premium-command-header {
          padding: 22px;
          background:
            radial-gradient(circle at 20% 0%, rgba(224, 186, 40, 0.23), transparent 34%),
            linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%);
          color: #ffffff;
        }

        .premium-command-header-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          align-items: start;
        }

        .premium-command-eyebrow {
          margin: 0;
          color: var(--gold);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .premium-command-header h2 {
          margin: 6px 0 0;
          font-size: 30px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .premium-command-header p {
          margin: 9px 0 0;
          color: rgba(255, 255, 255, 0.74);
          line-height: 1.5;
          font-size: 14px;
          font-weight: 700;
        }

        .premium-command-store-pill {
          margin-top: 13px;
          display: inline-flex;
          max-width: 100%;
          align-items: center;
          gap: 8px;
          padding: 8px 11px;
          border-radius: 999px;
          background: rgba(224, 186, 40, 0.15);
          border: 1px solid rgba(224, 186, 40, 0.30);
          color: #ffffff;
          font-size: 12px;
          font-weight: 900;
        }

        .premium-command-store-pill span:last-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .premium-command-close {
          border: none;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
          padding: 10px 13px;
          cursor: pointer;
          font-weight: 950;
        }

        .premium-command-search {
          padding: 16px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .premium-command-search input {
          width: 100%;
          border: 2px solid #dbe3ef;
          border-radius: 18px;
          padding: 15px 17px;
          font-size: 16px;
          font-weight: 850;
          outline: none;
          background: #ffffff;
          color: var(--navy);
        }

        .premium-command-search input:focus {
          border-color: var(--gold);
          box-shadow: 0 0 0 4px rgba(224, 186, 40, 0.14);
        }

        .premium-command-chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
        }

        .premium-command-chip {
          border: 1px solid #dbe3ef;
          background: #ffffff;
          color: var(--navy-3);
          border-radius: 999px;
          padding: 7px 11px;
          cursor: pointer;
          font-weight: 950;
          font-size: 12px;
        }

        .premium-command-list {
          min-height: 0;
          overflow-y: auto;
          padding: 14px;
          background: #ffffff;
        }

        .premium-command-item {
          width: 100%;
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 18px;
          padding: 12px;
          text-align: left;
          cursor: pointer;
          color: var(--navy);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
          margin-bottom: 10px;
          transition: 0.16s ease;
        }

        .premium-command-item:hover {
          transform: translateY(-2px);
          border-color: rgba(224, 186, 40, 0.48);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.10);
        }

        .premium-command-item-icon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          background: #f1f5f9;
          display: grid;
          place-items: center;
          font-size: 23px;
        }

        .premium-command-item strong {
          display: block;
          font-size: 15px;
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .premium-command-item small {
          display: block;
          margin-top: 4px;
          color: #64748b;
          font-weight: 750;
          line-height: 1.4;
        }

        .premium-command-arrow {
          color: #94a3b8;
          font-weight: 950;
          font-size: 18px;
        }

        .premium-empty-command {
          padding: 24px;
          border-radius: 18px;
          background: #f8fafc;
          color: #64748b;
          text-align: center;
          font-weight: 850;
          border: 1px dashed #cbd5e1;
        }

        @media (max-width: 920px) {
          .premium-layout {
            display: block;
          }

          .premium-command-button-grid {
            grid-template-columns: 38px minmax(0, 1fr);
          }

          .premium-command-shortcut,
          .premium-main-topbar {
            display: none;
          }

          .premium-main {
            height: 100dvh;
            padding: 86px 14px 24px;
          }

          .premium-command-overlay {
            place-items: start center;
            padding: 78px 14px 20px;
          }

          .premium-command-modal {
            max-height: calc(100dvh - 96px);
            border-radius: 22px;
          }

          .premium-command-header {
            padding: 17px;
          }

          .premium-command-header h2 {
            font-size: 23px;
          }

          .premium-command-item {
            grid-template-columns: 44px minmax(0, 1fr);
          }

          .premium-command-arrow {
            display: none;
          }
        }

        /* Compact mobile drawer fix.
           This keeps the premium desktop design, but makes the phone menu smaller
           so the actual pages get more space. */
        @media (max-width: 920px) {
          .premium-mobile-bar {
            height: 56px;
            padding: 0 8px;
            gap: 7px;
          }

          .premium-mobile-button {
            padding: 8px 9px;
            border-radius: 12px;
            font-size: 12px;
          }

          .premium-mobile-menu-button {
            min-width: 0;
          }

          .premium-mobile-out-button {
            min-width: 0;
          }

          .premium-mobile-search {
            padding: 7px 9px;
            border-radius: 13px;
          }

          .premium-mobile-search span {
            font-size: 12px;
          }

          .premium-mobile-search small {
            font-size: 9px;
          }

          .premium-main {
            padding: 66px 10px 16px;
          }

          .premium-sidebar.mobile {
            width: min(94vw, 340px);
            grid-template-rows: auto auto minmax(0, 1fr) auto;
          }

          .premium-brand {
            padding: 10px 12px;
            gap: 9px;
          }

          .premium-brand-logo {
            width: 44px;
            height: 44px;
            border-radius: 14px;
          }

          .premium-brand h2 {
            font-size: 18px;
          }

          .premium-brand p {
            margin-top: 2px;
            font-size: 11px;
          }

          .premium-close-button {
            padding: 7px 9px;
            border-radius: 10px;
          }

          .premium-sidebar-tools {
            padding: 9px 10px;
          }

          .premium-command-button {
            padding: 9px;
            border-radius: 14px;
          }

          .premium-command-button-grid {
            grid-template-columns: 30px minmax(0, 1fr);
            gap: 8px;
          }

          .premium-command-icon {
            width: 30px;
            height: 30px;
            border-radius: 10px;
            font-size: 14px;
          }

          .premium-command-button strong {
            font-size: 12px;
          }

          .premium-command-button small {
            margin-top: 1px;
            font-size: 10px;
          }

          .premium-store-card {
            margin-top: 8px;
            padding: 9px 10px;
            border-radius: 15px;
          }

          .premium-store-card label {
            font-size: 9px;
          }

          .premium-store-card h3 {
            margin-top: 4px;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .premium-store-card p {
            margin-top: 3px;
            font-size: 10px;
            line-height: 1.2;
          }

          .premium-nav-scroll {
            padding: 8px 9px 10px;
          }

          .premium-nav-section-title {
            margin: 10px 6px 6px;
            font-size: 9px;
          }

          .premium-nav-link {
            grid-template-columns: 28px minmax(0, 1fr);
            min-height: 37px;
            padding: 6px 8px;
            margin-bottom: 4px;
            border-radius: 12px;
            font-size: 12px;
          }

          .premium-nav-icon {
            width: 28px;
            height: 28px;
            border-radius: 10px;
            font-size: 14px;
          }

          .premium-user-panel {
            padding: 9px 10px 10px;
          }

          .premium-user-row {
            grid-template-columns: 34px minmax(0, 1fr);
            gap: 8px;
            margin-bottom: 8px;
          }

          .premium-avatar {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            font-size: 12px;
          }

          .premium-user-name {
            font-size: 13px;
          }

          .premium-user-role {
            margin-top: 1px;
            font-size: 9px;
          }

          .premium-working-branch {
            display: none;
          }

          .premium-user-panel button,
          .premium-side-action {
            min-height: 0;
            padding: 9px 10px;
            border-radius: 11px;
            margin-top: 7px;
            font-size: 12px;
          }

          .premium-command-overlay {
            padding: 66px 10px 14px;
          }

          .premium-command-modal {
            max-height: calc(100dvh - 78px);
          }
        }

      `}</style>

      {isMobile && (
        <header className="premium-mobile-bar">
          <button
            type="button"
            className="premium-mobile-button premium-mobile-menu-button"
            onClick={() => setMenuOpen(true)}
          >
            ☰ Menu
          </button>

          <button
            type="button"
            className="premium-mobile-search"
            onClick={openCommandCenter}
          >
            <span>🔎 Smart Search</span>
            <small>{currentStoreCode} — {currentStoreName}</small>
          </button>

          <button
            type="button"
            className="premium-mobile-button premium-mobile-out-button"
            onClick={handleLogout}
          >
            Out
          </button>
        </header>
      )}

      {isMobile && menuOpen && (
        <div className="premium-sidebar-overlay" onClick={closeMobileMenu} />
      )}

      <aside
        className={`premium-sidebar ${isMobile ? "mobile" : ""} ${
          menuOpen ? "open" : ""
        }`}
      >
        <div className="premium-brand">
          <img
            src="/chalin03-logo.png"
            alt="Chalin 03 Logo"
            className="premium-brand-logo"
          />

          <div style={{ minWidth: 0 }}>
            <h2>Chalin 03</h2>
            <p>Sales • Stock • Audit</p>
          </div>

          {isMobile && (
            <button
              type="button"
              className="premium-close-button"
              onClick={() => setMenuOpen(false)}
            >
              ✕
            </button>
          )}
        </div>

        <div className="premium-sidebar-tools">
          <div className="premium-store-card premium-store-card-compact">
            <label>{currentStoreCode}</label>
            <div style={{ minWidth: 0 }}>
              <h3>{currentStoreName}</h3>
              <p>{storeAccessLabel}</p>
            </div>
          </div>
        </div>

        <div className="premium-nav-scroll">
          <CompactSidebarNavigation
            sections={navigationSections}
            onNavigate={closeMobileMenu}
          />
        </div>

        <div className="premium-user-panel">
          <SidebarAccountMenu
            displayName={displayName}
            userInitials={userInitials}
            role={user?.role}
            currentStoreCode={currentStoreCode}
            currentStoreName={currentStoreName}
            storeAccessLabel={storeAccessLabel}
            onChangePassword={goToChangePassword}
            onLogout={handleLogout}
          />
        </div>

      </aside>

      <main className="premium-main">
        {!isMobile && (
          <div className="premium-main-topbar">
            <div style={{ minWidth: 0 }}>
              <h1>
                {currentStoreCode} — {currentStoreName}
              </h1>
              <p>
                {currentStoreLocation} • {displayName} • {storeAccessLabel}
              </p>
            </div>

            <button
              type="button"
              className="premium-topbar-button premium-topbar-command"
              onClick={openCommandCenter}
            >
              🔎 Smart Command
            </button>

            <button
              type="button"
              className="premium-topbar-button premium-topbar-logout"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        )}

        <Outlet />
      </main>

      {commandOpen && (
        <div
          className="premium-command-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCommandCenter();
            }
          }}
        >
          <div className="premium-command-modal">
            <div className="premium-command-header">
              <div className="premium-command-header-row">
                <div style={{ minWidth: 0 }}>
                  <p className="premium-command-eyebrow">Smart Navigation</p>
                  <h2>Smart Command Center</h2>
                  <p>
                    Search any page and jump there quickly. On desktop, press
                    Ctrl + K anytime.
                  </p>

                  <div className="premium-command-store-pill">
                    <span>🏬</span>
                    <span>
                      {currentStoreCode} — {currentStoreName}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="premium-command-close"
                  onClick={closeCommandCenter}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="premium-command-search">
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Type sale, product, debt, stock, SMS, audit, backup..."
              />

              <div className="premium-command-chips">
                {[
                  "sale",
                  "product",
                  "stock",
                  "sms",
                  "debt",
                  "audit",
                  "backup",
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="premium-command-chip"
                    onClick={() => setCommandQuery(sample)}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <div className="premium-command-list">
              {filteredCommandItems.length === 0 ? (
                <div className="premium-empty-command">
                  No matching command found.
                </div>
              ) : (
                filteredCommandItems.map((item) => (
                  <button
                    key={`${item.group}-${item.path}-${item.title}`}
                    type="button"
                    className="premium-command-item"
                    onClick={() => runCommand(item.path)}
                  >
                    <span className="premium-command-item-icon">
                      {item.icon}
                    </span>

                    <span style={{ minWidth: 0 }}>
                      <strong>{item.title}</strong>
                      <small>
                        {item.group} • {item.description}
                      </small>
                    </span>

                    <span className="premium-command-arrow">→</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
