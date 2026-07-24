import { useState } from "react";
import { useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { clearStoredBiometricBinding } from "../utils/biometricAccess";
import "../styles/commandGate.css";

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
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const accountName = user?.full_name || user?.username || "Authorised user";
  const contextName = isSparePartsWorkspace
    ? `${branchCode || "STORE"} — ${branchName || "Selected Store"}`
    : workspaceName || user?.active_workspace?.name || "Chalin 03";

  async function handleChangePassword(event) {
    event.preventDefault();
    setMessage("");
    setError("");

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
      "Change this account password? Existing sessions will be signed out."
    );
    if (!confirmed) return;

    setWorking(true);
    try {
      await axiosClient.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      clearStoredBiometricBinding();
      setMessage("Password changed successfully. Opening a fresh login.");
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
      setWorking(false);
    }
  }

  return (
    <main className="command-page">
      <div className="command-page__shell">
        <header className="command-page__hero">
          <div>
            <p>Account security</p>
            <h1>Password Security</h1>
          </div>
          <span>
            {accountName} · {contextName}. Chalin 03 uses account-password login on
            desktop and mobile browsers.
          </span>
        </header>

        {message && (
          <div className="command-alert command-alert--success">{message}</div>
        )}
        {error && (
          <div className="command-alert command-alert--error">{error}</div>
        )}

        <div className="command-page__grid">
          <section className="command-page__card command-page__card--wide">
            <h2>Change account password</h2>
            <p>
              Browser fingerprint, face, passkey and device screen-lock login are
              disabled. A website cannot reliably prove whether a biometric sensor or
              a fallback PIN was used, so password login is the approved method.
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
                disabled={working}
                type="submit"
              >
                {working ? "Changing password…" : "Change password securely"}
              </button>
            </form>
          </section>

          <section className="command-page__card command-page__card--wide command-security-note">
            <h3>Approved login controls</h3>
            <div className="command-security-grid">
              <span>✓ Password login works on desktop and mobile.</span>
              <span>✓ No passkey or device screen-lock prompt is offered.</span>
              <span>✓ Workspace and store access are checked at every login.</span>
              <span>✓ Password changes invalidate existing account sessions.</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
