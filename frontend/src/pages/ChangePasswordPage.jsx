import { useMemo, useState } from "react";
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

  const accountName = user?.full_name || user?.username || "your account";

  const passwordStrength = useMemo(() => {
    let score = 0;

    if (newPassword.length >= 6) score += 25;
    if (newPassword.length >= 10) score += 20;
    if (/[A-Z]/.test(newPassword)) score += 15;
    if (/[0-9]/.test(newPassword)) score += 15;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 15;
    if (newPassword && newPassword !== currentPassword) score += 10;

    const safeScore = Math.min(score, 100);

    if (!newPassword) {
      return {
        score: 0,
        label: "Waiting",
        note: "Enter a new password to check strength.",
        tone: "neutral",
      };
    }

    if (safeScore >= 80) {
      return {
        score: safeScore,
        label: "Strong",
        note: "Good password strength.",
        tone: "strong",
      };
    }

    if (safeScore >= 55) {
      return {
        score: safeScore,
        label: "Good",
        note: "Acceptable, but can be stronger.",
        tone: "good",
      };
    }

    return {
      score: safeScore,
      label: "Weak",
      note: "Use more characters, numbers, capital letters or symbols.",
      tone: "weak",
    };
  }, [newPassword, currentPassword]);

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
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>Account Security Center</p>

            <h1 style={styles.heroTitle}>Change Password</h1>

            <p style={styles.heroSubtitle}>
              Securely update the login password for{" "}
              <strong>{accountName}</strong>. This password is account-wide and
              will work for every store your account is allowed to access.
            </p>
          </div>

          <div style={styles.heroCard}>
            <span>🔐</span>
            <div>
              <strong>{currentStoreCode}</strong>
              <small>{currentStoreName}</small>
            </div>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}
          <p>
            Password changes are account-wide. After changing your password, you
            will be logged out and must login again.
          </p>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.mainGrid}>
        <section style={styles.formPanel}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Password Update</p>
              <h2 style={styles.panelTitle}>Enter Password Details</h2>
              <p style={styles.panelSubtitle}>
                Use a password that is not easy for staff, friends or customers
                to guess.
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword}>
            <label>Current Password</label>
            <div style={styles.inputWrap}>
              <input
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </div>

            <label>New Password</label>
            <div style={styles.inputWrap}>
              <input
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
              />
            </div>

            <div style={styles.strengthBox}>
              <div style={styles.strengthTop}>
                <strong>Password strength: {passwordStrength.label}</strong>
                <span>{passwordStrength.score}%</span>
              </div>

              <div style={styles.strengthTrack}>
                <div
                  style={{
                    ...styles.strengthFill,
                    ...strengthToneStyles[passwordStrength.tone],
                    width: `${passwordStrength.score}%`,
                  }}
                />
              </div>

              <small>{passwordStrength.note}</small>
            </div>

            <label>Confirm New Password</label>
            <div style={styles.inputWrap}>
              <input
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => setShowPasswords(event.target.checked)}
                style={{ width: "auto" }}
              />
              Show passwords while typing
            </label>

            <button type="submit" disabled={saving} style={styles.submitButton}>
              {saving ? "Changing Password..." : "Change Password"}
            </button>
          </form>
        </section>

        <aside style={styles.sideStack}>
          <div style={styles.securityPanel}>
            <p style={styles.eyebrowDark}>Security Checklist</p>
            <h2>Before You Continue</h2>

            <div style={styles.checkList}>
              <SecurityCheck text="Do not use the default admin password." />
              <SecurityCheck text="Do not share your password with staff." />
              <SecurityCheck text="Use a password different from your phone number." />
              <SecurityCheck text="Logout after changing your password on a shared computer." />
            </div>
          </div>

          <div style={styles.warningPanel}>
            <strong>Forgotten password?</strong>
            <p>
              Contact the admin to reset your password. After the admin gives
              you a temporary password, login and change it here.
            </p>
          </div>

          <div style={styles.darkPanel}>
            <h2>Boss Security Note</h2>
            <p>
              Password security protects sales, stock adjustments, debt
              payments, audit records, reports and branch data. Keep your login
              private.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SecurityCheck({ text }) {
  return (
    <div style={styles.securityCheck}>
      <span>✓</span>
      <p>{text}</p>
    </div>
  );
}

const strengthToneStyles = {
  neutral: {
    background: "#94a3b8",
  },
  weak: {
    background: "linear-gradient(90deg, #ef4444, #f97316)",
  },
  good: {
    background: "linear-gradient(90deg, #f59e0b, #e0ba28)",
  },
  strong: {
    background: "linear-gradient(90deg, #22c55e, #16a34a)",
  },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1280px",
    margin: "0 auto",
    paddingBottom: "42px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 48%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.26)",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.34)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "760px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  heroCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    minWidth: "210px",
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.15)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.7fr)",
    gap: "18px",
    alignItems: "start",
  },

  formPanel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "22px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "24px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  inputWrap: {
    marginBottom: "12px",
  },

  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "12px",
    marginBottom: "16px",
    fontWeight: "800",
    color: "#0f172a",
  },

  strengthBox: {
    marginTop: "6px",
    marginBottom: "14px",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
  },

  strengthTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    marginBottom: "8px",
    color: "#0f172a",
  },

  strengthTrack: {
    height: "11px",
    borderRadius: "999px",
    background: "#e2e8f0",
    overflow: "hidden",
    marginBottom: "8px",
  },

  strengthFill: {
    height: "100%",
    borderRadius: "999px",
    transition: "width 0.2s ease",
  },

  submitButton: {
    width: "100%",
    border: "none",
    borderRadius: "16px",
    padding: "13px 16px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(224, 186, 40, 0.22)",
  },

  sideStack: {
    display: "grid",
    gap: "18px",
  },

  securityPanel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  },

  checkList: {
    display: "grid",
    gap: "10px",
    marginTop: "14px",
  },

  securityCheck: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "11px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#334155",
  },

  warningPanel: {
    padding: "16px",
    borderRadius: "20px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
  },

  darkPanel: {
    borderRadius: "24px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(7, 24, 44, 0.25)",
  },
};
