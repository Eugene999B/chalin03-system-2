import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  async function handleLogin(event) {
    event.preventDefault();

    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);

    try {
      await login(username.trim(), password);
    } catch (error) {
      setError(error.response?.data?.message || "Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleLogin} autoComplete="off">
        <div className="login-logo">C3</div>

        <h1>Chalin 03 System</h1>
        <p>Login to manage sales, stock, debts and reports.</p>

        {error && <div className="error-box">{error}</div>}

        <label>Username</label>
        <input
          name="chalin03_login_username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Enter username"
          autoComplete="off"
        />

        <label>Password</label>
        <div className="password-row">
          <input
            name="chalin03_login_password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
            autoComplete="new-password"
          />

          <button
            type="button"
            className="secondary-button password-toggle"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}