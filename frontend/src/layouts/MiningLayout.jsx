import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { MINING_VIEW_PERMISSIONS } from "../security/permissionRules";

const navigationSections = [
  {
    title: "Mining Operations",
    items: [
      {
        title: "Mining Dashboard",
        description: "Production, equipment, fuel, costs and safety overview",
        path: "/mining",
        icon: "⛏️",
        end: true,
        anyPermissions: MINING_VIEW_PERMISSIONS,
      },
      {
        title: "Notification Centre",
        description: "Approvals, safety, fuel, stockpile and closing alerts",
        path: "/mining/notifications",
        icon: "\u{1F514}",
        permissions: ["notifications.view"],
      },
      {
        title: "Mining Sites",
        description: "Administrator-created mining sites",
        path: "/mining/sites",
        icon: "\u{1F4CD}",
        permissions: ["mining.sites.view"],
      },
      {
        title: "Daily Site Logs",
        description: "Shift work, workforce notes and approvals",
        path: "/mining/daily-logs",
        icon: "\u{1F4DD}",
        permissions: ["mining.daily_logs.view"],
      },
      {
        title: "Production",
        description: "Daily material output and results",
        path: "/mining/production",
        icon: "\u{1FAA8}",
        permissions: ["mining.production.view"],
      },
      {
        title: "Mining Control Centre",
        description: "Stockpiles, dispatch, fuel reconciliation, crews and site closing",
        path: "/mining/control-centre",
        icon: "\u{1F3D7}\u{FE0F}",
        anyPermissions: [
          "mining.stockpiles.view",
          "mining.dispatch.view",
          "mining.fuel_control.view",
          "mining.workforce.view",
          "mining.closing.view",
        ],
      },
      {
        title: "Equipment Operations",
        description: "Machine hours, operators and downtime",
        path: "/mining/equipment",
        icon: "\u{1F69C}",
        permissions: ["mining.equipment_logs.view"],
      },
      {
        title: "Fuel Management",
        description: "Fuel receipts, issues and consumption",
        path: "/mining/fuel",
        icon: "\u{26FD}",
        permissions: ["mining.fuel.view"],
      },
      {
        title: "Mining Expenses",
        description: "Site operating expenditure",
        path: "/mining/expenses",
        icon: "\u{1F4B3}",
        permissions: ["mining.expenses.view"],
      },
      {
        title: "Incidents & Safety",
        description: "Safety events, investigation and closure",
        path: "/mining/incidents",
        icon: "\u{1F6E1}\u{FE0F}",
        permissions: ["mining.incidents.view"],
      },
    ],
  },
  {
    title: "Mining Resources",
    items: [
      {
        title: "Fleet & Maintenance",
        description: "Mining equipment, meters and service history",
        path: "/mining/fleet",
        icon: "\u{1F527}",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Reports & Documents",
        description: "Daily reports, management packs, incident PDFs and workbook",
        path: "/mining/documents",
        icon: "\u{1F4CA}",
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
        title: "Mining Workforce",
        description: "Worker profiles, site assignments, licences and expiries",
        path: "/mining/workers",
        icon: "\u{1F477}",
        permissions: ["workers.view"],
      },
      {
        title: "Payroll Processing",
        description: "Validate, approve, pay and reconcile protected salary cycles",
        path: "/mining/payroll",
        icon: "💵",
        permissions: ["payroll.view"],
      },
      {
        title: "Employment & HR Documents",
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
        title: "Document Signature Settings",
        description: "Boss signature for approved employment and HR documents",
        path: "/mining/document-signature-settings",
        icon: "🖋️",
        permissions: ["security.admin"],
      },
      {
        title: "Mining Administration",
        description: "Sites and staff workspace access",
        path: "/mining/administration",
        icon: "\u{2699}\u{FE0F}",
        permissions: ["workspace.admin"],
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Mining Help",
        description: "Guide for the Mining workspace",
        path: "/mining/help",
        icon: "\u{2753}",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/mining/change-password",
        icon: "\u{1F510}",
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
