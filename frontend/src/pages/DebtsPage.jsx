import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import CustomerIdentityEditorPanel from "../components/CustomerIdentityEditorPanel";
import TopDebtDeskTools from "../components/TopDebtDeskTools";
import LegacyDebtsPage from "./LegacyDebtsPage";

export default function DebtsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [mergeEnabled, setMergeEnabled] = useState(true);

  useEffect(() => {
    axiosClient.get("/debt-customers/feature-controls")
      .then((response) => setMergeEnabled(response.data.controls?.customer_merge_enabled !== false))
      .catch(() => setMergeEnabled(true));
  }, []);

  return (
    <div className="top-only-debt-desk">
      {!mergeEnabled ? <style>{`.top-debt-tools__actions button.is-primary{display:none!important;}`}</style> : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 12px" }}>
        <CustomerIdentityEditorPanel compact title="Edit Customer Details" />
      </div>
      <TopDebtDeskTools onDataChanged={() => setRefreshKey((current) => current + 1)} />
      <LegacyDebtsPage key={refreshKey} />
    </div>
  );
}
