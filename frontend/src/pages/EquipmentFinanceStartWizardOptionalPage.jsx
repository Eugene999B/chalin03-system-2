import EquipmentFinanceStartWizardPage from "./EquipmentFinanceStartWizardPage.jsx";
import "../styles/equipmentFinanceStartNew.css";

/**
 * Start New Installment is a dedicated transaction studio. The legacy optional
 * customer-profile wrapper is intentionally removed so the route has one real
 * page hierarchy instead of stacked layouts.
 */
export default function EquipmentFinanceStartWizardOptionalPage() {
  return <EquipmentFinanceStartWizardPage />;
}
