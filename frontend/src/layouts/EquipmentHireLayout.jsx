import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { HIRE_VIEW_PERMISSIONS } from "../security/permissionRules";

const navigationSections = [
  {
    title: "Equipment Sales & Hire",
    items: [
      {
        title: "Sales & Hire Dashboard",
        description: "Equipment, contracts, sales, revenue, balances and availability",
        path: "/equipment-hire-operations",
        icon: "🏗️",
        end: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Equipment Catalogue",
        description: "Excavators, pictures, identity, selling prices and Hire rates",
        path: "/equipment-hire-operations/fleet",
        icon: "🚜",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Sales & Installments",
        description: "Enquiries, quotations, agreements, payments, delivery and ownership",
        path: "/equipment-hire-operations/fleet?view=sales",
        icon: "🏷️",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Sales Documents & Reports",
        description: "PDFs, receipts, aging, collections, profit and expected payments",
        path: "/equipment-hire-operations/fleet?view=reports",
        icon: "📊",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
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
        description: "Sales and Hire customers, contacts and credit terms",
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
        description: "Machines ready, assigned, sale-locked or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "🟢",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Quotations",
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
        title: "Hire Invoices & Payments",
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
        description: "Outstanding balances, aging and equipment utilization",
        path: "/equipment-hire-operations/reports",
        icon: "📈",
        permissions: ["hire.reports.view"],
      },
    ],
  },
  {
    title: "Business Resources",
    items: [
      {
        title: "Maintenance Register",
        description: "Meters, fuel, inspections and service history",
        path: "/equipment-hire-operations/fleet?view=maintenance",
        icon: "🔧",
        matchSearch: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Sales & Hire Documents",
        description: "Hire quotations, contracts, invoices and shared operational documents",
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
        title: "Sales & Hire Workforce",
        description: "Worker profiles, location assignments, licences and expiries",
        path: "/equipment-hire-operations/workers",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Employment & HR Documents",
        description: "Prepare new-hire letters before worker registration",
        path: "/equipment-hire-operations/employment-documents",
        icon: "✍️",
        permissions: ["workers.documents.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Document Signature Settings",
        description: "Boss signature for approved employment and business documents",
        path: "/equipment-hire-operations/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Sales & Hire Administration",
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
        title: "Equipment Sales & Hire Help",
        description: "Guide for equipment sales, installments and Hire operations",
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
      workspaceName="Equipment Sales & Hire"
      icon="🏗️"
      theme="blue"
      description="Independent heavy-equipment sales, installment and Hire workspace. Bases and yards are administrator-managed; Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
