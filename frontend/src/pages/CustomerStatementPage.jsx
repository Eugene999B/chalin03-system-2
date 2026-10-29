import { useEffect, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerIdentityEditorPanel from "../components/CustomerIdentityEditorPanel";
import CustomerMergeEmergencyPanel from "../components/CustomerMergeEmergencyPanel";
import CustomerStatementWorkspacePage from "./CustomerStatementWorkspacePage";

export default function CustomerStatementPage() {
  const [statementRefreshKey, setStatementRefreshKey] = useState(0);
  const [mergeEnabled, setMergeEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    axiosClient.get("/debt-customers/feature-controls")
      .then((response) => { if (active) setMergeEnabled(response.data.controls?.customer_merge_enabled !== false); })
      .catch(() => { if (active) setMergeEnabled(true); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 12px" }}>
        <CustomerIdentityEditorPanel title="Edit Customer Details" />
      </div>
      {mergeEnabled ? (
        <CustomerMergeEmergencyPanel onRecovered={() => setStatementRefreshKey((current) => current + 1)} />
      ) : null}
      <CustomerStatementWorkspacePage key={statementRefreshKey} />
    </>
  );
}
