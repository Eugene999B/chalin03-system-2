import { lazy, Suspense } from "react";
import { useLocation } from "react-router";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage";
import EquipmentFinanceOperationalStartImmediatePage from "./EquipmentFinanceOperationalStartImmediatePage";

const EquipmentFinanceAgreementActivationPage = lazy(() =>
  import("./EquipmentFinanceAgreementActivationPage")
);
const EquipmentFinanceArrearsPage = lazy(() =>
  import("./EquipmentFinanceArrearsPage")
);
const EquipmentFinanceCaseWorkspacePage = lazy(() =>
  import("./EquipmentFinanceCaseWorkspacePage")
);
const EquipmentFinanceCollectionsMinimalPage = lazy(() =>
  import("./EquipmentFinanceCollectionsMinimalPage")
);
const EquipmentFinanceCorrectionsPage = lazy(() =>
  import("./EquipmentFinanceCorrectionsPage")
);
const EquipmentFinanceCustomerCentrePage = lazy(() =>
  import("./EquipmentFinanceCustomerCentrePage")
);
const EquipmentFinanceDepositReservationPage = lazy(() =>
  import("./EquipmentFinanceDepositReservationPage")
);
const EquipmentFinanceExcavatorsPage = lazy(() =>
  import("./EquipmentFinanceExcavatorsPage")
);
const EquipmentFinanceFinalLifecyclePage = lazy(() =>
  import("./EquipmentFinanceFinalLifecyclePage")
);
const EquipmentFinanceGuidePage = lazy(() =>
  import("./EquipmentFinanceGuidePage")
);
const EquipmentFinanceOperationalPolishPage = lazy(() =>
  import("./EquipmentFinanceOperationalPolishPage")
);
const EquipmentFinanceProfessionalPage = lazy(() =>
  import("./EquipmentFinanceProfessionalPage")
);
const EquipmentFinanceRecoveryGovernancePage = lazy(() =>
  import("./EquipmentFinanceRecoveryGovernancePage")
);

const FINAL_LIFECYCLE_STAGES = new Set(["delivery", "ownership"]);
const PROFESSIONAL_STAGES = new Set(["settings", "generated-documents", "staff"]);

function FinanceStageFallback() {
  return (
    <main className="finance-simple">
      <div className="finance-simple__empty" role="status" aria-live="polite">
        Opening the selected Finance workspace…
      </div>
    </main>
  );
}

function stagePage(stage) {
  if (stage === "start") {
    return <EquipmentFinanceOperationalStartImmediatePage />;
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

  if (stage === "documents" || stage === "case-workspace") {
    return <EquipmentFinanceCaseWorkspacePage />;
  }

  if (PROFESSIONAL_STAGES.has(stage)) {
    return (
      <EquipmentFinanceProfessionalPage
        mode={stage === "generated-documents" ? "documents" : stage}
      />
    );
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

  // Applications & Approvals is the critical default Finance screen. Keep it
  // outside React.lazy so a delayed chunk can never leave the page in Suspense.
  return <EquipmentFinanceApplicationsPage />;
}

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");
  const page = stagePage(stage);

  // Applications and Start New Installment are the two critical Finance entry
  // screens. Both render immediately and never wait inside a Suspense fallback.
  if (!stage || stage === "applications" || stage === "start") {
    return page;
  }

  return <Suspense fallback={<FinanceStageFallback />}>{page}</Suspense>;
}
