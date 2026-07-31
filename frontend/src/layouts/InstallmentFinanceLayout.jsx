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
  "/equipment-installment-finance/workers",
  "/equipment-installment-finance/employment-documents",
  "/equipment-installment-finance/document-signature-settings",
  "/equipment-installment-finance/administration",
];

const navigationSections = [
  {
    title: "Installment Finance Command",
    items: [
      {
        title: "Finance Command Centre",
        description: "Portfolio health, approvals, collections, arrears and ownership readiness",
        path: "/equipment-installment-finance",
        icon: "🎯",
        end: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Excavator Register",
        description: "Register exact machines, legal identity, pricing and uncropped photo evidence",
        path: "/equipment-installment-finance/applications?stage=machines",
        icon: "🚜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Equipment Reference",
        description: "Read-only machine identity and availability reference for Finance work",
        path: "/equipment-installment-finance/catalogue",
        icon: "🔎",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Customers & Portfolio",
        description: "Buyer identity, KYC, agreements, schedules, receipts and complete account file",
        path: "/equipment-installment-finance/applications?stage=customers",
        icon: "👥",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Credit Applications & Approval",
        description: "Finance applications, KYC, affordability and independent decisions for the selected excavator",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Agreement Activation",
        description: "Create the approved agreement and exact dated installment schedule",
        path: "/equipment-installment-finance/applications?stage=activation",
        icon: "✅",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Agreement Documents",
        description: "Capture signatures and issue professional PDF and Word agreement packs",
        path: "/equipment-installment-finance/applications?stage=documents",
        icon: "📄",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Deposit & Reservation",
        description: "Deposit & Machine Reservation with controlled opening-payment evidence",
        path: "/equipment-installment-finance/applications?stage=deposit",
        icon: "🔒",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Collections & Customer Control",
    items: [
      {
        title: "Installment Collections",
        description: "Record partial, exact or above-period payments with schedule allocation and boss alert",
        path: "/equipment-installment-finance/applications?stage=collections",
        icon: "💳",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Arrears & Follow-up",
        description: "Arrears & Collections Control for due-today work, aging, reminders, promises and statements",
        path: "/equipment-installment-finance/applications?stage=arrears",
        icon: "📞",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Rescheduling, Waivers & Recovery",
        description: "Rescheduling, Default & Recovery with independent approvals and lawful evidence",
        path: "/equipment-installment-finance/applications?stage=governance",
        icon: "🛡️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Delivery & Handover",
        description: "Record machine condition, meter, tools, photos and signatures after payment threshold",
        path: "/equipment-installment-finance/applications?stage=delivery",
        icon: "🧾",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Ownership Transfer",
        description: "Complete title transfer only after full settlement and controlled delivery",
        path: "/equipment-installment-finance/applications?stage=ownership",
        icon: "📜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Management & Configuration",
    items: [
      {
        title: "Finance Documents & Reports",
        description: "Installment Documents & Reports for agreements, payment evidence, statements and aging",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Settings",
        description: "Deposit, schedules, grace, reminders, boss alerts, delivery and legal terms",
        path: "/equipment-installment-finance/applications?stage=settings",
        icon: "⚙️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Equipment Staff",
        description: "Manage Division Staff with Hire-only, Finance-only and approved dual-business roles",
        path: "/equipment-installment-finance/applications?stage=staff",
        icon: "🧑🏾‍💼",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
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
        title: "Installment Finance Help",
        description: "Guide for machine registration, approvals, payments, documents and customer protection",
        path: "/equipment-installment-finance/help",
        icon: "❓",
      },
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
      independenceLabel="Independent Finance staff division"
      contextHeading="Company-wide installment portfolio — Finance staff do not select Hire locations"
      workspaceEyebrow="Current Equipment Business division"
      separationBadge="No access to Hire jobs or contracts"
      description="A complete excavator installment lifecycle: exact-machine registration and photos, buyer KYC and affordability, independent approval, agreement and schedule generation, signatures and Word/PDF documents, deposits, reservations, partial and excess-period payment allocation, boss payment alerts, reminders, arrears and rescheduling, delivery evidence, settlement and ownership transfer. Approved dual Equipment Business roles may open both Hire and Finance from one login, while every action remains permission-controlled and audit recorded."
      navigationSections={navigationSections}
    />
  );
}
