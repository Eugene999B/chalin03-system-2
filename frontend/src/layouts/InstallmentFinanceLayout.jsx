import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import InstallmentMobileEnhancements from "../components/InstallmentMobileEnhancements";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
  ensureFinanceUiCompatibilityPermissions,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentFinanceLifecycleProfessional.css";
import "../styles/equipmentFinanceSignatureShell.css";
import "../styles/equipmentFinanceSignaturePolish.css";
import "../styles/equipmentFinanceThreePageRouteSignature.css";
import "../styles/installmentMobileProfessional.css";
import "../styles/installmentDialogViewportFix.css";

const BLOCKED_FINANCE_PATHS = [
  "/equipment-installment-finance/shared-controls",
  "/equipment-installment-finance/document-signature-settings",
  "/equipment-installment-finance/administration",
];

const THREE_PAGE_PRESENTATION_CLASSES = [
  "finance-installment-page--start",
  "finance-installment-page--applications",
  "finance-installment-page--excavators",
];

function presentationClassFor(location) {
  if (location.pathname !== "/equipment-installment-finance/applications") return null;
  const stage = new URLSearchParams(location.search).get("stage");
  if (stage === "start") return "finance-installment-page--start";
  if (stage === "machines") return "finance-installment-page--excavators";
  if (!stage) return "finance-installment-page--applications";
  return null;
}

const navigationSections = [
  {
    title: "Installment Workflow",
    items: [
      {
        title: "Finance Home",
        description: "One clear path from customer and excavator to approval, agreement and payments",
        path: "/equipment-installment-finance",
        icon: "🏠",
        end: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Start New Installment",
        description: "Choose customer, excavator and payment plan, then create a recoverable draft",
        path: "/equipment-installment-finance/applications?stage=start",
        icon: "➕",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Applications & Approvals",
        description: "Complete drafts, submit applications and record manager decisions",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Task & Approval Inbox",
        description: "Only work requiring action, approval, verification or correction",
        path: "/equipment-installment-finance/applications?stage=inbox",
        legacyPath: "/equipment-installment-finance/applications?stage=operations&tab=inbox",
        icon: "📥",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Case Operations",
        description: "One selected customer case with excavator photo, timeline, evidence and payments",
        path: "/equipment-installment-finance/applications?stage=case-operations",
        legacyPath: "/equipment-installment-finance/applications?stage=operations&tab=case",
        icon: "🗂️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Prepare Agreement",
        description: "Turn an approved application into the authoritative installment agreement",
        path: "/equipment-installment-finance/applications?stage=activation",
        icon: "✍️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Opening Deposits",
        description: "Record the controlled opening deposit and reserve the exact excavator",
        path: "/equipment-installment-finance/applications?stage=deposit",
        icon: "💰",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Accounts & Payments",
    items: [
      {
        title: "Active Installments",
        description: "Read-only account register with schedules, balances, overdue amounts and progress",
        path: "/equipment-installment-finance/applications?stage=accounts",
        legacyPath: "/equipment-installment-finance/applications?stage=collections",
        icon: "📒",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Payments & Collections",
        description: "Record normal installment receipts and review allocation and payment history",
        path: "/equipment-installment-finance/applications?stage=collections",
        icon: "💳",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Customer Installment Profiles",
        description: "One customer view for applications, agreements, schedules, payments and balances",
        path: "/equipment-installment-finance/applications?stage=customer-portfolios",
        icon: "👤",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Payments & Arrears",
        description: "Due and overdue accounts, reminders, promises and follow-up",
        path: "/equipment-installment-finance/applications?stage=arrears",
        icon: "📞",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Corrections & Reversals",
        description: "Governed payment corrections, reversals, returns and approved accounting entries",
        path: "/equipment-installment-finance/applications?stage=corrections",
        icon: "↩️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Customers & Equipment",
    items: [
      {
        title: "Customers",
        description: "Create, search and update reusable company-wide Finance customers",
        path: "/equipment-installment-finance/applications?stage=customers",
        icon: "👥",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Excavators",
        description: "Identity, selling price, protected photographs and sale availability",
        path: "/equipment-installment-finance/applications?stage=machines",
        icon: "🚜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Documents & Reports",
    items: [
      {
        title: "Secure Case Documents",
        description: "Private KYC evidence, reviews, approvals and controlled delivery files",
        path: "/equipment-installment-finance/applications?stage=case-workspace",
        icon: "🔒",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Generated Documents",
        description: "Issued agreements, schedules, receipts, statements and document history",
        path: "/equipment-installment-finance/applications?stage=generated-documents",
        icon: "📄",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Portfolio, SMS & Reports",
        description: "Statements, arrears, cash flow, accounting exports and thermal receipts",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "SMS History",
        description: "Installment Finance customer SMS attempts, provider status and delivery history",
        path: "/equipment-installment-finance/sms-history",
        icon: "✉️",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Staff & Workforce",
        description: "Finance staff logins, roles, profiles, documents and permissions",
        path: "/equipment-installment-finance/workforce",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Payroll Processing",
        description: "Validate, approve, pay and reconcile protected salary cycles",
        path: "/equipment-installment-finance/payroll",
        icon: "💵",
        permissions: ["payroll.view"],
      },
      {
        title: "Finance Settings",
        description: "Payment rules, reminders, alerts, receipts, delivery and legal terms",
        path: "/equipment-installment-finance/applications?stage=settings",
        icon: "⚙️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Final Operations & Reset",
        description: "Verify completion, prepare the read-only reset impact and prove a fresh journey",
        path: "/equipment-installment-finance/applications?stage=finalization",
        icon: "✅",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Help & Guide",
        description: "Beginner guide for creating, approving and operating an installment account",
        path: "/equipment-installment-finance/applications?stage=guide",
        icon: "❓",
        matchSearch: true,
      },
      {
        title: "Back to Equipment Divisions",
        description: "Return to the protected Equipment Business division gateway",
        path: "/equipment-hire",
        icon: "◫",
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Change Password",
        description: "Update your secure Equipment Business account password",
        path: "/equipment-installment-finance/change-password",
        icon: "🔐",
      },
    ],
  },
];

function isBlockedFinancePath(pathname) {
  return BLOCKED_FINANCE_PATHS.some(
    (blockedPath) => pathname === blockedPath || pathname.startsWith(`${blockedPath}/`)
  );
}

export default function InstallmentFinanceLayout() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    document.body.classList.remove(...THREE_PAGE_PRESENTATION_CLASSES);
    const activeClass = presentationClassFor(location);
    if (activeClass) document.body.classList.add(activeClass);
    return () => document.body.classList.remove(...THREE_PAGE_PRESENTATION_CLASSES);
  }, [location.pathname, location.search]);

  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) {
    return <Navigate to="/equipment-hire" replace />;
  }

  if (isBlockedFinancePath(location.pathname)) {
    return <Navigate to="/equipment-installment-finance" replace />;
  }

  ensureFinanceUiCompatibilityPermissions(user, location.pathname);

  return (
    <>
      <InstallmentMobileEnhancements />
      <BusinessWorkspaceLayout
        workspaceCode="equipment_installment_finance"
        workspaceName="Equipment Installment Finance"
        icon="🏦"
        theme="finance-signature"
        independenceLabel=""
        description=""
        contextHeading="Company-wide Finance portfolio — no Hire-location selection"
        workspaceEyebrow="Current Equipment Business division"
        separationBadge="No access to Hire jobs or contracts"
        navigationSections={navigationSections}
      />
    </>
  );
}
