import { useLocation } from "react-router";
import EquipmentFinanceMinimalWorkflowPage from "./EquipmentFinanceMinimalWorkflowPage";
import EquipmentInstallmentCommandAdvancedPage from "./EquipmentInstallmentCommandAdvancedPage";

export default function EquipmentInstallmentCommandPage() {
  const location = useLocation();
  const advanced = new URLSearchParams(location.search).get("view") === "advanced";

  return advanced ? (
    <EquipmentInstallmentCommandAdvancedPage />
  ) : (
    <EquipmentFinanceMinimalWorkflowPage />
  );
}
