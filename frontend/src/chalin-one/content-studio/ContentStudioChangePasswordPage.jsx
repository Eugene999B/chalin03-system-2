import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import axiosClient from "../../api/axiosClient";
import { useAuth } from "../../context/AuthContext";
import "./contentStudioAuth.css";

function errorMessage(error) {
  return error?.response?.data?.message || error?.message || "Password change could not be completed.";
}

export default function ContentStudioChangePasswordPage() {
  const navigate = useNavigate();
  const {
    isLoggedIn,
    isContentStudioWorkspace,
    loading,
    user,
    logout,
  } = useAuth();
  const [form, setForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!loading && (!isLoggedIn || !isContentStudioWorkspace)) {
    return <Navigate replace to="/content-studio/login" />;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await axiosClient.post("/content-studio-auth/change-password", form);
      await logout();
      navigate("/content-studio/login", { replace: true });
    } catch (changeError) {
      setError(errorMessage(changeError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="c1-studio-auth-shell c1-studio-auth-shell-password">
      <section className="c1-studio-auth-story">
        <a className="c1-studio-auth-brand" href="/">
          <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
          <span><b>CHALIN ONE</b><small>CONTENT STUDIO</small></span>
        </a>
        <div>
          <span>FIRST ACCESS / SECURITY</span>
          <h1>Make this Studio account yours.</h1>
          <p>
            Temporary passwords must be replaced before publishing work begins. Changing the password signs out every active session for this account.
          </p>
        </div>
      </section>
      <section className="c1-studio-auth-panel">
        <div className="c1-studio-auth-card">
          <header>
            <span>PASSWORD CHANGE REQUIRED</span>
            <h2>Set a new secure password.</h2>
            <p>{user?.full_name || user?.username || "Content Studio user"}</p>
          </header>
          <form onSubmit={submit}>
            {[
              ["current_password", "Current temporary password", "current-password"],
              ["new_password", "New password", "new-password"],
              ["confirm_password", "Confirm new password", "new-password"],
            ].map(([key, label, autoComplete]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="password"
                  required
                  autoComplete={autoComplete}
                  value={form[key]}
                  onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
                />
              </label>
            ))}
            <div className="c1-studio-password-rule">
              Use at least 8 characters with uppercase, lowercase, a number and a symbol.
            </div>
            {error ? <div className="c1-studio-auth-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={submitting || loading}>
              {submitting ? "Securing account…" : "Change password & sign out"}<b>↗</b>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
