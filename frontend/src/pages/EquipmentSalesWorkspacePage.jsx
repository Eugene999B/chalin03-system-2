import { useLocation } from "react-router";
import EquipmentFinanceAgreementActivationPage from "./EquipmentFinanceAgreementActivationPage";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage";
import EquipmentFinanceArrearsPage from "./EquipmentFinanceArrearsPage";
import EquipmentFinanceCustomerCentrePage from "./EquipmentFinanceCustomerCentrePage";
import EquipmentFinanceDepositReservationPage from "./EquipmentFinanceDepositReservationPage";
import EquipmentFinanceExcavatorsPage from "./EquipmentFinanceExcavatorsPage";
import EquipmentFinanceFinalLifecyclePage from "./EquipmentFinanceFinalLifecyclePage";
import EquipmentFinanceGuidePage from "./EquipmentFinanceGuidePage";
import EquipmentFinanceProfessionalPage from "./EquipmentFinanceProfessionalPage";
import EquipmentFinanceRecoveryGovernancePage from "./EquipmentFinanceRecoveryGovernancePage";
import EquipmentFinanceStartWizardPage from "./EquipmentFinanceStartWizardPage";

const FINAL_LIFECYCLE_STAGES = new Set(["collections", "delivery", "ownership"]);
const PROFESSIONAL_STAGES = new Set(["settings", "documents", "staff"]);

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");

  if (stage === "start") {
    return <EquipmentFinanceStartWizardPage />;
  }

  if (stage === "customers") {
    return <EquipmentFinanceCustomerCentrePage />;
  }

  if (stage === "machines") {
    return <EquipmentFinanceExcavatorsPage />;
  }

  if (stage === "guide") {
    return <EquipmentFinanceGuidePage />;
  }

  if (PROFESSIONAL_STAGES.has(stage)) {
    return <EquipmentFinanceProfessionalPage mode={stage} />;
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

  return <EquipmentFinanceApplicationsPage />;
}
