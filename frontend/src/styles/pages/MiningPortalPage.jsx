import BusinessPortalShell from "../components/BusinessPortalShell";
import { getBusinessWorkspace } from "../data/businessWorkspaces";

export default function MiningPortalPage() {
  const workspace = getBusinessWorkspace("mining");

  return <BusinessPortalShell workspace={workspace} />;
}
