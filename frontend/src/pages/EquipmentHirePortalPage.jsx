import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import EquipmentDivisionGatewayPage from "./EquipmentDivisionGatewayPage";

export default function EquipmentHirePortalPage() {
  const { isLoggedIn, workspaceCode } = useAuth();

  if (!isLoggedIn || workspaceCode !== "equipment_hire") {
    return <Navigate to="/login?workspace=equipment_hire" replace />;
  }

  return <EquipmentDivisionGatewayPage />;
}
