import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");

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

  const selectedBranch = useMemo(() => {
    return branches.find(
      (branch) => Number(branch.id) === Number(selectedBranchId)
    );
  }, [branches, selectedBranchId]);

  useEffect(() => {
    let ignore = false;

    async function loadBranches() {
      setBranchesLoading(true);
      setBranchesError("");

      try {
        const response = await axiosClient.get("/branches/public");
        const list = response.data?.branches || [];

        if (ignore) {
          return;
        }

        setBranches(list);

        if (list.length > 0) {
          setSelectedBranchId(String(list[0].id));
        }
      } catch (error) {
        if (ignore) {
          return;
        }

        setBranchesError(
          error.response?.data?.message ||
            "Could not load stores. Please check backend connection."
        );
      } finally {
        if (!ignore) {
          setBranchesLoading(false);
        }
      }
    }

    loadBranches();

    return () => {
      ignore = true;
    };
  }, []);

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  async function handleLogin(event) {
    event.preventDefault();

    setError("");
    setForgotMessage("");
    setForgotError("");

    if (!selectedBranchId) {
      setError("Please choose the store you are working with.");
      return;
    }

    if (!username.trim() || !password.trim()) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);

    try {
      await login(username.trim(), password, Number(selectedBranchId));
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
    <div className="store-login-page">
      <style>{`
        .store-login-page {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          background:
            radial-gradient(circle at 15% 10%, rgba(224, 186, 40, 0.28), transparent 30%),
            radial-gradient(circle at 85% 15%, rgba(59, 130, 246, 0.26), transparent 32%),
            radial-gradient(circle at 75% 85%, rgba(34, 197, 94, 0.20), transparent 30%),
            linear-gradient(135deg, #020617 0%, #07182c 42%, #0f172a 100%);
          color: #ffffff;
          padding: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .store-login-page * {
          box-sizing: border-box;
        }

        .store-bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px);
          background-size: 46px 46px;
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
          pointer-events: none;
        }

        .store-orb {
          position: absolute;
          border-radius: 999px;
          filter: blur(18px);
          opacity: 0.55;
          animation: floatOrb 8s ease-in-out infinite;
          pointer-events: none;
        }

        .store-orb.one {
          width: 210px;
          height: 210px;
          left: -50px;
          bottom: 14%;
          background: rgba(224, 186, 40, 0.45);
        }

        .store-orb.two {
          width: 180px;
          height: 180px;
          right: 4%;
          top: 10%;
          background: rgba(14, 165, 233, 0.36);
          animation-delay: 1.2s;
        }

        .store-orb.three {
          width: 130px;
          height: 130px;
          right: 16%;
          bottom: 10%;
          background: rgba(34, 197, 94, 0.32);
          animation-delay: 2s;
        }

        @keyframes floatOrb {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-22px) scale(1.04);
          }
        }

        .store-login-shell {
          width: min(1180px, 100%);
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: 1.08fr 0.92fr;
          gap: 24px;
          align-items: stretch;
        }

        .hero-panel,
        .login-panel {
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.10);
          backdrop-filter: blur(22px);
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.35);
          border-radius: 34px;
          overflow: hidden;
        }

        .hero-panel {
          padding: 34px;
          min-height: 700px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }

        .hero-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.18), transparent 34%),
            radial-gradient(circle at 60% 55%, rgba(255,255,255,0.10), transparent 35%);
          pointer-events: none;
        }

        .hero-content {
          position: relative;
          z-index: 1;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 42px;
        }

        .brand-logo {
          width: 82px;
          height: 82px;
          border-radius: 24px;
          overflow: hidden;
          background: #07182c;
          border: 3px solid #e0ba28;
          box-shadow: 0 18px 40px rgba(224, 186, 40, 0.20);
          flex-shrink: 0;
        }

        .brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .brand-kicker {
          margin: 0 0 4px;
          color: rgba(255,255,255,0.72);
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .brand-name {
          margin: 0;
          font-size: 25px;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .hero-title {
          margin: 0;
          font-size: clamp(38px, 5vw, 70px);
          line-height: 0.95;
          letter-spacing: -0.075em;
          font-weight: 950;
        }

        .gold-text {
          color: #e0ba28;
          text-shadow: 0 15px 50px rgba(224, 186, 40, 0.22);
        }

        .hero-subtitle {
          width: min(560px, 100%);
          margin: 24px 0 0;
          color: rgba(255,255,255,0.76);
          font-size: 17px;
          line-height: 1.7;
          font-weight: 650;
        }

        .hero-stats {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 34px;
        }

        .hero-stat {
          padding: 16px;
          border-radius: 22px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.12);
        }

        .hero-stat strong {
          display: block;
          font-size: 24px;
          font-weight: 950;
          margin-bottom: 4px;
        }

        .hero-stat span {
          color: rgba(255,255,255,0.68);
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .selected-store-preview {
          position: relative;
          z-index: 1;
          margin-top: 28px;
          padding: 22px;
          border-radius: 28px;
          background: linear-gradient(135deg, rgba(224, 186, 40, 0.22), rgba(255,255,255,0.10));
          border: 1px solid rgba(224, 186, 40, 0.35);
        }

        .selected-store-preview small {
          display: block;
          color: rgba(255,255,255,0.68);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 8px;
        }

        .selected-store-preview h2 {
          margin: 0;
          font-size: 24px;
          letter-spacing: -0.04em;
        }

        .selected-store-preview p {
          margin: 8px 0 0;
          color: rgba(255,255,255,0.74);
          font-weight: 700;
        }

        .login-panel {
          background: rgba(248, 250, 252, 0.96);
          color: #07182c;
          padding: 28px;
        }

        .login-top {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
          margin-bottom: 22px;
        }

        .login-top h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.05;
          letter-spacing: -0.055em;
          font-weight: 950;
          color: #07182c;
        }

        .secure-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          background: #ecfdf3;
          color: #027a48;
          border: 1px solid #bbf7d0;
          padding: 9px 12px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .login-help {
          margin: -8px 0 20px;
          color: #667085;
          font-weight: 700;
          line-height: 1.55;
        }

        .branch-section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 18px 0 10px;
        }

        .branch-section-title label {
          margin: 0;
          color: #07182c;
          font-weight: 950;
          font-size: 14px;
        }

        .branch-count {
          font-size: 12px;
          font-weight: 900;
          color: #475467;
          background: #eef2ff;
          border: 1px solid #dbe4ff;
          border-radius: 999px;
          padding: 6px 10px;
        }

        .branch-grid {
          display: grid;
          gap: 10px;
          margin-bottom: 18px;
        }

        .branch-card {
          width: 100%;
          text-align: left;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 20px;
          padding: 15px;
          cursor: pointer;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 12px;
          align-items: center;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
          color: #07182c;
        }

        .branch-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 35px rgba(15, 23, 42, 0.12);
          border-color: rgba(224, 186, 40, 0.55);
        }

        .branch-card.active {
          border-color: #e0ba28;
          box-shadow: 0 18px 42px rgba(224, 186, 40, 0.18);
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.16), rgba(255,255,255,1));
        }

        .branch-icon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          background: #07182c;
          color: #e0ba28;
          font-size: 22px;
          box-shadow: 0 10px 25px rgba(7, 24, 44, 0.14);
        }

        .branch-card.active .branch-icon {
          background: #e0ba28;
          color: #07182c;
        }

        .branch-info strong {
          display: block;
          font-size: 15px;
          font-weight: 950;
          letter-spacing: -0.02em;
          margin-bottom: 4px;
        }

        .branch-info span {
          display: block;
          color: #667085;
          font-size: 13px;
          font-weight: 750;
        }

        .branch-check {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          border: 2px solid #d0d5dd;
          color: transparent;
          font-weight: 950;
        }

        .branch-card.active .branch-check {
          color: #07182c;
          background: #e0ba28;
          border-color: #e0ba28;
        }

        .form-box {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          padding: 18px;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
        }

        .form-box label {
          display: block;
          margin: 0 0 7px;
          color: #344054;
          font-weight: 900;
          font-size: 13px;
        }

        .form-box input {
          width: 100%;
          border: 1px solid #d0d5dd;
          background: #f8fafc;
          border-radius: 15px;
          padding: 13px 14px;
          color: #07182c;
          font-weight: 750;
          outline: none;
          margin-bottom: 14px;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .form-box input:focus {
          background: #ffffff;
          border-color: #e0ba28;
          box-shadow: 0 0 0 4px rgba(224, 186, 40, 0.16);
        }

        .password-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: start;
        }

        .password-row input {
          margin-bottom: 14px;
        }

        .password-toggle {
          height: 47px;
          padding: 0 14px;
          border-radius: 15px;
          border: 1px solid #d0d5dd;
          background: #f2f4f7;
          color: #344054;
          font-weight: 900;
          cursor: pointer;
        }

        .login-main-button {
          width: 100%;
          border: none;
          border-radius: 17px;
          padding: 14px 16px;
          background: linear-gradient(135deg, #07182c, #0f2a48);
          color: white;
          font-size: 16px;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 18px 35px rgba(7, 24, 44, 0.23);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }

        .login-main-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 22px 45px rgba(7, 24, 44, 0.28);
        }

        .login-main-button:disabled {
          cursor: not-allowed;
          opacity: 0.72;
        }

        .forgot-button {
          width: 100%;
          margin-top: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 12px 14px;
          background: #f8fafc;
          color: #475467;
          font-weight: 900;
          cursor: pointer;
        }

        .forgot-button:hover {
          background: #eef2f7;
        }

        .error-box,
        .success-box,
        .warning-box {
          padding: 12px 13px;
          border-radius: 15px;
          margin-bottom: 14px;
          font-weight: 800;
          font-size: 13px;
          line-height: 1.45;
        }

        .error-box {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .success-box {
          background: #ecfdf3;
          color: #027a48;
          border: 1px solid #bbf7d0;
        }

        .warning-box {
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fed7aa;
        }

        .forgot-panel {
          margin-top: 16px;
          padding: 16px;
          border-radius: 22px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
        }

        .forgot-panel h3 {
          margin: 0 0 8px;
          color: #9a3412;
          font-weight: 950;
        }

        .forgot-panel p {
          margin: 0 0 12px;
          line-height: 1.55;
          font-weight: 700;
        }

        .forgot-panel input {
          width: 100%;
          border: 1px solid #fed7aa;
          background: #fffaf5;
          border-radius: 15px;
          padding: 13px 14px;
          color: #7c2d12;
          font-weight: 750;
          outline: none;
        }

        .forgot-action {
          width: 100%;
          margin-top: 10px;
          border: none;
          border-radius: 15px;
          padding: 12px 14px;
          background: #9a3412;
          color: #ffffff;
          font-weight: 900;
          cursor: pointer;
        }

        .forgot-cancel {
          width: 100%;
          margin-top: 10px;
          border: 1px solid #fed7aa;
          border-radius: 15px;
          padding: 12px 14px;
          background: #ffffff;
          color: #9a3412;
          font-weight: 900;
          cursor: pointer;
        }

        .login-footer {
          margin: 16px 0 0;
          color: #667085;
          font-size: 12px;
          font-weight: 750;
          text-align: center;
          line-height: 1.5;
        }

        @media (max-width: 980px) {
          .store-login-page {
            padding: 18px;
            align-items: flex-start;
          }

          .store-login-shell {
            grid-template-columns: 1fr;
          }

          .hero-panel {
            min-height: auto;
          }

          .hero-stats {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 560px) {
          .store-login-page {
            padding: 10px;
          }

          .hero-panel,
          .login-panel {
            border-radius: 24px;
            padding: 20px;
          }

          .brand-logo {
            width: 64px;
            height: 64px;
            border-radius: 18px;
          }

          .brand-name {
            font-size: 20px;
          }

          .hero-title {
            font-size: 39px;
          }

          .login-top {
            flex-direction: column;
          }

          .branch-card {
            grid-template-columns: auto 1fr;
          }

          .branch-check {
            display: none;
          }
        }
      `}</style>

      <div className="store-bg-grid" />
      <div className="store-orb one" />
      <div className="store-orb two" />
      <div className="store-orb three" />

      <main className="store-login-shell">
        <section className="hero-panel">
          <div className="hero-content">
            <div className="brand-row">
              <div className="brand-logo">
                <img src="/chalin03-logo.png" alt="Chalin 03 Logo" />
              </div>

              <div>
                <p className="brand-kicker">Sales • Stock • Audit</p>
                <h2 className="brand-name">Chalin 03 Company Ltd</h2>
              </div>
            </div>

            <h1 className="hero-title">
              Choose your <span className="gold-text">store</span>.
              <br />
              Control every record.
            </h1>

            <p className="hero-subtitle">
              A professional multi-store sales and inventory portal for Chalin
              03. Each branch keeps its own products, sales, debts, expenses,
              reports, and audit records.
            </p>
          </div>

          <div>
            <div className="hero-stats">
              <div className="hero-stat">
                <strong>2</strong>
                <span>Active Stores</span>
              </div>

              <div className="hero-stat">
                <strong>24/7</strong>
                <span>Secure Portal</span>
              </div>

              <div className="hero-stat">
                <strong>100%</strong>
                <span>Branch Records</span>
              </div>
            </div>

            <div className="selected-store-preview">
              <small>Selected Store</small>
              <h2>{selectedBranch?.name || "Choose a store"}</h2>
              <p>
                {selectedBranch?.location ||
                  "Select the branch you are working with before login."}
              </p>
            </div>
          </div>
        </section>

        <section className="login-panel">
          <div className="login-top">
            <div>
              <h1>Staff Portal</h1>
            </div>

            <div className="secure-badge">● Secure Login</div>
          </div>

          <p className="login-help">
            Select the store first, then enter your staff username and password.
          </p>

          <form onSubmit={handleLogin} autoComplete="off">
            <div className="branch-section-title">
              <label>Choose Store / Branch</label>
              <span className="branch-count">
                {branchesLoading ? "Loading..." : `${branches.length} stores`}
              </span>
            </div>

            {branchesError && <div className="error-box">{branchesError}</div>}

            {branchesLoading && (
              <div className="warning-box">Loading available stores...</div>
            )}

            {!branchesLoading && branches.length === 0 && !branchesError && (
              <div className="error-box">
                No active stores found. Please contact the system admin.
              </div>
            )}

            <div className="branch-grid">
              {branches.map((branch) => {
                const active = Number(selectedBranchId) === Number(branch.id);

                return (
                  <button
                    type="button"
                    key={branch.id}
                    className={`branch-card ${active ? "active" : ""}`}
                    onClick={() => setSelectedBranchId(String(branch.id))}
                  >
                    <div className="branch-icon">
                      {branch.is_head_office ? "🏢" : "🏬"}
                    </div>

                    <div className="branch-info">
                      <strong>{branch.name}</strong>
                      <span>{branch.location || "No location set"}</span>
                    </div>

                    <div className="branch-check">✓</div>
                  </button>
                );
              })}
            </div>

            <div className="form-box">
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
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <button
                type="submit"
                className="login-main-button"
                disabled={loading || branchesLoading || !branches.length}
              >
                {loading
                  ? "Opening store portal..."
                  : selectedBranch
                  ? `Login to ${selectedBranch.branch_code || "Store"}`
                  : "Login"}
              </button>

              <button
                type="button"
                className="forgot-button"
                onClick={openForgotPassword}
              >
                Forgot Password?
              </button>
            </div>
          </form>

          {showForgotPassword && (
            <div className="forgot-panel">
              <h3>Forgot Password</h3>

              <p>
                Enter your username. The system will guide you to contact the
                admin for a password reset.
              </p>

              {forgotMessage && <div className="success-box">{forgotMessage}</div>}
              {forgotError && <div className="error-box">{forgotError}</div>}

              <label>Username</label>
              <input
                value={forgotUsername}
                onChange={(event) => setForgotUsername(event.target.value)}
                placeholder="Enter your username"
                autoComplete="off"
              />

              <button
                type="button"
                className="forgot-action"
                onClick={handleForgotPassword}
                disabled={forgotLoading}
              >
                {forgotLoading ? "Checking..." : "Request Password Help"}
              </button>

              <button
                type="button"
                className="forgot-cancel"
                onClick={closeForgotPassword}
              >
                Cancel
              </button>
            </div>
          )}

          <p className="login-footer">
            Secure access for authorized Chalin 03 staff only. Every action is
            connected to the selected store.
          </p>
        </section>
      </main>
    </div>
  );
}