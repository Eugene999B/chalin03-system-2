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
        icon: "HD",
        end: true,
        anyPermissions: HIRE_VIEW_PERMISSIONS,
      },
      {
        title: "Customers",
        description: "Hire customers, contacts and credit terms",
        path: "/equipment-hire-operations/customers",
        icon: "CU",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Enquiries",
        description: "Customer equipment requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "EN",
        permissions: ["hire.enquiries.view"],
      },
      {
        title: "Availability",
        description: "Machines ready, assigned or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "AV",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Quotations",
        description: "Rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "QT",
        permissions: ["hire.quotations.view"],
      },
      {
        title: "Hire Contracts",
        description: "Approved customer jobs and assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "CT",
        permissions: ["hire.contracts.view"],
      },
      {
        title: "Dispatch & Job Cards",
        description: "Mobilization, work logs and billable hours",
        path: "/equipment-hire-operations/operations",
        icon: "OP",
        anyPermissions: ["hire.dispatch.view", "hire.work_logs.view"],
      },
      {
        title: "Invoices & Payments",
        description: "Billing, receipts, balances and debt",
        path: "/equipment-hire-operations/finance",
        icon: "FN",
        anyPermissions: ["hire.invoices.view", "hire.payments.view"],
      },
      {
        title: "Return Inspections",
        description: "Closing meters, condition and equipment release",
        path: "/equipment-hire-operations/returns",
        icon: "RT",
        permissions: ["hire.returns.view"],
      },
      {
        title: "Reports",
        description: "Outstanding, aging and Fleet utilization",
        path: "/equipment-hire-operations/reports",
        icon: "RP",
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
        icon: "FT",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Hire Documents",
        description: "Quotations, agreements, invoices and statements",
        path: "/equipment-hire-operations/documents",
        icon: "DC",
        permissions: ["operations.documents.view"],
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
        icon: "AD",
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
        icon: "HP",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/equipment-hire-operations/change-password",
        icon: "PW",
      },
    ],
  },
];

export default function EquipmentHireLayout() {
  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Hire"
      icon="EH"
      theme="blue"
      description="Independent Equipment Hire workspace. Hire bases and yards are administrator-managed. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
