import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { MINING_VIEW_PERMISSIONS } from "../security/permissionRules";

const navigationSections = [
  {
    title: "Mining Operations",
    items: [
      {
        title: "Mining Overview",
        description: "Production, equipment, fuel, costs and safety overview",
        path: "/mining",
        icon: "⛏️",
        end: true,
        anyPermissions: MINING_VIEW_PERMISSIONS,
      },
      {
        title: "Notifications",
        description: "Approvals, safety, fuel, stockpile and closing alerts",
        path: "/mining/notifications",
        icon: "🔔",
        permissions: ["notifications.view"],
      },
      {
        title: "Mining Sites",
        description: "Administrator-created mining sites",
        path: "/mining/sites",
        icon: "📍",
        permissions: ["mining.sites.view"],
      },
      {
        title: "Daily Site Logs",
        description: "Shift work, workforce notes and approvals",
        path: "/mining/daily-logs",
        icon: "📝",
        permissions: ["mining.daily_logs.view"],
      },
      {
        title: "Production",
        description: "Daily material output and results",
        path: "/mining/production",
        icon: "🪨",
        permissions: ["mining.production.view"],
      },
      {
        title: "Site Control",
        description: "Stockpiles, dispatch, fuel reconciliation, crews and site closing",
        path: "/mining/control-centre",
        icon: "🏗️",
        anyPermissions: [
          "mining.stockpiles.view",
          "mining.dispatch.view",
          "mining.fuel_control.view",
          "mining.workforce.view",
          "mining.closing.view",
        ],
      },
      {
        title: "Equipment & Downtime",
        description: "Machine hours, operators and downtime",
        path: "/mining/equipment",
        icon: "🚜",
        permissions: ["mining.equipment_logs.view"],
      },
      {
        title: "Fuel",
        description: "Fuel receipts, issues and consumption",
        path: "/mining/fuel",
        icon: "⛽",
        permissions: ["mining.fuel.view"],
      },
      {
        title: "Expenses",
        description: "Site operating expenditure",
        path: "/mining/expenses",
        icon: "💳",
        permissions: ["mining.expenses.view"],
      },
      {
        title: "Incidents & Safety",
        description: "Safety events, investigation and closure",
        path: "/mining/incidents",
        icon: "🛡️",
        permissions: ["mining.incidents.view"],
      },
    ],
  },
  {
    title: "People, Fleet & Reports",
    items: [
      {
        title: "Fleet & Maintenance",
        description: "Mining equipment, meters and service history",
        path: "/mining/fleet",
        icon: "🔧",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Reports & Documents",
        description: "Daily reports, management packs, incident PDFs and workbook",
        path: "/mining/documents",
        icon: "📊",
        permissions: ["operations.documents.view"],
      },
      {
        title: "Shared Reports & Audit",
        description: "Search documents, export reports and review access evidence",
        path: "/mining/shared-controls",
        icon: "📚",
        permissions: ["shared.control.view"],
      },
      {
        title: "People & Employment",
        description: "Worker profiles, site assignments, licences and expiries",
        path: "/mining/workers",
        icon: "👷",
        permissions: ["workers.view"],
      },
      {
        title: "Monthly Payroll",
        description: "Review workers and salaries, approve the month, record payments and issue payslips",
        path: "/mining/payroll",
        icon: "💵",
        permissions: ["payroll.view"],
      },
      {
        title: "Employment Documents",
        description: "Prepare new-hire letters before worker registration",
        path: "/mining/employment-documents",
        icon: "✍️",
        permissions: ["workers.documents.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Document Signatures",
        description: "Boss signature for approved employment and HR documents",
        path: "/mining/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Sites & Access",
        description: "Sites and staff workspace access",
        path: "/mining/administration",
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
        description: "Guide for the Mining workspace",
        path: "/mining/help",
        icon: "❓",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/mining/change-password",
        icon: "🔐",
      },
    ],
  },
];

export default function MiningLayout() {
  return (
    <BusinessWorkspaceLayout
      workspaceCode="mining"
      workspaceName="Mining Operations"
      icon="⛏️"
      theme="earth"
      description="Independent Mining workspace. Mining sites are created by an administrator. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
