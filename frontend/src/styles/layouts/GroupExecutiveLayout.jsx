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
          title: "Executive Control",
          description: "Spare Parts, Mining, Hire and Fleet overview",
          path: "/group-executive-control",
          icon: "🏢",
          end: true,
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
      icon="🏢"
      theme="navy"
      description="This cross-business management area summarizes the independent Chalin 03 businesses without merging their operational records."
      navigationSections={navigationSections}
    />
  );
}
