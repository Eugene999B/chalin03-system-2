import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "../context/AuthContext";
import EquipmentCataloguePage from "./EquipmentCataloguePage";
import SharedFleetAssetsPage from "./SharedFleetAssetsPage";

export default function FleetAssetsPage() {
  const { isEquipmentHireWorkspace } = useAuth();
  const [searchParams] = useSearchParams();

  if (!isEquipmentHireWorkspace) {
    return <SharedFleetAssetsPage />;
  }

  const view = searchParams.get("view");

  if (view === "installments") {
    return <Navigate to="/equipment-installment-finance" replace />;
  }

  if (view === "sales") {
    return <Navigate to="/equipment-installment-finance/applications" replace />;
  }

  if (view === "reports") {
    return <Navigate to="/equipment-installment-finance/reports" replace />;
  }

  if (view === "maintenance") {
    return <SharedFleetAssetsPage />;
  }

  return <EquipmentCataloguePage />;
}
