import { useLocation } from "react-router";
import EquipmentCreditApplicationsPage from "./EquipmentCreditApplicationsPage";
import EquipmentFinanceAgreementActivationPage from "./EquipmentFinanceAgreementActivationPage";

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");

  if (stage === "activation") {
    return <EquipmentFinanceAgreementActivationPage />;
  }

  return <EquipmentCreditApplicationsPage />;
}
