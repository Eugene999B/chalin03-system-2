import { useEffect, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerIdentityEditorPanel from "../components/CustomerIdentityEditorPanel";
import TopDebtDeskTools from "../components/TopDebtDeskTools";
import LegacyDebtsPage from "./LegacyDebtsPage";
import "../styles/customerIdentityEditor.css";

export default function DebtsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [mergeEnabled, setMergeEnabled] = useState(true);

  async function refreshDebtDesk() {
    setRefreshKey((current) => current + 1);
  }

  useEffect(() => {
    let active = true;

    axiosClient
      .get("/debt-customers/feature-controls")
      .then((response) => {
        if (!active) return;
        setMergeEnabled(response.data.controls?.customer_merge_enabled !== false);
      })
      .catch(() => {
        // Preserve existing merge controls when the optional feature-control read is unavailable.
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="top-only-debt-desk">
      <TopDebtDeskTools onDataChanged={refreshDebtDesk} />

      <div
        className="debt-customer-identity-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "0 0 12px",
        }}
      >
        <CustomerIdentityEditorPanel compact title="Edit Customer Details" />
      </div>

      {!mergeEnabled ? (
        <style>{`
          .top-debt-tools__actions button.is-primary,
          .customer-debt-consolidation-actions .secondary-button {
            display: none !important;
          }
        `}</style>
      ) : null}

      <LegacyDebtsPage key={refreshKey} />
    </div>
  );
}
