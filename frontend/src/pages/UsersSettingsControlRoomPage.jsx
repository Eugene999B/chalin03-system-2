import CustomerFeatureControlsPanel from "../components/CustomerFeatureControlsPanel";
import AdminIntelligenceSettings from "../components/AdminIntelligenceSettings";
import UsersSettingsPage from "./UsersSettingsPage";

export default function UsersSettingsControlRoomPage() {
  return (
    <>
      <CustomerFeatureControlsPanel />
      <UsersSettingsPage />
      <AdminIntelligenceSettings />
    </>
  );
}
