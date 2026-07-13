import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";

const navigationSections = [
  {
    title: "Mining Operations",
    items: [
      {
        title: "Mining Dashboard",
        description: "Production, equipment, fuel, costs and safety overview",
        path: "/mining",
        icon: "📊",
        end: true,
      },
      {
        title: "Mining Sites",
        description: "Administrator-created mining sites",
        path: "/mining/sites",
        icon: "📍",
      },
      {
        title: "Daily Site Logs",
        description: "Shift work, workforce notes and approvals",
        path: "/mining/daily-logs",
        icon: "📋",
      },
      {
        title: "Production",
        description: "Daily material output and results",
        path: "/mining/production",
        icon: "⛏️",
      },
      {
        title: "Equipment Operations",
        description: "Machine hours, operators and downtime",
        path: "/mining/equipment",
        icon: "🚜",
      },
      {
        title: "Fuel Management",
        description: "Fuel receipts, issues and consumption",
        path: "/mining/fuel",
        icon: "⛽",
      },
      {
        title: "Mining Expenses",
        description: "Site operating expenditure",
        path: "/mining/expenses",
        icon: "💳",
      },
      {
        title: "Incidents & Safety",
        description: "Safety events, investigation and closure",
        path: "/mining/incidents",
        icon: "🦺",
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
        icon: "🛠️",
      },
      {
        title: "Reports & Documents",
        description: "Daily reports, management packs, incident PDFs and workbook",
        path: "/mining/documents",
        icon: "📑",
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
        icon: "⚙️",
        roles: ["admin"],
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
        icon: "📘",
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
