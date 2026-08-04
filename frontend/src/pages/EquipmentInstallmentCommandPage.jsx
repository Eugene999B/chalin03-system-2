import { useLocation } from "react-router";
import EquipmentFinanceCompletionHomePage from "./EquipmentFinanceCompletionHomePage";
import EquipmentFinanceMinimalWorkflowPage from "./EquipmentFinanceMinimalWorkflowPage";
import EquipmentInstallmentCommandAdvancedPage from "./EquipmentInstallmentCommandAdvancedPage";

export default function EquipmentInstallmentCommandPage() {
  const location = useLocation();
  const view = new URLSearchParams(location.search).get("view");

  if (view === "advanced") {
    return <EquipmentInstallmentCommandAdvancedPage />;
  }

  if (view === "workflow") {
    return <EquipmentFinanceMinimalWorkflowPage />;
  }

  return (
    <>
      <EquipmentFinanceCompletionHomePage />
      <EquipmentFinanceMinimalWorkflowPage />
    </>
  );
}
