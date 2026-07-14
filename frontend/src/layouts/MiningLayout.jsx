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
        icon: "MO",
        end: true,
        anyPermissions: MINING_VIEW_PERMISSIONS,
      },
      {
        title: "Mining Sites",
        description: "Administrator-created mining sites",
        path: "/mining/sites",
        icon: "MS",
        permissions: ["mining.sites.view"],
      },
      {
        title: "Daily Site Logs",
        description: "Shift work, workforce notes and approvals",
        path: "/mining/daily-logs",
        icon: "DL",
        permissions: ["mining.daily_logs.view"],
      },
      {
        title: "Production",
        description: "Daily material output and results",
        path: "/mining/production",
        icon: "PR",
        permissions: ["mining.production.view"],
      },
      {
        title: "Equipment Operations",
        description: "Machine hours, operators and downtime",
        path: "/mining/equipment",
        icon: "EQ",
        permissions: ["mining.equipment_logs.view"],
      },
      {
        title: "Fuel Management",
        description: "Fuel receipts, issues and consumption",
        path: "/mining/fuel",
        icon: "FL",
        permissions: ["mining.fuel.view"],
      },
      {
        title: "Mining Expenses",
        description: "Site operating expenditure",
        path: "/mining/expenses",
        icon: "EX",
        permissions: ["mining.expenses.view"],
      },
      {
        title: "Incidents & Safety",
        description: "Safety events, investigation and closure",
        path: "/mining/incidents",
        icon: "IN",
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
        icon: "FT",
        permissions: ["fleet.assets.view"],
      },
      {
        title: "Reports & Documents",
        description: "Daily reports, management packs, incident PDFs and workbook",
        path: "/mining/documents",
        icon: "RD",
        permissions: ["operations.documents.view"],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Mining Administration",
        description: "Sites and staff workspace access",
        path: "/mining/administration",
        icon: "AD",
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
        icon: "HP",
      },
      {
        title: "Change Password",
        description: "Update your secure account password",
        path: "/mining/change-password",
        icon: "PW",
      },
    ],
  },
];

export default function MiningLayout() {
  return (
    <BusinessWorkspaceLayout
      workspaceCode="mining"
      workspaceName="Mining Operations"
      icon="MO"
      theme="earth"
      description="Independent Mining workspace. Mining sites are created by an administrator. Spare Parts stores are never used here."
      navigationSections={navigationSections}
    />
  );
}
