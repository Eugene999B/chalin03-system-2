import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage.jsx";

export default function EquipmentFinanceApplicationsOptionalPage() {
  return (
    <div className="finance-optional-approval-shell">
      <div className="finance-simple__notice is-info" role="status">
        <strong>Optional-information rule:</strong> only the customer and transaction details
        needed to create the installment are required. Blank identity, address, employment,
        affordability, guarantor, consent or document fields do not stop submission or
        approval by an authorised manager.
      </div>
      <EquipmentFinanceApplicationsPage />
    </div>
  );
}
