import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function DeviceAccessPage() {
  const { user, workspaceCode, workspaceName } = useAuth();
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stationCode, setStationCode] = useState(() =>
    getSavedStationMode(workspaceCode)
  );

  const stationModes = useMemo(
    () => getStationModes(workspaceCode),
    [workspaceCode]
  );

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/auth/passkeys");
      setPasskeys(Array.isArray(response.data?.passkeys) ? response.data.passkeys : []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load trusted devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPasskeys();
  }, [loadPasskeys]);

  async function handleRegister(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!supportsPasskeys()) {
      setError("This browser or connection does not support secure device registration.");
      return;
    }
    if (!currentPassword) {
      setError("Enter your current password to approve this device.");
      return;
    }

    setWorking(true);
    try {
      const result = await registerPasskey({
        currentPassword,
        displayName: displayName.trim() || "Trusted device",
      });
      setMessage(result.message || "This device can now unlock Chalin 03.");
      setCurrentPassword("");
      setDisplayName("");
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
      setWorking(false);
    }
  }

  async function handleRevoke(passkeyId) {
    const confirmed = window.confirm(
      "Remove this trusted device? Password login will still work."
    );
    if (!confirmed) return;

    setWorking(true);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.delete(`/auth/passkeys/${passkeyId}`);
      setMessage(response.data?.message || "Trusted device removed.");
      await loadPasskeys();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not remove the device.");
    } finally {
      setWorking(false);
    }
  }

  function handleStationChange(event) {
    const saved = saveStationMode(workspaceCode, event.target.value);
    setStationCode(saved);
    setMessage("This device station mode has been updated.");
    setError("");
  }

  return (
    <main className="command-page">
      <div className="command-page__shell">
        <header className="command-page__hero">
          <div>
            <p>Command Gate security</p>
            <h1>Trusted devices & station mode</h1>
          </div>
          <span>
            {user?.full_name || user?.username} · {workspaceName || workspaceCode}. Register
            fingerprint, face, Windows Hello or device PIN without removing password access.
          </span>
        </header>

        <div className="command-page__grid">
          <section className="command-page__card">
            <h2>Register this device</h2>
            <p>
              Your current password confirms the request. Biometric information remains on
              the device; Chalin stores only the public passkey credential.
            </p>
            <form className="command-page__form" onSubmit={handleRegister}>
              <label>
                Device name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Example: Front Desk Windows PC"
                  maxLength={120}
                />
              </label>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button className="command-page__button" type="submit" disabled={working}>
                {working ? "Verifying device…" : "Register secure device unlock"}
              </button>
            </form>
          </section>

          <section className="command-page__card">
            <h2>Temporary station mode</h2>
            <p>
              Turn this browser into a task-focused station. The setting applies only to this
              device and never grants extra permissions.
            </p>
            <form className="command-page__form">
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
            </form>
          </section>

          <section className="command-page__card command-page__card--wide">
            <h2>Registered trusted devices</h2>
            <p>Revoke any device that is lost, replaced or no longer authorised.</p>
            {loading ? (
              <p>Loading trusted devices…</p>
            ) : passkeys.length === 0 ? (
              <div className="command-alert">No trusted device has been registered yet.</div>
            ) : (
              <div className="device-list">
                {passkeys.map((passkey) => (
                  <div className="device-row" key={passkey.id}>
                    <div>
                      <strong>{passkey.display_name || "Trusted device"}</strong>
                      <span>
                        {passkey.device_type || "Passkey"}
                        {passkey.backed_up ? " · Synced passkey" : " · Device-bound passkey"}
                      </span>
                      <small>
                        Registered {formatDate(passkey.created_at)} · Last used {formatDate(passkey.last_used_at)}
                      </small>
                    </div>
                    <button type="button" disabled={working} onClick={() => handleRevoke(passkey.id)}>
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {message && <div className="command-alert command-alert--success">{message}</div>}
        {error && <div className="command-alert command-alert--error">{error}</div>}
      </div>
    </main>
  );
}
