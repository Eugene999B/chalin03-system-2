import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
  ensureFinanceUiCompatibilityPermissions,
} from "../security/equipmentDivisionAccess";

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
        title: "Credit Applications & Approval",
        description: "Finance applications, KYC, affordability and independent decisions",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Agreement Activation",
        description: "Activate approved Finance agreements and schedules without Hire crossover",
        path: "/equipment-installment-finance/applications?stage=activation",
        icon: "📄",
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
        icon: "🚜",
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

export default function InstallmentFinanceLayout() {
  const { user } = useAuth();
  const location = useLocation();

  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) {
    return <Navigate to="/equipment-hire" replace />;
  }

  ensureFinanceUiCompatibilityPermissions(user, location.pathname);

  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Installment Finance"
      icon="🏦"
      theme="earth"
      independenceLabel="Independent Finance staff division"
      contextHeading="Finance location reference"
      workspaceEyebrow="Current staff division"
      separationBadge="No access to Hire jobs or contracts"
      description="Dedicated credit applications, agreement activation, installment accounts, collections and ownership work. Hire enquiries, Hire contracts, dispatch, job cards, Hire invoices and returns remain inside Equipment Hire Operations and cannot be opened from this division."
      navigationSections={navigationSections}
    />
  );
}
