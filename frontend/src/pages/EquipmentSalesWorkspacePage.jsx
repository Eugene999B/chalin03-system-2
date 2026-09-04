import { lazy, Suspense } from "react";
import { useLocation } from "react-router";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage";
import EquipmentFinanceApplicationsCompletionPage from "./EquipmentFinanceApplicationsCompletionPage";
import EquipmentFinanceStartInstallmentPage from "./EquipmentFinanceStartInstallmentPage";

const EquipmentFinanceActiveInstallmentsPage = lazy(() => import("./EquipmentFinanceActiveInstallmentsPage"));
const EquipmentFinanceAgreementActivationPage = lazy(() => import("./EquipmentFinanceAgreementActivationPage"));
const EquipmentFinanceArrearsPage = lazy(() => import("./EquipmentFinanceArrearsPage"));
const EquipmentFinanceCaseOperationsPage = lazy(() => import("./EquipmentFinanceCaseOperationsPage"));
const EquipmentFinanceCaseWorkspacePage = lazy(() => import("./EquipmentFinanceCaseWorkspacePage"));
const EquipmentFinanceCollectionsMinimalPage = lazy(() => import("./EquipmentFinanceCollectionsMinimalPage"));
const EquipmentFinanceCorrectionsPage = lazy(() => import("./EquipmentFinanceCorrectionsPage"));
const EquipmentFinanceCustomerCentrePage = lazy(() => import("./EquipmentFinanceCustomerCentrePage"));
const EquipmentFinanceCustomerPortfolioPage = lazy(() => import("./EquipmentFinanceCustomerPortfolioPage"));
const EquipmentFinanceDepositReservationPage = lazy(() => import("./EquipmentFinanceDepositReservationPage"));
const EquipmentFinanceDocumentCentrePage = lazy(() => import("./EquipmentFinanceDocumentCentrePage"));
const EquipmentFinanceExcavatorsPage = lazy(() => import("./EquipmentFinanceExcavatorsPage"));
const EquipmentFinanceFinalLifecyclePage = lazy(() => import("./EquipmentFinanceFinalLifecyclePage"));
const EquipmentFinanceGuidePage = lazy(() => import("./EquipmentFinanceGuidePage"));
const EquipmentFinanceOperationalPolishPage = lazy(() => import("./EquipmentFinanceOperationalPolishPage"));
const EquipmentFinancePaymentsCentrePage = lazy(() => import("./EquipmentFinancePaymentsCentrePage"));
const EquipmentFinanceProfessionalPage = lazy(() => import("./EquipmentFinanceProfessionalPage"));
const EquipmentFinanceRecoveryGovernancePage = lazy(() => import("./EquipmentFinanceRecoveryGovernancePage"));
const EquipmentFinanceTaskInboxPage = lazy(() => import("./EquipmentFinanceTaskInboxPage"));
const InstallmentCompletionPhaseFourPage = lazy(() => import("./InstallmentCompletionPhaseFourPage"));

const FINAL_LIFECYCLE_STAGES = new Set(["delivery", "ownership"]);
const PROFESSIONAL_STAGES = new Set(["settings", "staff"]);

function FinanceStageFallback() {
  return <main className="finance-simple"><div className="finance-simple__empty" role="status" aria-live="polite">Opening the selected Finance workspace…</div></main>;
}

function stagePage(stage) {
  if (stage === "start") return <EquipmentFinanceStartInstallmentPage />;
  if (stage === "inbox") return <EquipmentFinanceTaskInboxPage />;
  if (stage === "case-operations") return <EquipmentFinanceCaseOperationsPage />;
  if (stage === "finalization") return <InstallmentCompletionPhaseFourPage />;
  if (stage === "applications-core") return <EquipmentFinanceApplicationsPage />;
  if (stage === "operations" || stage === "operations-advanced") return <EquipmentFinanceOperationalPolishPage />;
  if (stage === "customers") return <EquipmentFinanceCustomerCentrePage />;
  if (stage === "customer-portfolios") return <EquipmentFinanceCustomerPortfolioPage />;
  if (stage === "machines") return <EquipmentFinanceExcavatorsPage />;
  if (stage === "guide") return <EquipmentFinanceGuidePage />;
  if (stage === "documents" || stage === "case-workspace") return <EquipmentFinanceCaseWorkspacePage />;
  if (stage === "generated-documents") return <EquipmentFinanceDocumentCentrePage />;
  if (stage === "generated-documents-core") return <EquipmentFinanceProfessionalPage mode="documents" />;
  if (PROFESSIONAL_STAGES.has(stage)) return <EquipmentFinanceProfessionalPage mode={stage} />;
  if (stage === "arrears") return <EquipmentFinanceArrearsPage />;
  if (stage === "governance") return <EquipmentFinanceRecoveryGovernancePage />;
  if (stage === "corrections") return <EquipmentFinanceCorrectionsPage />;
  if (stage === "activation") return <EquipmentFinanceAgreementActivationPage />;
  if (stage === "deposit") return <EquipmentFinanceDepositReservationPage />;
  if (stage === "accounts") return <EquipmentFinanceActiveInstallmentsPage />;
  if (stage === "collections-core") return <EquipmentFinanceCollectionsMinimalPage />;
  if (stage === "collections") return <EquipmentFinancePaymentsCentrePage />;
  if (FINAL_LIFECYCLE_STAGES.has(stage)) return <EquipmentFinanceFinalLifecyclePage />;
  return <EquipmentFinanceApplicationsCompletionPage />;
}

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const stage = new URLSearchParams(location.search).get("stage");
  const page = stagePage(stage);
  if (!stage || stage === "applications" || stage === "start") return page;
  return <Suspense fallback={<FinanceStageFallback />}>{page}</Suspense>;
}
