import { Navigate, useLocation } from "react-router";
import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";
import { HIRE_VIEW_PERMISSIONS } from "../security/permissionRules";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
} from "../security/equipmentDivisionAccess";

const navigationSections = [
  {
    title: "Equipment Hire Operations",
    items: [
      {
        title: "Hire Operations Dashboard",
        description: "Hire contracts, dispatch, revenue, balances and equipment availability",
        path: "/equipment-hire-operations?division=hire",
        icon: "🏗️",
        end: true,
        matchSearch: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Hire Customers",
        description: "Hire customer contacts, locations and commercial terms",
        path: "/equipment-hire-operations/customers",
        icon: "👥",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Hire Enquiries",
        description: "Customer equipment Hire requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "✉️",
        permissions: ["hire.enquiries.view"],
      },
      {
        title: "Hire Availability",
        description: "Machines ready for Hire, assigned, unavailable or reference-locked",
        path: "/equipment-hire-operations/availability",
        icon: "🟢",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Quotations",
        description: "Hire rates, mobilization and Hire commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "🧾",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Hire Contracts",
        description: "Approved Hire jobs and machine assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "🤝",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Hire Commercial Control",
        description: "Hire rate cards, amendments, deposits and damage settlement",
        path: "/equipment-hire-operations/commercial-control",
        icon: "💼",
        permissions: ["hire.commercial.view"],
      },
      {
        title: "Dispatch & Job Cards",
        description: "Hire mobilization, work logs and billable hours",
        path: "/equipment-hire-operations/operations",
        icon: "🚚",
        anyPermissions: ["hire.dispatch.view", "hire.work_logs.view"],
      },
      {
        title: "Hire Invoices & Payments",
        description: "Hire billing, receipts, balances and debt",
        path: "/equipment-hire-operations/finance",
        icon: "💰",
        anyPermissions: ["hire.invoices.view", "hire.payments.view"],
      },
      {
        title: "Return Inspections",
        description: "Hire closing meters, condition and equipment release",
        path: "/equipment-hire-operations/returns",
        icon: "🔍",
        permissions: ["hire.returns.view"],
      },
      {
        title: "Hire Reports",
        description: "Hire balances, aging and equipment utilisation",
        path: "/equipment-hire-operations/reports",
        icon: "📈",
        permissions: ["hire.reports.view"],
      },
      {
        title: "Hire Notification Centre",
        description: "Hire contract, dispatch, overdue invoice and return alerts",
        path: "/equipment-hire-operations/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
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
    title: "Hire Resources",
    items: [
      {
        title: "Hire Equipment Register",
        description: "Machine identity, pictures, condition, Hire rates and availability",
        path: "/equipment-hire-operations/fleet",
        icon: "🚜",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Maintenance Register",
        description: "Meters, fuel, inspections and service history",
        path: "/equipment-hire-operations/fleet?view=maintenance",
        icon: "🔧",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Documents",
        description: "Hire quotations, contracts, invoices and operational documents",
        path: "/equipment-hire-operations/documents",
        icon: "📄",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Hire Reports & Audit",
        description: "Search Hire evidence, export Hire reports and review access records",
        path: "/equipment-hire-operations/shared-controls",
        icon: "📚",
        permissions: ["shared.control.view"],
      },
      {
        title: "Staff & Workforce",
        description: "Staff logins, roles, profiles, ID cards, documents and permission overrides",
        path: "/equipment-hire-operations/workforce",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Payroll Processing",
        description: "Validate, approve, pay and reconcile protected salary cycles",
        path: "/equipment-hire-operations/payroll",
        icon: "💵",
        permissions: ["payroll.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Document Signature Settings",
        description: "Boss signature for approved Hire and employment documents",
        path: "/equipment-hire-operations/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Hire Locations",
        description: "Create Equipment Hire bases, yards, depots and workshops",
        path: "/equipment-hire-operations/administration",
        icon: "⚙️",
        permissions: ["workspace.admin"],
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Equipment Hire Help",
        description: "Guide for Hire enquiries, contracts, dispatch, billing and returns",
        path: "/equipment-hire-operations/help",
        icon: "❓",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/equipment-hire-operations/change-password",
        icon: "🔐",
      },
    ],
  },
];

export default function EquipmentHireLayout() {
  const location = useLocation();
  const { user } = useAuth();
  const isHireEntry =
    new URLSearchParams(location.search).get("division") === "hire";

  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.HIRE)) {
    return <Navigate to="/equipment-hire" replace />;
  }

  if (location.pathname === "/equipment-hire-operations" && !isHireEntry) {
    return <Navigate to="/equipment-hire" replace />;
  }

  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Hire Operations"
      icon="🏗️"
      theme="blue"
      independenceLabel="Independent Hire staff division"
      contextHeading="Hire location context"
      workspaceEyebrow="Current staff division"
      separationBadge="No access to Finance applications or accounts"
      description="Dedicated Equipment Hire operations for enquiries, Hire quotations, Hire contracts, dispatch, job cards, Hire invoicing and returns. Credit applications, installment accounts, collections and ownership work remain inside Equipment Installment Finance and cannot be opened from this division."
      navigationSections={navigationSections}
    />
  );
}