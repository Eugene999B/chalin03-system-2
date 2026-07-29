import { useLocation } from "react-router";
import EquipmentCreditApplicationsPage from "./EquipmentCreditApplicationsPage";
import EquipmentFinanceAgreementActivationPage from "./EquipmentFinanceAgreementActivationPage";
import EquipmentFinanceDepositReservationPage from "./EquipmentFinanceDepositReservationPage";
import EquipmentFinanceFinalLifecyclePage from "./EquipmentFinanceFinalLifecyclePage";

const FINAL_LIFECYCLE_STAGES = new Set(["collections", "delivery", "ownership"]);

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");

  if (stage === "activation") {
    return <EquipmentFinanceAgreementActivationPage />;
  }

  if (stage === "deposit") {
    return <EquipmentFinanceDepositReservationPage />;
  }

  if (FINAL_LIFECYCLE_STAGES.has(stage)) {
    return <EquipmentFinanceFinalLifecyclePage />;
  }

  return <EquipmentCreditApplicationsPage />;
}
