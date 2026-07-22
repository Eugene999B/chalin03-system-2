import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { clearStoredBiometricBinding } from "../utils/biometricAccess";
import {
  getSavedStationMode,
  getStationModes,
  saveStationMode,
} from "../utils/commandGate";
import "../styles/commandGate.css";

function formatDate(value) {
  if (!value) return "Never used";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function validateNewPassword(password) {
  const text = String(password || "");
  if (text.length < 8) return "New password must be at least 8 characters long.";
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Use both uppercase and lowercase letters.";
  }
  if (!/\d/.test(text)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(text)) return "Include at least one symbol.";
  return "";
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const {
    user,
    logout,
    workspaceCode,
    workspaceName,
    branchCode,
    branchName,
    isSparePartsWorkspace,
  } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordWorking, setPasswordWorking] = useState(false);
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [deviceWorking, setDeviceWorking] = useState(false);
  const [stationCode, setStationCode] = useState(() =>
    getSavedStationMode(workspaceCode)
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const stationModes = useMemo(
    () => getStationModes(workspaceCode),
    [workspaceCode]
  );
  const accountName = user?.full_name || user?.username || "Authorised user";
  const contextName = isSparePartsWorkspace
    ? `${branchCode || "STORE"} — ${branchName || "Selected Store"}`
    : workspaceName || user?.active_workspace?.name || "Chalin 03";

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const response = await axiosClient.get("/auth/biometrics/devices");
      setDevices(Array.isArray(response.data?.devices) ? response.data.devices : []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load fingerprint and face devices. Password security remains available."
      );
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    setStationCode(getSavedStationMode(workspaceCode));
  }, [workspaceCode]);

  function clearNotices() {
    setMessage("");
    setError("");
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    clearNotices();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Complete all password fields.");
      return;
    }

    const policyError = validateNewPassword(newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    const confirmed = window.confirm(
      "Change this account password? All fingerprint and face devices will be revoked and you will be signed out."
    );
    if (!confirmed) return;

    setPasswordWorking(true);
    try {
      await axiosClient.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      clearStoredBiometricBinding();
      setMessage(
        "Password changed. Fingerprint and face devices were revoked. Opening a fresh login."
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        logout();
        navigate("/login", { replace: true });
      }, 900);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Failed to change password.");
    } finally {
      setPasswordWorking(false);
    }
  }

  async function handleRevoke(deviceId) {
    const confirmed = window.confirm(
      "Remove fingerprint or face login from this device? Password login will continue to work."
    );
    if (!confirmed) return;

    clearNotices();
    setDeviceWorking(true);
    try {
      const response = await axiosClient.delete(
        `/auth/biometrics/devices/${deviceId}`
      );
      clearStoredBiometricBinding();
      setMessage(
        response.data?.message ||
          "Fingerprint or face login was removed from the device."
      );
      await loadDevices();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not remove the fingerprint or face device."
      );
    } finally {
      setDeviceWorking(false);
    }
  }

  function handleStationChange(event) {
    const saved = saveStationMode(workspaceCode, event.target.value);
    setStationCode(saved);
    setMessage("This device entrance profile has been updated.");
    setError("");
  }

  return (
    <main className="command-page">
      <div className="command-page__shell">
        <header className="command-page__hero">
          <div>
            <p>Account security</p>
            <h1>Password, Fingerprint & Face</h1>
          </div>
          <span>
            {accountName} · {contextName}. Manage the account password, linked
            biometric devices and this browser&apos;s entrance station.
          </span>
        </header>

        {message && (
          <div className="command-alert command-alert--success">{message}</div>
        )}
        {error && (
          <div className="command-alert command-alert--error">{error}</div>
        )}

        <div className="command-page__grid">
          <section className="command-page__card">
            <h2>Change account password</h2>
            <p>
              A password change signs the account out and immediately revokes every
              linked fingerprint and face device.
            </p>
            <form className="command-page__form" onSubmit={handleChangePassword}>
              <label>
                Current password
                <input
                  type={showPasswords ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label>
                New password
                <input
                  type={showPasswords ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type={showPasswords ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="command-checkbox command-checkbox--light">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(event) => setShowPasswords(event.target.checked)}
                />
                <span>Show passwords while typing</span>
              </label>
              <button
                className="command-page__button"
                disabled={passwordWorking}
                type="submit"
              >
                {passwordWorking ? "Changing password…" : "Change password securely"}
              </button>
            </form>
          </section>

          <section className="command-page__card">
            <h2>Add fingerprint or face login</h2>
            <p>
              For safety, adding a new device starts only after a fresh password login.
              Sign out, sign in with the password, then choose
              <strong> Set up fingerprint or face</strong> when Chalin 03 asks.
            </p>

            <div className="command-page__station">
              <h3>Entrance station</h3>
              <p>
                This browser opens directly to the selected operation after login. It
                never grants extra permissions.
              </p>
              <label>
                Entrance profile
                <select value={stationCode} onChange={handleStationChange}>
                  {stationModes.map((station) => (
                    <option key={station.code} value={station.code}>
                      {station.title} — {station.description}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="command-page__card command-page__card--wide">
            <h2>Linked fingerprint and face devices</h2>
            <p>
              Remove a device immediately when it is lost, replaced or no longer
              authorised.
            </p>

            {devicesLoading ? (
              <p>Loading biometric devices…</p>
            ) : devices.length === 0 ? (
              <div className="command-empty-state">
                No fingerprint or face device is linked. Sign in with the password to
                set up this device.
              </div>
            ) : (
              <div className="device-list">
                {devices.map((device) => (
                  <div className="device-row" key={device.id}>
                    <div>
                      <strong>{device.display_name || "Personal device"}</strong>
                      <span>Account-bound fingerprint or face login</span>
                      <small>
                        Linked {formatDate(device.created_at)} · Last used {formatDate(device.last_used_at)}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={deviceWorking}
                      onClick={() => handleRevoke(device.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="command-page__card command-page__card--wide command-security-note">
            <h3>Security guarantees</h3>
            <div className="command-security-grid">
              <span>✓ New devices must use the password first.</span>
              <span>✓ The browser link opens only its specific account.</span>
              <span>✓ Workspace and store access are checked again at login.</span>
              <span>✓ Password changes and device removal revoke biometric access.</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
