import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
  ensureFinanceUiCompatibilityPermissions,
} from "../security/equipmentDivisionAccess";

const BLOCKED_FINANCE_PATHS = [
  "/equipment-installment-finance/documents",
  "/equipment-installment-finance/shared-controls",
  "/equipment-installment-finance/workers",
  "/equipment-installment-finance/employment-documents",
  "/equipment-installment-finance/document-signature-settings",
  "/equipment-installment-finance/administration",
];

const navigationSections = [
  {
    title: "Installment Finance",
    items: [
      {
        title: "Finance Command Centre",
        description: "Finance portfolio health, risk, collections and expected cash flow",
        path: "/equipment-installment-finance",
        icon: "🎯",
        end: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Customers & Portfolio",
        description: "Customer identity, KYC, agreements, schedules, receipts and ownership",
        path: "/equipment-installment-finance/applications?stage=customers",
        icon: "👥",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Arrears & Collections Control",
        description: "Due-today work, aging, promises, follow-ups, statements and corrections",
        path: "/equipment-installment-finance/applications?stage=arrears",
        icon: "📞",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Credit Applications & Approval",
        description: "Finance applications, KYC, affordability and independent decisions",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Agreement Activation",
        description: "Create the approved Finance agreement and installment schedule",
        path: "/equipment-installment-finance/applications?stage=activation",
        icon: "📄",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Deposit & Machine Reservation",
        description: "Record the controlled opening deposit and reserve the approved machine",
        path: "/equipment-installment-finance/applications?stage=deposit",
        icon: "🔒",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Installment Collections",
        description: "Record controlled payments, receipts and schedule allocations",
        path: "/equipment-installment-finance/applications?stage=collections",
        icon: "💳",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Delivery Handover",
        description: "Record Finance handover only after the approved payment threshold",
        path: "/equipment-installment-finance/applications?stage=delivery",
        icon: "🚜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Ownership Transfer",
        description: "Transfer ownership only after full payment and controlled delivery",
        path: "/equipment-installment-finance/applications?stage=ownership",
        icon: "📜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Installment Documents & Reports",
        description: "Finance agreements, receipts, aging, collections and expected payments",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Equipment Reference",
        description: "Read-only machine identity and availability reference for Finance work",
        path: "/equipment-installment-finance/catalogue",
        icon: "🔎",
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Division Control",
    items: [
      {
        title: "Back to Equipment Divisions",
        description: "Return to the protected division gateway",
        path: "/equipment-hire",
        icon: "◫",
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Installment Finance Help",
        description: "Guide for credit, approvals, collections and customer protection",
        path: "/equipment-installment-finance/help",
        icon: "❓",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
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
      independenceLabel="Independent Finance staff division"
      contextHeading="Company-wide Finance portfolio"
      workspaceEyebrow="Current staff division"
      separationBadge="No access to Hire jobs or contracts"
      description="Dedicated company-wide Finance customers, credit applications, agreements, arrears evidence, deposits, machine reservations, installment collections, controlled delivery and final ownership transfer. Finance staff do not select Hire locations. Hire enquiries, Hire contracts, dispatch, job cards, Hire invoices, returns, workers and administration remain inside Equipment Hire Operations and cannot be opened from this division."
      navigationSections={navigationSections}
    />
  );
}
