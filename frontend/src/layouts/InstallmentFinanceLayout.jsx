import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";

const navigationSections = [
  {
    title: "Installment Finance",
    items: [
      {
        title: "Finance Command Centre",
        description: "Portfolio health, risk, collections queue and expected cash flow",
        path: "/equipment-installment-finance",
        icon: "🎯",
        end: true,
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Applications & Agreements",
        description: "Enquiries, quotations, approvals, agreements, payments and ownership",
        path: "/equipment-installment-finance/applications",
        icon: "📝",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Customers",
        description: "Shared customer identities, contacts and credit information",
        path: "/equipment-installment-finance/customers",
        icon: "👤",
        permissions: ["hire.customers.view"],
      },
      {
        title: "Installment Documents & Reports",
        description: "Agreements, receipts, aging, collections, profit and expected payments",
        path: "/equipment-installment-finance/reports",
        icon: "📊",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Equipment Catalogue",
        description: "Saleable machines, identity, pictures, prices and availability safeguards",
        path: "/equipment-installment-finance/catalogue",
        icon: "🚜",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Finance Notifications",
        description: "Approval, payment, overdue, delivery and ownership alerts",
        path: "/equipment-installment-finance/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
      },
    ],
  },
  {
    title: "Finance Resources",
    items: [
      {
        title: "Finance Documents",
        description: "Installment documents and shared accounting evidence",
        path: "/equipment-installment-finance/documents",
        icon: "📄",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Shared Reports & Audit",
        description: "Search evidence, export reports and review protected access records",
        path: "/equipment-installment-finance/shared-controls",
        icon: "📚",
        permissions: ["shared.control.view"],
      },
      {
        title: "Finance Workforce",
        description: "Staff profiles, location assignments, licences and expiries",
        path: "/equipment-installment-finance/workers",
        icon: "👔",
        permissions: ["workers.view"],
      },
      {
        title: "Employment & HR Documents",
        description: "Prepare approved staff letters before worker registration",
        path: "/equipment-installment-finance/employment-documents",
        icon: "✍️",
        permissions: ["workers.documents.view"],
      },
    ],
  },
  {
    title: "Separate Division",
    items: [
      {
        title: "Open Equipment Hire Operations",
        description: "Switch to Hire enquiries, contracts, dispatch, invoices and returns",
        path: "/equipment-hire-operations",
        icon: "🏗️",
        permissions: ["fleet.assets.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Document Signature Settings",
        description: "Boss signature for approved finance and employment documents",
        path: "/equipment-installment-finance/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Finance Location & Access",
        description: "Shared equipment locations and staff workspace assignments",
        path: "/equipment-installment-finance/administration",
        icon: "⚙️",
        permissions: ["workspace.admin"],
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Installment Finance Help",
        description: "Guide for applications, agreements, collections and customer protection",
        path: "/equipment-installment-finance/help",
        icon: "❓",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/equipment-installment-finance/change-password",
        icon: "🔐",
      },
    ],
  },
];

export default function InstallmentFinanceLayout() {
  return (
    <BusinessWorkspaceLayout
      workspaceCode="equipment_hire"
      workspaceName="Equipment Installment Finance"
      icon="🏦"
      theme="earth"
      independenceLabel="Independent finance division"
      contextHeading="Finance location context"
      workspaceEyebrow="Current finance division"
      separationBadge="Separated from Equipment Hire operations"
      description="Dedicated equipment sales, credit, installment, collections and ownership division. It shares authorised customers, machines and locations with Equipment Hire without mixing Hire contracts or operational records."
      navigationSections={navigationSections}
    />
  );
}
