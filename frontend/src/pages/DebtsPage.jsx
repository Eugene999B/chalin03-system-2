import { useState } from "react";

import TopDebtDeskTools from "../components/TopDebtDeskTools";
import LegacyDebtsPage from "./LegacyDebtsPage";

export default function DebtsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  async function refreshDebtDesk() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <div className="top-only-debt-desk">
      <TopDebtDeskTools onDataChanged={refreshDebtDesk} />
      <LegacyDebtsPage key={refreshKey} />
    </div>
  );
}
