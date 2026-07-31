import { useAuth } from "../context/AuthContext";
import EquipmentBusinessLandingPage from "./EquipmentBusinessLandingPage";
import EquipmentDivisionGatewayPage from "./EquipmentDivisionGatewayPage";

export default function EquipmentHirePortalPage() {
  const { isLoggedIn, workspaceCode } = useAuth();

  if (isLoggedIn && workspaceCode === "equipment_hire") {
    return <EquipmentDivisionGatewayPage />;
  }

  return <EquipmentBusinessLandingPage />;
}
