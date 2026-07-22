import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import EquipmentCataloguePage from "./EquipmentCataloguePage";
import EquipmentSalesWorkspacePage from "./EquipmentSalesWorkspacePage";
import SharedFleetAssetsPage from "./SharedFleetAssetsPage";

export default function FleetAssetsPage() {
  const { isEquipmentHireWorkspace } = useAuth();
  const [searchParams] = useSearchParams();

  if (!isEquipmentHireWorkspace) {
    return <SharedFleetAssetsPage />;
  }

  return searchParams.get("view") === "sales" ? (
    <EquipmentSalesWorkspacePage />
  ) : (
    <EquipmentCataloguePage />
  );
}
