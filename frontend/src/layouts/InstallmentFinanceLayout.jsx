import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
  ensureFinanceUiCompatibilityPermissions,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentFinanceLifecycleProfessional.css";

const LEGACY_FINANCE_REDIRECTS = Object.freeze({
  "/equipment-installment-finance/catalogue":
    "/equipment-installment-finance/applications?stage=machines",
  "/equipment-installment-finance/customers":
    "/equipment-installment-finance/applications?stage=customers",
  "/equipment-installment-finance/documents":
    "/equipment-installment-finance/reports",
  "/equipment-installment-finance/shared-controls":
    "/equipment-installment-finance/reports",
  "/equipment-installment-finance/workers":
    "/equipment-installment-finance/workforce",
  "/equipment-installment-finance/employment-documents":
    "/equipment-installment-finance/workforce",
  "/equipment-installment-finance/document-signature-settings":
    "/equipment-installment-finance/applications?stage=settings",
  "/equipment-installment-finance/administration":
    "/equipment-installment-finance/workforce",
});

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
        title: "Task & Approval Inbox",
        description: "Approvals, document checks, failed alerts and urgent case work",
        path: "/equipment-installment-finance/applications?stage=operations&tab=inbox",
        icon: "📥",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Start New Installment",
        description: "Customer → excavator → exact payment dates → draft application",
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
        description: "Draft corrections, KYC, affordability, exact schedules and decisions",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Case Operations",
        description: "Timeline, uploads, alerts, simulations, amendments and receipt sharing",
        path: "/equipment-installment-finance/applications?stage=operations&tab=case",
        icon: "🗂️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Active Installments",
        description: "Open exact schedules and record controlled installment collections",
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
        description: "Issued agreements, receipts, statements, evidence and management reports",
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

function legacyFinanceRedirect(pathname) {
  const exact = LEGACY_FINANCE_REDIRECTS[pathname];
  if (exact) return exact;
  const entry = Object.entries(LEGACY_FINANCE_REDIRECTS).find(([legacyPath]) =>
    pathname.startsWith(`${legacyPath}/`)
  );
  return entry?.[1] || null;
}

export default function InstallmentFinanceLayout() {
  const { user } = useAuth();
  const location = useLocation();

  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) {
    return <Navigate to="/equipment-hire" replace />;
  }

  const redirect = legacyFinanceRedirect(location.pathname);
  if (redirect) {
    return <Navigate to={redirect} replace />;
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
