import BusinessPortalShell from "../components/BusinessPortalShell";
import { useAuth } from "../context/AuthContext";
import { getBusinessWorkspace } from "../data/businessWorkspaces";
import EquipmentDivisionGatewayPage from "./EquipmentDivisionGatewayPage";

export default function EquipmentHirePortalPage() {
  const { isLoggedIn, workspaceCode } = useAuth();
  const workspace = getBusinessWorkspace("equipment_hire");

  if (isLoggedIn && workspaceCode === "equipment_hire") {
    return <EquipmentDivisionGatewayPage />;
  }

  return <BusinessPortalShell workspace={workspace} />;
}
