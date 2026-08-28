import UsersSettingsPage from "./UsersSettingsPage";
import CustomerFeatureControlsPanel from "../components/CustomerFeatureControlsPanel";
import DebtReminderSettingsPanel from "../components/DebtReminderSettingsPanel";
import { useAuth } from "../context/AuthContext";

export default function SparePartsUsersSettingsWithDebtRemindersPage() {
  const { user } = useAuth();

  const role = String(user?.role || "").toLowerCase();
  const canManage = ["admin", "manager"].includes(role);
  const canManageCustomerFeatureControls = role === "admin";

  return (
    <>
      {canManageCustomerFeatureControls ? <CustomerFeatureControlsPanel /> : null}
      <UsersSettingsPage />
      {canManage ? (
        <div
          style={{
            marginTop: 18,
            marginBottom: 18,
          }}
        >
          <DebtReminderSettingsPanel
            userRole={role}
            currentStoreCode={user?.branch_code || user?.store_code || "STORE"}
            currentStoreName={
              user?.branch_name || user?.store_name || "Selected Store"
            }
          />
        </div>
      ) : null}
    </>
  );
}
