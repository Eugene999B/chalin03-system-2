import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { HIRE_VIEW_PERMISSIONS } from "../security/permissionRules";

const navigationSections = [
  {
    title: "Equipment Hire",
    items: [
      {
        title: "Hire Dashboard",
        description: "Contracts, revenue, balances and availability",
        path: "/equipment-hire-operations",
        icon: "🏗️",
        end: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Notification Centre",
        description: "Commercial approvals, overdue finance and contract alerts",
        path: "/equipment-hire-operations/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
      },
      {
        title: "Customers",
        description: "Hire customers, contacts and credit terms",
        path: "/equipment-hire-operations/customers",
        icon: "👥",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Enquiries",
        description: "Customer equipment requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "✉️",
        permissions: ["hire.enquiries.view"],
      },
      {
        title: "Availability",
        description: "Machines ready, assigned or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "🟢",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Quotations",
        description: "Rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "🧾",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Hire Contracts",
        description: "Approved customer jobs and assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "🤝",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Commercial Control",
        description: "Rate cards, multi-item quotes, amendments, deposits and damage settlement",
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
        description: "Outstanding, aging and Fleet utilization",
        path: "/equipment-hire-operations/reports",
        icon: "📊",
        permissions: ["hire.reports.view"],
      },
    ],
  },
  {
    title: "Hire Resources",
    items: [
      {
        title: "Fleet & Maintenance",
        description: "Hire equipment, meters and service history",
        path: "/equipment-hire-operations/fleet",
        icon: "🔧",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Documents",
        description: "Quotations, agreements, invoices and statements",
        path: "/equipment-hire-operations/documents",
        icon: "📄",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Shared Reports & Audit",
        description: "Search documents, export reports and review access evidence",
        path: "/equipment-hire-operations/shared-controls",
        icon: "📚",
        permissions: ["shared.control.view"],
      },
      {
        title: "Hire Workforce",
        description: "Worker profiles, location assignments, licences and expiries",
        path: "/equipment-hire-operations/workers",
        icon: "👷",
        permissions: ["workers.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Hire Administration",
        description: "Bases, yards and staff workspace access",
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
        description: "Guide for the Equipment Hire workspace",
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
  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Hire"
      icon="🏗️"
      theme="blue"
      description="Independent Equipment Hire workspace. Hire bases and yards are administrator-managed. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
