import { useLocation } from "react-router";
import EquipmentFinanceAgreementActivationPage from "./EquipmentFinanceAgreementActivationPage";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage";
import EquipmentFinanceArrearsPage from "./EquipmentFinanceArrearsPage";
import EquipmentFinanceCaseWorkspacePage from "./EquipmentFinanceCaseWorkspacePage";
import EquipmentFinanceCollectionsMinimalPage from "./EquipmentFinanceCollectionsMinimalPage";
import EquipmentFinanceCorrectionsPage from "./EquipmentFinanceCorrectionsPage";
import EquipmentFinanceCustomerCentrePage from "./EquipmentFinanceCustomerCentrePage";
import EquipmentFinanceDepositReservationPage from "./EquipmentFinanceDepositReservationPage";
import EquipmentFinanceExcavatorsPage from "./EquipmentFinanceExcavatorsPage";
import EquipmentFinanceFinalLifecyclePage from "./EquipmentFinanceFinalLifecyclePage";
import EquipmentFinanceGuidePage from "./EquipmentFinanceGuidePage";
import EquipmentFinanceOperationalPolishPage from "./EquipmentFinanceOperationalPolishPage";
import EquipmentFinanceOperationalStartPage from "./EquipmentFinanceOperationalStartPage";
import EquipmentFinanceProfessionalPage from "./EquipmentFinanceProfessionalPage";
import EquipmentFinanceRecoveryGovernancePage from "./EquipmentFinanceRecoveryGovernancePage";

const FINAL_LIFECYCLE_STAGES = new Set(["delivery", "ownership"]);
const PROFESSIONAL_STAGES = new Set(["settings", "documents", "staff"]);

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");

  if (stage === "start") {
    return <EquipmentFinanceOperationalStartPage />;
  }

  if (stage === "operations") {
    return <EquipmentFinanceOperationalPolishPage />;
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

  if (stage === "case-workspace") {
    return <EquipmentFinanceCaseWorkspacePage />;
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

  if (stage === "corrections") {
    return <EquipmentFinanceCorrectionsPage />;
  }

  if (stage === "activation") {
    return <EquipmentFinanceAgreementActivationPage />;
  }

  if (stage === "deposit") {
    return <EquipmentFinanceDepositReservationPage />;
  }

  if (stage === "collections") {
    return <EquipmentFinanceCollectionsMinimalPage />;
  }

  if (FINAL_LIFECYCLE_STAGES.has(stage)) {
    return <EquipmentFinanceFinalLifecyclePage />;
  }

  return <EquipmentFinanceApplicationsPage />;
}
