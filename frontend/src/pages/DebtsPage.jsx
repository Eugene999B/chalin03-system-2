import { useEffect, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerIdentityEditorPanel from "../components/CustomerIdentityEditorPanel";
import TopDebtDeskTools from "../components/TopDebtDeskTools";
import LegacyDebtsPage from "./LegacyDebtsPage";

export default function DebtsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [mergeEnabled, setMergeEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    axiosClient.get("/debt-customers/feature-controls")
      .then((response) => { if (active) setMergeEnabled(response.data.controls?.customer_merge_enabled !== false); })
      .catch(() => { if (active) setMergeEnabled(true); });
    return () => { active = false; };
  }, []);

  function refreshDebtDesk() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <div className="top-only-debt-desk">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 12px" }}>
        <CustomerIdentityEditorPanel title="Edit Customer Details" />
      </div>
      {mergeEnabled ? null : <style>{`.top-debt-tools__actions button.is-primary{display:none!important;}`}</style>}
      <TopDebtDeskTools onDataChanged={refreshDebtDesk} />
      <LegacyDebtsPage key={refreshKey} />
    </div>
  );
}
