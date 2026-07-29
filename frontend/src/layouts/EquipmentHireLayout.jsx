import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { HIRE_VIEW_PERMISSIONS } from "../security/permissionRules";

const navigationSections = [
  {
    title: "Equipment Hire Operations",
    items: [
      {
        title: "Hire Operations Dashboard",
        description: "Hire contracts, dispatch, revenue, balances and equipment availability",
        path: "/equipment-hire-operations",
        icon: "🏗️",
        end: true,
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
        description: "Machines ready, assigned, sale-locked or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "🟢",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Quotations",
        description: "Hire rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "🧾",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Hire Contracts",
        description: "Approved customer jobs and machine assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "🤝",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Hire Commercial Control",
        description: "Rate cards, amendments, deposits and damage settlement",
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
        description: "Hire billing, receipts, balances and debt",
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
        title: "Hire Reports",
        description: "Hire balances, aging and equipment utilization",
        path: "/equipment-hire-operations/reports",
        icon: "📈",
        permissions: ["hire.reports.view"],
      },
      {
        title: "Hire Notification Centre",
        description: "Contract, dispatch, overdue finance and return alerts",
        path: "/equipment-hire-operations/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
      },
    ],
  },
  {
    title: "Separate Division",
    items: [
      {
        title: "Open Equipment Installment Finance",
        description: "Switch to sales applications, credit, agreements, collections and ownership",
        path: "/equipment-installment-finance",
        icon: "🏦",
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Shared Equipment Resources",
    items: [
      {
        title: "Equipment Catalogue",
        description: "Shared machine identity, pictures, sale controls and Hire rates",
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
        description: "Boss signature for approved employment and Hire documents",
        path: "/equipment-hire-operations/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Hire Location & Access",
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
        description: "Guide for Hire enquiries, contracts, dispatch, finance and returns",
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
      workspaceName="Equipment Hire Operations"
      icon="🏗️"
      theme="blue"
      independenceLabel="Independent Hire division"
      contextHeading="Hire location context"
      workspaceEyebrow="Current operating division"
      separationBadge="Separated from Installment Finance"
      description="Dedicated equipment Hire operations for enquiries, quotations, contracts, dispatch, work, invoicing and returns. Installment sales, credit and collections operate in their own finance division."
      navigationSections={navigationSections}
    />
  );
}
