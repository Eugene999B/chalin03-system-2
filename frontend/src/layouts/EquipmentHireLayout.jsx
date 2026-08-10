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
    title: "Hire Work",
    items: [
      {
        title: "Hire Overview",
        description: "Contracts, dispatch, revenue, balances and equipment availability",
        path: "/equipment-hire-operations?division=hire",
        icon: "🏗️",
        end: true,
        matchSearch: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Customers",
        description: "Customer contacts, locations and commercial terms",
        path: "/equipment-hire-operations/customers",
        icon: "👥",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Enquiries",
        description: "Customer equipment hire requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "✉️",
        permissions: ["hire.enquiries.view"],
      },
      {
        title: "Equipment Availability",
        description: "Machines ready for hire, assigned, unavailable or reference-locked",
        path: "/equipment-hire-operations/availability",
        icon: "🟢",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Quotations",
        description: "Hire rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "🧾",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Contracts",
        description: "Approved hire jobs and machine assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "🤝",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Rates, Deposits & Amendments",
        description: "Rate cards, contract changes, deposits and damage settlement",
        path: "/equipment-hire-operations/commercial-control",
        icon: "💼",
        permissions: ["hire.commercial.view"],
      },
      {
        title: "Dispatch & Job Cards",
        description: "Mobilization, work logs and billable hours",
        path: "/equipment-hire-operations/operations",
        icon: "🚚",
        anyPermissions: ["hire.dispatch.view", "hire.work_logs.view"],
      },
      {
        title: "Invoices & Payments",
        description: "Billing, receipts, balances and debt",
        path: "/equipment-hire-operations/finance",
        icon: "💰",
        anyPermissions: ["hire.invoices.view", "hire.payments.view"],
      },
      {
        title: "Return Inspections",
        description: "Closing meters, condition and equipment release",
        path: "/equipment-hire-operations/returns",
        icon: "🔍",
        permissions: ["hire.returns.view"],
      },
      {
        title: "Reports",
        description: "Balances, aging and equipment utilisation",
        path: "/equipment-hire-operations/reports",
        icon: "📈",
        permissions: ["hire.reports.view"],
      },
      {
        title: "Notifications",
        description: "Contract, dispatch, overdue invoice and return alerts",
        path: "/equipment-hire-operations/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
      },
    ],
  },
  {
    title: "Equipment Business",
    items: [
      {
        title: "Switch Equipment Division",
        description: "Return to the protected Equipment Business division gateway",
        path: "/equipment-hire",
        icon: "◫",
      },
    ],
  },
  {
    title: "People, Equipment & Reports",
    items: [
      {
        title: "Equipment Register",
        description: "Machine identity, pictures, condition, hire rates and availability",
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
        title: "Documents",
        description: "Quotations, contracts, invoices and operational documents",
        path: "/equipment-hire-operations/documents",
        icon: "📄",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Reports & Audit",
        description: "Search evidence, export reports and review access records",
        path: "/equipment-hire-operations/shared-controls",
        icon: "📚",
        permissions: ["shared.control.view"],
      },
      {
        title: "People & Employment",
        description: "Staff accounts, worker profiles, ID cards, documents and access",
        path: "/equipment-hire-operations/workforce",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Monthly Payroll",
        description: "Review workers and salaries, approve the month, record payments and issue payslips",
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
        title: "Document Signatures",
        description: "Boss signature for approved hire and employment documents",
        path: "/equipment-hire-operations/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Locations & Access",
        description: "Create hire bases, yards, depots and workshops and manage access",
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
        title: "Help & Guide",
        description: "Guide for enquiries, contracts, dispatch, billing and returns",
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
      description="Dedicated Equipment Hire operations for enquiries, quotations, contracts, dispatch, job cards, invoicing and returns. Credit applications, installment accounts, collections and ownership work remain inside Equipment Installment Finance and cannot be opened from this division."
      navigationSections={navigationSections}
    />
  );
}
