import BusinessPortalShell from "../components/BusinessPortalShell";
import { getBusinessWorkspace } from "../data/businessWorkspaces";

export default function EquipmentHirePortalPage() {
  const workspace = getBusinessWorkspace("equipment_hire");

  return <BusinessPortalShell workspace={workspace} />;
}
