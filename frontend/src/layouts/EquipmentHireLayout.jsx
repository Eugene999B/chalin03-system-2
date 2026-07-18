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
        icon: "\u{1F3D7}\u{FE0F}",
        end: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Notification Centre",
        description: "Commercial approvals, overdue finance and contract alerts",
        path: "/equipment-hire-operations/notifications",
        icon: "\u{1F514}",
        permissions: ["notifications.view"],
      },
      {
        title: "Customers",
        description: "Hire customers, contacts and credit terms",
        path: "/equipment-hire-operations/customers",
        icon: "\u{1F465}",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Enquiries",
        description: "Customer equipment requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "\u{2709}\u{FE0F}",
        permissions: ["hire.enquiries.view"],
      },
      {
        title: "Availability",
        description: "Machines ready, assigned or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "\u{1F7E2}",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Quotations",
        description: "Rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "\u{1F9FE}",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Hire Contracts",
        description: "Approved customer jobs and assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "\u{1F91D}",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Commercial Control",
        description: "Rate cards, multi-item quotes, amendments, deposits and damage settlement",
        path: "/equipment-hire-operations/commercial-control",
        icon: "\u{1F4BC}",
        permissions: ["hire.commercial.view"],
      },
      {
        title: "Dispatch & Job Cards",
        description: "Mobilization, work logs and billable hours",
        path: "/equipment-hire-operations/operations",
        icon: "\u{1F69A}",
        anyPermissions: ["hire.dispatch.view", "hire.work_logs.view"],
      },
      {
        title: "Invoices & Payments",
        description: "Billing, receipts, balances and debt",
        path: "/equipment-hire-operations/finance",
        icon: "\u{1F4B0}",
        anyPermissions: ["hire.invoices.view", "hire.payments.view"],
      },
      {
        title: "Return Inspections",
        description: "Closing meters, condition and equipment release",
        path: "/equipment-hire-operations/returns",
        icon: "\u{1F50D}",
        permissions: ["hire.returns.view"],
      },
      {
        title: "Reports",
        description: "Outstanding, aging and Fleet utilization",
        path: "/equipment-hire-operations/reports",
        icon: "\u{1F4CA}",
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
        icon: "\u{1F527}",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Documents",
        description: "Quotations, agreements, invoices and statements",
        path: "/equipment-hire-operations/documents",
        icon: "\u{1F4C4}",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Hire Workforce",
        description: "Worker profiles, location assignments, licences and expiries",
        path: "/equipment-hire-operations/workers",
        icon: "\u{1F477}",
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
        icon: "\u{2699}\u{FE0F}",
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
        icon: "\u{2753}",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/equipment-hire-operations/change-password",
        icon: "\u{1F510}",
      },
    ],
  },
];

export default function EquipmentHireLayout() {
  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Hire"
      icon="\u{1F3D7}\u{FE0F}"
      theme="blue"
      description="Independent Equipment Hire workspace. Hire bases and yards are administrator-managed. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
