import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import EquipmentCataloguePage from "./EquipmentCataloguePage";
import EquipmentSalesReportsPage from "./EquipmentSalesReportsPage";
import EquipmentSalesWorkspacePage from "./EquipmentSalesWorkspacePage";
import SharedFleetAssetsPage from "./SharedFleetAssetsPage";

export default function FleetAssetsPage() {
  const { isEquipmentHireWorkspace } = useAuth();
  const [searchParams] = useSearchParams();

  if (!isEquipmentHireWorkspace) {
    return <SharedFleetAssetsPage />;
  }

  const view = searchParams.get("view");

  if (view === "sales") {
    return <EquipmentSalesWorkspacePage />;
  }

  if (view === "reports") {
    return <EquipmentSalesReportsPage />;
  }

  if (view === "maintenance") {
    return <SharedFleetAssetsPage />;
  }

  return <EquipmentCataloguePage />;
}
