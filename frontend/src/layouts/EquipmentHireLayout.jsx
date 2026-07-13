import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";

const navigationSections = [
  {
    title: "Equipment Hire",
    items: [
      {
        title: "Hire Dashboard",
        description: "Contracts, revenue, balances and availability",
        path: "/equipment-hire-operations",
        icon: "📊",
        end: true,
      },
      {
        title: "Customers",
        description: "Hire customers, contacts and credit terms",
        path: "/equipment-hire-operations/customers",
        icon: "👥",
      },
      {
        title: "Enquiries",
        description: "Customer equipment requests",
        path: "/equipment-hire-operations/enquiries",
        icon: "📨",
      },
      {
        title: "Availability",
        description: "Machines ready, assigned or unavailable",
        path: "/equipment-hire-operations/availability",
        icon: "📅",
      },
      {
        title: "Quotations",
        description: "Rates, mobilization and commercial terms",
        path: "/equipment-hire-operations/quotations",
        icon: "📝",
      },
      {
        title: "Hire Contracts",
        description: "Approved customer jobs and assignments",
        path: "/equipment-hire-operations/contracts",
        icon: "🤝",
      },
      {
        title: "Dispatch & Job Cards",
        description: "Mobilization, work logs and billable hours",
        path: "/equipment-hire-operations/operations",
        icon: "🚚",
      },
      {
        title: "Invoices & Payments",
        description: "Billing, receipts, balances and debt",
        path: "/equipment-hire-operations/finance",
        icon: "💳",
      },
      {
        title: "Return Inspections",
        description: "Closing meters, condition and equipment release",
        path: "/equipment-hire-operations/returns",
        icon: "🔍",
      },
      {
        title: "Reports",
        description: "Outstanding, aging and Fleet utilization",
        path: "/equipment-hire-operations/reports",
        icon: "📈",
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
        icon: "🛠️",
      },
      {
        title: "Hire Documents",
        description: "Quotations, agreements, invoices and statements",
        path: "/equipment-hire-operations/documents",
        icon: "📑",
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
        roles: ["admin"],
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
        icon: "📘",
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
      icon="🚜"
      theme="blue"
      description="Independent Equipment Hire workspace. Hire bases and yards will be administrator-managed. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
