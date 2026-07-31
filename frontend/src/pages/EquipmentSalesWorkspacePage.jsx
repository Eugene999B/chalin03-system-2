import { useLocation } from "react-router";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage";
import EquipmentFinanceCustomerPortfolioPage from "./EquipmentFinanceCustomerPortfolioPage";
import EquipmentFinanceGuidePage from "./EquipmentFinanceGuidePage";
import EquipmentFinanceOperationalPolishPage from "./EquipmentFinanceOperationalPolishPage";
import EquipmentFinanceOperationalStartPage from "./EquipmentFinanceOperationalStartPage";
import EquipmentFinanceSettingsPage from "./EquipmentFinanceSettingsPage";
import EquipmentInstallmentCommandPage from "./EquipmentInstallmentCommandPage";
import FleetAssetsPage from "./FleetAssetsPage";

const STAGES = new Set([
  "applications",
  "start",
  "customers",
  "machines",
  "collections",
  "arrears",
  "settings",
  "guide",
  "operations",
]);

export default function EquipmentSalesWorkspacePage() {
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get("stage") || "applications";
  const stage = STAGES.has(requested) ? requested : "applications";

  if (stage === "start") return <EquipmentFinanceOperationalStartPage />;
  if (stage === "customers") return <EquipmentFinanceCustomerPortfolioPage />;
  if (stage === "machines") return <FleetAssetsPage />;
  if (stage === "collections" || stage === "arrears") {
    return <EquipmentInstallmentCommandPage initialView={stage} />;
  }
  if (stage === "settings") return <EquipmentFinanceSettingsPage />;
  if (stage === "guide") return <EquipmentFinanceGuidePage />;
  if (stage === "operations") return <EquipmentFinanceOperationalPolishPage />;
  return <EquipmentFinanceApplicationsPage />;
}
