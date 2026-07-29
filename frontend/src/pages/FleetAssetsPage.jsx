import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
} from "../security/equipmentDivisionAccess";
import EquipmentCataloguePage from "./EquipmentCataloguePage";
import SharedFleetAssetsPage from "./SharedFleetAssetsPage";

export default function FleetAssetsPage() {
  const { isEquipmentHireWorkspace, user } = useAuth();
  const [searchParams] = useSearchParams();

  if (!isEquipmentHireWorkspace) {
    return <SharedFleetAssetsPage />;
  }

  const view = searchParams.get("view");
  const financeAccess = canAccessEquipmentDivision(
    user,
    EQUIPMENT_DIVISIONS.FINANCE
  );

  if (["installments", "sales", "reports"].includes(view)) {
    if (!financeAccess) {
      return <Navigate to="/equipment-hire" replace />;
    }
    if (view === "reports") {
      return <Navigate to="/equipment-installment-finance/reports" replace />;
    }
    return <Navigate to="/equipment-installment-finance" replace />;
  }

  if (view === "maintenance") {
    return <SharedFleetAssetsPage />;
  }

  return <EquipmentCataloguePage />;
}
