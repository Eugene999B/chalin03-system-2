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

  // Preserve the original detailed nine-step workflow as a supported reference
  // view while the clearer six-stage completion home remains the daily default.
  if (view === "workflow") {
    return <EquipmentFinanceMinimalWorkflowPage />;
  }

  return <EquipmentFinanceCompletionHomePage />;
}
