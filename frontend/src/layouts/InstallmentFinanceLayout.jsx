import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
  ensureFinanceUiCompatibilityPermissions,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentFinanceLifecycleProfessional.css";

const BLOCKED_FINANCE_PATHS = [
  "/equipment-installment-finance/shared-controls",
  "/equipment-installment-finance/document-signature-settings",
  "/equipment-installment-finance/administration",
];

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
      {
        title: "Active Installments",
        description: "Open customer accounts, schedules, balances and payment histories",
        path: "/equipment-installment-finance/applications?stage=collections",
        icon: "💳",
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
        title: "Staff & Workforce",
        description: "Finance staff logins, roles, profiles, documents and permissions",
        path: "/equipment-installment-finance/workforce",
        icon: "👷",
        permissions: ["workers.view"],
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

  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) {
    return <Navigate to="/equipment-hire" replace />;
  }

  if (isBlockedFinancePath(location.pathname)) {
    return <Navigate to="/equipment-installment-finance" replace />;
  }

  ensureFinanceUiCompatibilityPermissions(user, location.pathname);

  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_installment_finance"
      workspaceName="Equipment Installment Finance"
      icon="🏦"
      theme="earth"
      independenceLabel=""
      description=""
      contextHeading="Company-wide Finance portfolio — no Hire-location selection"
      workspaceEyebrow="Current Equipment Business division"
      separationBadge="No access to Hire jobs or contracts"
      navigationSections={navigationSections}
    />
  );
}
