import BusinessWorkspaceLayout from "../components/BusinessWorkspaceLayout";
import { useAuth } from "../context/AuthContext";

export default function GroupExecutiveLayout() {
  const { workspaceCode } = useAuth();

  const returnPath =
    workspaceCode === "mining"
      ? "/mining"
      : workspaceCode === "equipment_hire"
      ? "/equipment-hire-operations"
      : "/";

  const navigationSections = [
    {
      title: "Group Management",
      items: [
        {
          title: "Executive Intelligence",
          description: "Group performance, cash control, risk and action priorities",
          path: "/group-executive-control",
          icon: "📊",
          end: true,
        },
        {
          title: "Notification Centre",
          description: "Group-wide operational alerts, priorities and escalation evidence",
          path: "/group-executive-control/notifications",
          icon: "🔔",
          permissions: ["notifications.view"],
        },
        {
          title: "Security, Backups & Workforce",
          description: "Read-only group security, backup and worker oversight",
          path: "/group-executive-control/operations",
          icon: "🛡️",
          permissions: ["executive.operations.view"],
        },
        {
          title: "Group Configuration",
          description: "Thresholds, document sequences and controlled platform settings",
          path: "/group-executive-control/configuration",
          icon: "⚙️",
          permissions: ["security.admin"],
        },
        {
          title: "Return to Current Business",
          description: "Go back to the workspace used for this login",
          path: returnPath,
          icon: "↩️",
        },
      ],
    },
  ];

  return (
    <BusinessWorkspaceLayout
      workspaceCode={workspaceCode}
      workspaceName="Group Executive Control"
      icon="📊"
      theme="navy"
      description="Read-only executive intelligence for group finance, operations, cash control, risk and management action without merging business records."
      navigationSections={navigationSections}
    />
  );
}
