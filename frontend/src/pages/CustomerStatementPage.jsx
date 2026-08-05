import { useState } from "react";

import CustomerIdentityManagementPanel from "../components/CustomerIdentityManagementPanel";
import CustomerStatementWorkspacePage from "./CustomerStatementWorkspacePage";

export default function CustomerStatementPage() {
  const [statementRefreshKey, setStatementRefreshKey] = useState(0);

  return (
    <>
      <CustomerIdentityManagementPanel
        onMerged={() => setStatementRefreshKey((current) => current + 1)}
      />
      <CustomerStatementWorkspacePage key={statementRefreshKey} />
    </>
  );
}
