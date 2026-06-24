import { useState } from "react";
import { Navigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  async function handleLogin(event) {
    event.preventDefault();

    setError("");
    setForgotMessage("");
    setForgotError("");

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

  async function handleForgotPassword(event) {
    event.preventDefault();

    setForgotMessage("");
    setForgotError("");
    setError("");

    const usernameToSend = forgotUsername.trim() || username.trim();

    if (!usernameToSend) {
      setForgotError("Please enter your username first.");
      return;
    }

    setForgotLoading(true);

    try {
      const response = await axiosClient.post("/auth/forgot-password", {
        username: usernameToSend,
      });

      setForgotMessage(
        response.data?.message ||
          "Please contact the admin to reset your password."
      );
    } catch (error) {
      setForgotError(
        error.response?.data?.message ||
          "Failed to request password reset help."
      );
    } finally {
      setForgotLoading(false);
    }
  }

  function openForgotPassword() {
    setShowForgotPassword(true);
    setForgotUsername(username);
    setForgotMessage("");
    setForgotError("");
    setError("");
  }

  function closeForgotPassword() {
    setShowForgotPassword(false);
    setForgotUsername("");
    setForgotMessage("");
    setForgotError("");
  }

  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={handleLogin}
        autoComplete="off"
        style={{
          maxWidth: "460px",
          padding: "34px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "160px",
            height: "160px",
            margin: "0 auto 18px",
            borderRadius: "28px",
            overflow: "hidden",
            background: "#07182c",
            boxShadow: "0 18px 45px rgba(7, 24, 44, 0.28)",
            border: "4px solid #e0ba28",
          }}
        >
          <img
            src="/chalin03-logo.png"
            alt="Chalin 03 Company Limited Logo"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>

        <h1
          style={{
            margin: "0",
            fontSize: "28px",
            color: "#07182c",
            fontWeight: "900",
          }}
        >
          Chalin 03 Company Ltd
        </h1>

        <p
          style={{
            margin: "8px 0 22px",
            color: "#667085",
            fontWeight: "700",
            lineHeight: "1.5",
          }}
        >
          Sales & Inventory Management System
        </p>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: "14px",
            padding: "16px",
            textAlign: "left",
          }}
        >
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

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "#07182c",
              padding: "12px 14px",
              fontSize: "16px",
            }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={openForgotPassword}
            style={{
              width: "100%",
              marginTop: "12px",
            }}
          >
            Forgot Password?
          </button>
        </div>

        {showForgotPassword && (
          <div
            style={{
              marginTop: "18px",
              padding: "14px",
              borderRadius: "12px",
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              color: "#9a3412",
              textAlign: "left",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Forgot Password</h3>

            <p style={{ marginTop: 0 }}>
              Enter your username. The system will guide you to contact the
              admin for a password reset.
            </p>

            {forgotMessage && (
              <div className="success-box" style={{ marginBottom: "12px" }}>
                {forgotMessage}
              </div>
            )}

            {forgotError && (
              <div className="error-box" style={{ marginBottom: "12px" }}>
                {forgotError}
              </div>
            )}

            <label>Username</label>
            <input
              value={forgotUsername}
              onChange={(event) => setForgotUsername(event.target.value)}
              placeholder="Enter your username"
              autoComplete="off"
            />

            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={forgotLoading}
              style={{ width: "100%", marginTop: "10px" }}
            >
              {forgotLoading ? "Checking..." : "Request Password Help"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={closeForgotPassword}
              style={{ width: "100%", marginTop: "10px" }}
            >
              Cancel
            </button>
          </div>
        )}

        <p
          style={{
            margin: "18px 0 0",
            fontSize: "12px",
            color: "#667085",
            lineHeight: "1.5",
          }}
        >
          Secure access for authorized Chalin 03 staff only.
        </p>
      </form>
    </div>
  );
}