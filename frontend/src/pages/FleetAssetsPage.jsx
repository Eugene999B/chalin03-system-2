import { useAuth } from "../context/AuthContext";
import EquipmentCataloguePage from "./EquipmentCataloguePage";
import SharedFleetAssetsPage from "./SharedFleetAssetsPage";

export default function FleetAssetsPage() {
  const { isEquipmentHireWorkspace } = useAuth();

  return isEquipmentHireWorkspace ? (
    <EquipmentCataloguePage />
  ) : (
    <SharedFleetAssetsPage />
  );
}
