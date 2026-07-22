import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import {
  clearStoredBiometricBinding,
  isBiometricAccessAvailable,
} from "../utils/biometricAccess";
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
  const [biometricAvailable, setBiometricAvailable] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    let cancelled = false;
    isBiometricAccessAvailable()
      .then((available) => {
        if (!cancelled) setBiometricAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setBiometricAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <main className="command-page">
      <div className="command-page__shell">
        <header className="command-page__hero">
          <div>
            <p>Account security</p>
            <h1>Password, Fingerprint & Face</h1>
          </div>
          <span>
            {accountName} · {contextName}. Manage the account password and linked
            biometric devices. Every login opens the selected business dashboard first.
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
            <h2>Fingerprint or face availability</h2>
            {biometricAvailable === null ? (
              <p>Checking this device for built-in fingerprint or face access…</p>
            ) : biometricAvailable ? (
              <p>
                This device reports a built-in user-verifying authenticator. To link it,
                sign out, sign in with the password, then choose
                <strong> Set up fingerprint or face</strong> when Chalin 03 asks.
              </p>
            ) : (
              <p>
                This device does not report a built-in fingerprint or face authenticator.
                Chalin 03 will use password login only and will not show a biometric setup
                invitation on this device.
              </p>
            )}

            <div className="command-page__station">
              <h3>Dashboard-first entry</h3>
              <p>
                Spare Parts, Mining Operations and Equipment Sales & Hire always open
                their own dashboard immediately after successful login.
              </p>
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
                No fingerprint or face device is linked. A capable device can be linked
                after a successful password login.
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
              <span>✓ Setup appears only when a platform authenticator is available.</span>
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
