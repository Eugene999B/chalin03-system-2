import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import CustomerFeatureControlsPanel from "../components/CustomerFeatureControlsPanel";
import ExecutiveBusinessIntelligenceSettingsPanel from "../components/ExecutiveBusinessIntelligenceSettingsPanel";
import UsersSettingsPage from "./UsersSettingsPage";
import DebtReminderSettingsPanel from "../components/DebtReminderSettingsPanel";
import { useAuth } from "../context/AuthContext";

const SYSTEM_ADMIN_ID = 1;
const SYSTEM_ADMIN_USERNAME = "admin";

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    String(user?.username || "").toLowerCase() === SYSTEM_ADMIN_USERNAME &&
    String(user?.role || "").toLowerCase() === "admin"
  );
}

export default function SparePartsUsersSettingsWithDebtRemindersPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canManage = ["admin", "manager"].includes(role);
  const systemAdministrator = isOriginalSystemAdministrator(user);

  const [userSettingsAccessOnlySystemAdmin, setUserSettingsAccessOnlySystemAdmin] = useState(false);
  const [userSettingsAccessLoading, setUserSettingsAccessLoading] = useState(true);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadUserSettingsAccessControl() {
      setUserSettingsAccessLoading(true);
      setAccessError("");

      try {
        const response = await axiosClient.get("/settings/user-settings-access");
        if (!mounted) return;
        setUserSettingsAccessOnlySystemAdmin(
          Boolean(response.data?.user_settings_system_admin_only)
        );
      } catch (error) {
        if (!mounted) return;
        setAccessError(
          error.response?.data?.message ||
            "Could not load User Settings access control. Existing access has not been changed."
        );
      } finally {
        if (mounted) setUserSettingsAccessLoading(false);
      }
    }

    loadUserSettingsAccessControl();

    return () => {
      mounted = false;
    };
  }, []);

  const userSettingsAllowed =
    !userSettingsAccessOnlySystemAdmin || systemAdministrator;

  async function handleUserSettingsAccessToggle(event) {
    const nextValue = event.target.checked;
    setAccessSaving(true);
    setAccessMessage("");
    setAccessError("");

    try {
      const response = await axiosClient.patch("/settings/user-settings-access", {
        user_settings_system_admin_only: nextValue,
      });
      setUserSettingsAccessOnlySystemAdmin(
        Boolean(response.data?.user_settings_system_admin_only)
      );
      setAccessMessage(response.data?.message || "User Settings access control updated.");
    } catch (error) {
      setAccessError(
        error.response?.data?.message || "User Settings access control could not be updated."
      );
    } finally {
      setAccessSaving(false);
    }
  }

  return (
    <>
      <CustomerFeatureControlsPanel />
      <ExecutiveBusinessIntelligenceSettingsPanel />

      {systemAdministrator ? (
        <div
          style={{
            marginTop: 18,
            marginBottom: 18,
            padding: 18,
            border: "1px solid var(--border-color, #d9dee7)",
            borderRadius: 14,
            background: "var(--card-background, #ffffff)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>User Settings Access</h2>
              <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
                When enabled, only the original System Administrator can access User Settings in Spare Parts.
                When disabled, existing administrator access remains unchanged.
              </p>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 600, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={userSettingsAccessOnlySystemAdmin}
                onChange={handleUserSettingsAccessToggle}
                disabled={userSettingsAccessLoading || accessSaving}
              />
              System Administrator only
            </label>
          </div>

          {accessSaving ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>Saving access control…</div>
          ) : null}
          {accessMessage ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>{accessMessage}</div>
          ) : null}
          {accessError ? (
            <div style={{ marginTop: 10, fontSize: 13 }} role="alert">{accessError}</div>
          ) : null}
        </div>
      ) : null}

      {userSettingsAccessLoading ? (
        <div style={{ padding: 18 }}>Checking User Settings access…</div>
      ) : userSettingsAllowed ? (
        <UsersSettingsPage />
      ) : (
        <div
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 14,
            border: "1px solid var(--border-color, #d9dee7)",
            background: "var(--card-background, #ffffff)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>User Settings Restricted</h2>
          <p style={{ marginBottom: 0, lineHeight: 1.5 }}>
            User Settings are currently restricted to the System Administrator for Spare Parts.
          </p>
        </div>
      )}

      {canManage ? (
        <div style={{ marginTop: 18, marginBottom: 18 }}>
          <DebtReminderSettingsPanel
            userRole={role}
            currentStoreCode={user?.branch_code || user?.store_code || "STORE"}
            currentStoreName={user?.branch_name || user?.store_name || "Selected Store"}
          />
        </div>
      ) : null}
    </>
  );
}
