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
    title: "Daily Installment Work",
    items: [
      {
        title: "Finance Home",
        description: "Portfolio health, work requiring attention and quick actions",
        path: "/equipment-installment-finance",
        icon: "🏠",
        end: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Start New Installment",
        description: "Customer → excavator → payment plan → KYC → draft application",
        path: "/equipment-installment-finance/applications?stage=start",
        icon: "➕",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
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
        description: "One register for identity, pricing, complete photos and availability",
        path: "/equipment-installment-finance/applications?stage=machines",
        icon: "🚜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Applications & Approvals",
        description: "Draft completion, KYC verification, affordability and manager decisions",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Active Installments",
        description: "Open approved accounts, schedules and installment collections",
        path: "/equipment-installment-finance/applications?stage=collections",
        icon: "💳",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Payments & Arrears",
        description: "Due, overdue, reminders, promises, follow-up and customer statements",
        path: "/equipment-installment-finance/applications?stage=arrears",
        icon: "📞",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Documents & Management",
    items: [
      {
        title: "Documents & Reports",
        description: "Agreements, receipts, statements, payment evidence and management reports",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Staff & Workforce",
        description: "Staff logins, roles, profiles, ID cards, documents and permission overrides",
        path: "/equipment-installment-finance/workforce",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Finance Settings",
        description: "Payment rules, reminders, boss alerts, delivery and legal agreement terms",
        path: "/equipment-installment-finance/applications?stage=settings",
        icon: "⚙️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Help & Guide",
        description: "Beginner guide for starting, approving and running an installment account",
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