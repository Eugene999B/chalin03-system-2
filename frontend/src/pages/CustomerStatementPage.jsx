import { useState } from "react";

import CustomerMergeEmergencyPanel from "../components/CustomerMergeEmergencyPanel";
import CustomerStatementWorkspacePage from "./CustomerStatementWorkspacePage";

export default function CustomerStatementPage() {
  const [statementRefreshKey, setStatementRefreshKey] = useState(0);

  return (
    <>
      <CustomerMergeEmergencyPanel
        onRecovered={() => setStatementRefreshKey((current) => current + 1)}
      />
      <CustomerStatementWorkspacePage key={statementRefreshKey} />
    </>
  );
}
