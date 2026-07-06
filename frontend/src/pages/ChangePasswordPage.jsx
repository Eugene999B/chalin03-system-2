import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user, logout, branchCode, branchName, branchLocation } = useAuth();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleChangePassword(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All password fields are required.");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from current password.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to change your password? This password is for your account and will apply whenever you login to any store you are allowed to access."
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      await axiosClient.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      setMessage(
        "Password changed successfully. Please login again with your new password."
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        logout();
        navigate("/login");
      }, 1500);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Change Password</h1>
          <p>
            Update your login password securely for{" "}
            <strong>{user?.full_name || user?.username || "your account"}</strong>
          </p>
        </div>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Password changes are account-wide. After changing your password, you
          will be logged out and must login again. The new password will work
          for every store your account is allowed to access.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="section-card" style={{ maxWidth: "560px" }}>
        <form onSubmit={handleChangePassword}>
          <label>Current Password</label>
          <input
            type={showPasswords ? "text" : "password"}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Enter current password"
            autoComplete="current-password"
          />

          <label>New Password</label>
          <input
            type={showPasswords ? "text" : "password"}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Enter new password"
            autoComplete="new-password"
          />

          <label>Confirm New Password</label>
          <input
            type={showPasswords ? "text" : "password"}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "12px",
              marginBottom: "16px",
              fontWeight: "700",
            }}
          >
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(event) => setShowPasswords(event.target.checked)}
              style={{ width: "auto" }}
            />
            Show passwords
          </label>

          <button type="submit" disabled={saving}>
            {saving ? "Changing Password..." : "Change Password"}
          </button>
        </form>

        <div
          style={{
            marginTop: "18px",
            padding: "14px",
            borderRadius: "12px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
          }}
        >
          <strong>Forgotten password?</strong>
          <p style={{ marginBottom: 0 }}>
            Contact the admin to reset your password. After the admin gives you
            a temporary password, login and change it here.
          </p>
        </div>
      </div>
    </div>
  );
}
