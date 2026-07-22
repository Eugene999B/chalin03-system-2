import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import {
  getSavedStationMode,
  getStationModes,
  registerPasskey,
  saveStationMode,
  supportsPasskeys,
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

  const [passkeys, setPasskeys] = useState([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [deviceWorking, setDeviceWorking] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [devicePassword, setDevicePassword] = useState("");
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

  const loadPasskeys = useCallback(async () => {
    setPasskeysLoading(true);
    try {
      const response = await axiosClient.get("/auth/passkeys");
      setPasskeys(Array.isArray(response.data?.passkeys) ? response.data.passkeys : []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load trusted devices. Password security is still available."
      );
    } finally {
      setPasskeysLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPasskeys();
  }, [loadPasskeys]);

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
      "Change this account-wide password and sign out of Chalin 03?"
    );
    if (!confirmed) return;

    setPasswordWorking(true);
    try {
      await axiosClient.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setMessage("Password changed successfully. Opening Command Gate for a fresh login.");
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

  async function handleRegisterDevice(event) {
    event.preventDefault();
    clearNotices();

    if (!supportsPasskeys()) {
      setError(
        "This browser or connection does not support secure device unlock. Use an updated browser over HTTPS."
      );
      return;
    }

    if (!devicePassword) {
      setError("Enter your current password to approve this trusted device.");
      return;
    }

    setDeviceWorking(true);
    try {
      const response = await registerPasskey({
        currentPassword: devicePassword,
        displayName: deviceName.trim() || "Trusted device",
      });
      setMessage(response.message || "This device can now unlock Chalin 03.");
      setDeviceName("");
      setDevicePassword("");
      await loadPasskeys();
    } catch (requestError) {
      const cancelled = String(requestError.name || "").includes("NotAllowed");
      setError(
        cancelled
          ? "Device registration was cancelled."
          : requestError.response?.data?.message ||
              requestError.message ||
              "Could not register this device."
      );
    } finally {
      setDeviceWorking(false);
    }
  }

  async function handleRevoke(passkeyId) {
    const confirmed = window.confirm(
      "Remove this trusted device? Password login will continue to work."
    );
    if (!confirmed) return;

    clearNotices();
    setDeviceWorking(true);
    try {
      const response = await axiosClient.delete(`/auth/passkeys/${passkeyId}`);
      setMessage(response.data?.message || "Trusted device removed.");
      await loadPasskeys();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not remove the device.");
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
            <p>Command Gate security</p>
            <h1>Account Security Centre</h1>
          </div>
          <span>
            {accountName} · {contextName}. Manage your password, biometric/device unlock and
            this device&apos;s station entrance without changing business records or permissions.
          </span>
        </header>

        {message && <div className="command-alert command-alert--success">{message}</div>}
        {error && <div className="command-alert command-alert--error">{error}</div>}

        <div className="command-page__grid">
          <section className="command-page__card">
            <h2>Change account password</h2>
            <p>
              This password is account-wide. After a successful change, Chalin signs you out so
              the new password can establish a fresh secure session.
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
              <button className="command-page__button" disabled={passwordWorking} type="submit">
                {passwordWorking ? "Changing password…" : "Change password securely"}
              </button>
            </form>
          </section>

          <section className="command-page__card">
            <h2>Register this trusted device</h2>
            <p>
              Use fingerprint, face, Windows Hello or device PIN at Command Gate. Biometric data
              remains on your device; Chalin stores only the public passkey credential.
            </p>
            <form className="command-page__form" onSubmit={handleRegisterDevice}>
              <label>
                Device name
                <input
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="Example: Front Desk Windows PC"
                  maxLength={120}
                />
              </label>
              <label>
                Current password for approval
                <input
                  type="password"
                  value={devicePassword}
                  onChange={(event) => setDevicePassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button className="command-page__button" disabled={deviceWorking} type="submit">
                {deviceWorking ? "Verifying device…" : "Register device unlock"}
              </button>
            </form>

            <div className="command-page__station">
              <h3>Temporary station mode</h3>
              <p>
                This browser opens directly to the selected operation after login. It never grants
                extra permissions.
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
            <h2>Registered trusted devices</h2>
            <p>Revoke a device immediately when it is lost, replaced or no longer authorised.</p>

            {passkeysLoading ? (
              <p>Loading trusted devices…</p>
            ) : passkeys.length === 0 ? (
              <div className="command-empty-state">
                No passkey is registered yet. Password login remains available.
              </div>
            ) : (
              <div className="device-list">
                {passkeys.map((passkey) => (
                  <div className="device-row" key={passkey.id}>
                    <div>
                      <strong>{passkey.display_name || "Trusted device"}</strong>
                      <span>
                        {passkey.device_type || "Passkey"}
                        {passkey.backed_up
                          ? " · Synced passkey"
                          : " · Device-bound passkey"}
                      </span>
                      <small>
                        Registered {formatDate(passkey.created_at)} · Last used {formatDate(passkey.last_used_at)}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={deviceWorking}
                      onClick={() => handleRevoke(passkey.id)}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="command-page__card command-page__card--wide command-security-note">
            <h3>Security guarantees</h3>
            <div className="command-security-grid">
              <span>✓ Password fallback always remains available.</span>
              <span>✓ Passkeys are tied to the authorised account.</span>
              <span>✓ Workspace and location access are checked again at login.</span>
              <span>✓ Revoked devices cannot unlock a new session.</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
