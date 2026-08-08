import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import "./contentStudioAuth.css";

function errorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Content Studio login could not be completed."
  );
}

export default function ContentStudioLoginPage() {
  const navigate = useNavigate();
  const { login, isLoggedIn, isContentStudioWorkspace, mustChangePassword, loading } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!loading && isLoggedIn && isContentStudioWorkspace) {
    return <Navigate replace to={mustChangePassword ? "/content-studio/change-password" : "/content-studio"} />;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login({
        identifier,
        password,
        workspaceCode: "content_studio",
      });
      navigate(
        result.user?.must_change_password
          ? "/content-studio/change-password"
          : "/content-studio",
        { replace: true }
      );
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="c1-studio-auth-shell">
      <section className="c1-studio-auth-story">
        <a className="c1-studio-auth-brand" href="/">
          <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
          <span><b>CHALIN ONE</b><small>CONTENT STUDIO</small></span>
        </a>
        <div>
          <span>GOVERNED PUBLISHING WORKSPACE</span>
          <h1>The website has its own control room.</h1>
          <p>
            Content Studio accounts are separated from Spare Parts, Mining and Equipment operations.
            Your Studio role decides which publishing areas you can open.
          </p>
        </div>
        <footer>
          <span>01 / Create</span><span>02 / Review</span><span>03 / Publish</span>
        </footer>
      </section>

      <section className="c1-studio-auth-panel">
        <div className="c1-studio-auth-card">
          <header>
            <span>SECURE ENTRY / STUDIO</span>
            <h2>Sign in to Content Studio.</h2>
            <p>Use a dedicated Content Studio account or the protected System Administrator account.</p>
          </header>
          <form onSubmit={submit}>
            <label>
              <span>Username or registered phone</span>
              <input
                autoComplete="username"
                autoFocus
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Enter your Studio identity"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
              />
            </label>
            {error ? <div className="c1-studio-auth-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={submitting || loading}>
              {submitting ? "Verifying Studio access…" : "Open Content Studio"}<b>↗</b>
            </button>
          </form>
          <div className="c1-studio-auth-links">
            <a href="/">Return to CHALIN ONE</a>
            <a href="/login">Staff Login</a>
          </div>
          <small>
            Studio-only accounts cannot enter operational business workspaces. Operational staff must use Staff Login.
          </small>
        </div>
      </section>
    </main>
  );
}
