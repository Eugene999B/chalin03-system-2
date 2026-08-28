import { useEffect, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerIdentityEditorPanel from "../components/CustomerIdentityEditorPanel";
import CustomerMergeEmergencyPanel from "../components/CustomerMergeEmergencyPanel";
import CustomerStatementWorkspacePage from "./CustomerStatementWorkspacePage";
import "../styles/customerIdentityEditor.css";

export default function CustomerStatementPage() {
  const [statementRefreshKey, setStatementRefreshKey] = useState(0);
  const [mergeEnabled, setMergeEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    axiosClient
      .get("/debt-customers/feature-controls")
      .then((response) => {
        if (!active) return;
        setMergeEnabled(response.data.controls?.customer_merge_enabled !== false);
      })
      .catch(() => {
        // Keep existing emergency review visible if the control service is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <CustomerIdentityEditorPanel compact title="Edit Customer Details" />
      </div>
      {mergeEnabled ? (
        <CustomerMergeEmergencyPanel
          onRecovered={() => setStatementRefreshKey((current) => current + 1)}
        />
      ) : null}
      <CustomerStatementWorkspacePage key={statementRefreshKey} />
    </>
  );
}
