import { useLocation } from "react-router";
import EquipmentCreditApplicationsPage from "./EquipmentCreditApplicationsPage";
import EquipmentFinanceAgreementActivationPage from "./EquipmentFinanceAgreementActivationPage";
import EquipmentFinanceArrearsPage from "./EquipmentFinanceArrearsPage";
import EquipmentFinanceCustomersPage from "./EquipmentFinanceCustomersPage";
import EquipmentFinanceDepositReservationPage from "./EquipmentFinanceDepositReservationPage";
import EquipmentFinanceFinalLifecyclePage from "./EquipmentFinanceFinalLifecyclePage";
import EquipmentFinanceRecoveryGovernancePage from "./EquipmentFinanceRecoveryGovernancePage";

const FINAL_LIFECYCLE_STAGES = new Set(["collections", "delivery", "ownership"]);

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");

  if (stage === "customers") {
    return <EquipmentFinanceCustomersPage />;
  }

  if (stage === "arrears") {
    return <EquipmentFinanceArrearsPage />;
  }

  if (stage === "governance") {
    return <EquipmentFinanceRecoveryGovernancePage />;
  }

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
