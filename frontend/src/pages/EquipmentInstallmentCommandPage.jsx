import { useLocation } from "react-router";
import EquipmentFinanceCompletionHomePage from "./EquipmentFinanceCompletionHomePage";
import EquipmentInstallmentCommandAdvancedPage from "./EquipmentInstallmentCommandAdvancedPage";

export default function EquipmentInstallmentCommandPage() {
  const location = useLocation();
  const advanced = new URLSearchParams(location.search).get("view") === "advanced";

  return advanced ? (
    <EquipmentInstallmentCommandAdvancedPage />
  ) : (
    <EquipmentFinanceCompletionHomePage />
  );
}
