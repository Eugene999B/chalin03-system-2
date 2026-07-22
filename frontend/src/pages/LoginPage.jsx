import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { businessWorkspaces, getBusinessWorkspace } from "../data/businessWorkspaces";
import { collectDeviceEvidence } from "../utils/deviceEvidence";
import {
  authenticateWithPasskey,
  describeResumePath,
  getLastWork,
  getPostLoginDestination,
  getSavedStationMode,
  getStationModes,
  saveStationMode,
  supportsPasskeys,
} from "../utils/commandGate";
import { APP_RELEASE_LABEL } from "../config/appVersion";
import "../styles/appVersion.css";
import "../styles/commandGate.css";

const DEFAULT_WORKSPACE = "spare_parts";

const WORKSPACE_VISUALS = {
  spare_parts: {
    code: "SP",
    eyebrow: "Inventory command",
    atmosphere: "warehouse",
    signal: "Stock, sales and customer operations",
  },
  mining: {
    code: "MN",
    eyebrow: "Site command",
    atmosphere: "mining",
    signal: "Production, fuel and equipment operations",
  },
  equipment_hire: {
    code: "EH",
    eyebrow: "Commercial command",
    atmosphere: "hire",
    signal: "Enquiries, contracts and dispatch operations",
  },
};

const EMERGENCY_ROUTES = {
  spare_parts: "/emergency-operations",
  mining: "/mining/emergency-operations",
  equipment_hire: "/equipment-hire-operations/emergency-operations",
};

const COMMAND_CHECKS = [
  "Secure channel established",
  "Identity verified",
  "Workspace access confirmed",
  "Operating context recovered",
];

function getBranchId(branch) {
  return Number(branch?.id || branch?.branch_id || 0);
}

function getBranchCode(branch) {
  return branch?.code || branch?.branch_code || "STORE";
}

function getBranchName(branch) {
  return branch?.name || branch?.branch_name || "Store";
}

function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) return data.branches;
  if (Array.isArray(data?.stores)) return data.stores;
  return Array.isArray(data) ? data : [];
}

function strongPasswordError(password) {
  const text = String(password || "");
  if (text.length < 8) return "New password must be at least 8 characters long.";
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "New password must include uppercase and lowercase letters.";
  }
  if (!/\d/.test(text)) return "New password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(text)) return "New password must include at least one symbol.";
  return "";
}

function friendlyRole(user) {
  return String(user?.workspace_role || user?.role || "Authorised worker")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function LoginPage() {
  const { establishSession, isLoggedIn, login, user: activeUser, workspaceCode } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordInputRef = useRef(null);

  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState(
    requestedWorkspace?.code || DEFAULT_WORKSPACE
  );
  const selectedWorkspace =
    getBusinessWorkspace(selectedWorkspaceCode) || getBusinessWorkspace(DEFAULT_WORKSPACE);
  const visual = WORKSPACE_VISUALS[selectedWorkspaceCode] || WORKSPACE_VISUALS.spare_parts;
  const isSpareParts = selectedWorkspaceCode === DEFAULT_WORKSPACE;

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sharePreciseLocation, setSharePreciseLocation] = useState(true);
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [stationPanelOpen, setStationPanelOpen] = useState(false);
  const [stationCode, setStationCode] = useState(() =>
    getSavedStationMode(requestedWorkspace?.code || DEFAULT_WORKSPACE)
  );
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [loadingMode, setLoadingMode] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [commandStage, setCommandStage] = useState(-1);
  const [commandUser, setCommandUser] = useState(null);
  const [commandDestination, setCommandDestination] = useState("");

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotStage, setForgotStage] = useState("request");
  const [forgotUsername, setForgotUsername] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [showRecoveryPasswords, setShowRecoveryPasswords] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");

  const selectedBranch = useMemo(
    () => branches.find((branch) => getBranchId(branch) === Number(selectedBranchId)),
    [branches, selectedBranchId]
  );
  const stationModes = useMemo(
    () => getStationModes(selectedWorkspaceCode),
    [selectedWorkspaceCode]
  );
  const selectedStation = stationModes.find((item) => item.code === stationCode) || stationModes[0];
  const lastWork = getLastWork(selectedWorkspaceCode);

  useEffect(() => {
    setPasskeyReady(supportsPasskeys());
    const notice = sessionStorage.getItem("chalin03_login_notice");
    if (notice) {
      setError(notice);
      sessionStorage.removeItem("chalin03_login_notice");
    }
  }, []);

  useEffect(() => {
    if (requestedWorkspace?.code) setSelectedWorkspaceCode(requestedWorkspace.code);
  }, [requestedWorkspace?.code]);

  useEffect(() => {
    let cancelled = false;
    if (!isSpareParts) {
      setBranchesLoading(false);
      setBranchesError("");
      setSelectedBranchId("");
      return () => {
        cancelled = true;
      };
    }

    async function loadBranches() {
      setBranchesLoading(true);
      setBranchesError("");
      try {
        const response = await axiosClient.get("/branches/public");
        const list = normalizeBranches(response.data);
        if (cancelled) return;
        setBranches(list);
        setSelectedBranchId((current) => {
          if (list.some((branch) => getBranchId(branch) === Number(current))) return current;
          return list[0] ? String(getBranchId(list[0])) : "";
        });
      } catch (requestError) {
        if (!cancelled) {
          setBranchesError(
            requestError.response?.data?.message ||
              "Could not load Spare Parts stores. Check the backend connection."
          );
        }
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    }

    loadBranches();
    return () => {
      cancelled = true;
    };
  }, [isSpareParts]);

  useEffect(() => {
    setStationCode(getSavedStationMode(selectedWorkspaceCode));
    setEmergencyMode(false);
    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
  }, [selectedWorkspaceCode]);

  if (isLoggedIn) {
    const destination = getPostLoginDestination({
      user: activeUser,
      workspaceCode,
      stationCode: getSavedStationMode(workspaceCode),
    });
    return <Navigate to={destination} replace />;
  }

  function validateContext() {
    if (isSpareParts && !selectedBranchId) {
      setError("Choose a Spare Parts store before entering Command Gate.");
      return false;
    }
    return true;
  }

  function selectWorkspace(code) {
    const workspace = getBusinessWorkspace(code);
    if (!workspace) return;
    setSelectedWorkspaceCode(code);
    const nextParams = new URLSearchParams(searchParams);
    if (code === DEFAULT_WORKSPACE) nextParams.delete("workspace");
    else nextParams.set("workspace", code);
    setSearchParams(nextParams, { replace: true });
  }

  function chooseStation(code) {
    const saved = saveStationMode(selectedWorkspaceCode, code);
    setStationCode(saved);
    setStationPanelOpen(false);
  }

  async function finishCommand(sessionPayload) {
    const authenticatedUser = sessionPayload.user;
    const destination = emergencyMode
      ? EMERGENCY_ROUTES[selectedWorkspaceCode]
      : getPostLoginDestination({
          user: authenticatedUser,
          workspaceCode: selectedWorkspaceCode,
          stationCode,
          preferResume: stationCode === "auto",
        });

    setCommandUser(authenticatedUser);
    setCommandDestination(destination);
    setCommandStage(0);
    for (let index = 1; index < COMMAND_CHECKS.length; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 115));
      setCommandStage(index);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    navigate(destination, { replace: true });
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();
    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
    if (!validateContext()) return;
    if (!username.trim() || !password) {
      setError("Enter your username or phone number and password.");
      return;
    }

    setLoadingMode("password");
    try {
      const deviceEvidence = await collectDeviceEvidence({ requestLocation: sharePreciseLocation });
      const result = await login({
        identifier: username.trim(),
        username: username.trim(),
        password,
        workspaceCode: selectedWorkspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence,
      });
      await finishCommand(result);
    } catch (requestError) {
      const data = requestError.response?.data || {};
      setErrorCode(data.code || "");
      setAttemptsRemaining(
        Number.isInteger(Number(data.attempts_remaining))
          ? Number(data.attempts_remaining)
          : null
      );
      setError(data.message || requestError.message || "Identity verification failed.");
      setPassword("");
    } finally {
      setLoadingMode("");
    }
  }

  async function handlePasskeyLogin() {
    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
    if (!validateContext()) return;
    if (!passkeyReady) {
      setError("Device unlock requires a supported browser on a secure connection.");
      setPasswordPanelOpen(true);
      return;
    }

    setLoadingMode("passkey");
    try {
      const result = await authenticateWithPasskey({
        workspaceCode: selectedWorkspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        collectDeviceEvidence: () =>
          collectDeviceEvidence({ requestLocation: sharePreciseLocation }),
      });
      establishSession(result);
      await finishCommand(result);
    } catch (requestError) {
      const data = requestError.response?.data || {};
      const cancelled = String(requestError.name || "").includes("NotAllowed");
      setErrorCode(data.code || "");
      setError(
        cancelled
          ? "Device verification was cancelled. Use Unlock again or open password login."
          : data.message || requestError.message || "Device unlock could not be verified."
      );
      if (data.code === "NO_PASSKEYS_REGISTERED") setPasswordPanelOpen(true);
    } finally {
      setLoadingMode("");
    }
  }

  async function requestRecoveryCode(event) {
    event.preventDefault();
    const identifier = (forgotUsername || username).trim();
    setForgotError("");
    setForgotMessage("");
    if (!identifier) {
      setForgotError("Enter your username or phone number.");
      return;
    }
    setForgotLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/request-otp", {
        identifier,
        username: identifier,
      });
      setForgotUsername(identifier);
      setForgotMessage(response.data?.message || "Recovery code requested.");
      setForgotStage("verify");
    } catch (requestError) {
      setForgotError(
        requestError.response?.data?.message || "Password recovery is temporarily unavailable."
      );
    } finally {
      setForgotLoading(false);
    }
  }

  async function resetRecoveredPassword(event) {
    event.preventDefault();
    setForgotError("");
    setForgotMessage("");
    const identifier = forgotUsername.trim();
    const cleanCode = recoveryCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setForgotError("Enter the 6-digit recovery code.");
      return;
    }
    const policyError = strongPasswordError(recoveryNewPassword);
    if (policyError) {
      setForgotError(policyError);
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setForgotError("New password and confirmation do not match.");
      return;
    }

    setForgotLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/reset-password", {
        identifier,
        username: identifier,
        otp: cleanCode,
        new_password: recoveryNewPassword,
        confirm_password: recoveryConfirmPassword,
      });
      setUsername(identifier);
      setForgotMessage(response.data?.message || "Password changed successfully.");
      setForgotStage("complete");
      setRecoveryCode("");
      setRecoveryNewPassword("");
      setRecoveryConfirmPassword("");
    } catch (requestError) {
      setForgotError(
        requestError.response?.data?.message || "Password recovery could not be completed."
      );
    } finally {
      setForgotLoading(false);
    }
  }

  const busy = Boolean(loadingMode);
  const contextTitle = isSpareParts
    ? selectedBranch
      ? `${getBranchCode(selectedBranch)} · ${getBranchName(selectedBranch)}`
      : "Choose your store"
    : selectedWorkspace.loginContextTitle;

  return (
    <main className={`command-gate command-gate--${visual.atmosphere}`}>
      <div className="command-gate__grid" aria-hidden="true" />
      <div className="command-gate__scan" aria-hidden="true" />
      <div className="premium-version-badge">{APP_RELEASE_LABEL}</div>

      <section className="command-gate__shell">
        <header className="command-gate__header">
          <div className="command-gate__brand">
            <div className="command-gate__mark">C03</div>
            <div>
              <span>Chalin 03 Company Limited</span>
              <strong>Command Gate</strong>
            </div>
          </div>
          <div className="command-gate__online"><i /> System online</div>
        </header>

        <div className="command-gate__hero">
          <div>
            <p className="command-gate__kicker">One identity. Three businesses. Instant command.</p>
            <h1>Your business is ready.<br /><span>Identify yourself.</span></h1>
            <p className="command-gate__lead">
              Chalin recognises the business, operating context and station you need before a menu opens.
            </p>
          </div>
          <div className="command-gate__signal-card">
            <span>{visual.eyebrow}</span>
            <strong>{selectedWorkspace.name}</strong>
            <p>{visual.signal}</p>
          </div>
        </div>

        <section className="command-gate__workspace-zone" aria-label="Business workspace">
          {businessWorkspaces.map((workspace) => {
            const selected = workspace.code === selectedWorkspaceCode;
            const cardVisual = WORKSPACE_VISUALS[workspace.code];
            return (
              <button
                className={`command-sector ${selected ? "is-selected" : ""}`}
                type="button"
                key={workspace.code}
                onClick={() => selectWorkspace(workspace.code)}
                aria-pressed={selected}
              >
                <span className="command-sector__code">{cardVisual.code}</span>
                <span className="command-sector__copy">
                  <small>{cardVisual.eyebrow}</small>
                  <strong>{workspace.name}</strong>
                  <em>{workspace.description}</em>
                </span>
                <span className="command-sector__state">{selected ? "Selected" : "Standby"}</span>
              </button>
            );
          })}
        </section>

        <section className="command-gate__console">
          <div className="command-gate__context">
            <span>Operating context</span>
            <strong>{contextTitle}</strong>
            <p>{selectedWorkspace.loginContextMessage}</p>
            {isSpareParts && (
              <label className="command-field command-field--select">
                <span>Spare Parts store</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) => setSelectedBranchId(event.target.value)}
                  disabled={branchesLoading || busy}
                >
                  <option value="">{branchesLoading ? "Loading stores…" : "Choose store"}</option>
                  {branches.map((branch) => (
                    <option value={getBranchId(branch)} key={getBranchId(branch)}>
                      {getBranchCode(branch)} — {getBranchName(branch)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {branchesError && <div className="command-alert command-alert--error">{branchesError}</div>}
          </div>

          <div className="command-gate__access">
            <div className="command-gate__resume">
              <div>
                <span>Entrance profile</span>
                <strong>{emergencyMode ? "Emergency Operations" : selectedStation.title}</strong>
                <p>
                  {emergencyMode
                    ? "Open a protected, task-focused emergency interface after authentication."
                    : lastWork && stationCode === "auto"
                    ? `Resume: ${describeResumePath(lastWork)}`
                    : selectedStation.description}
                </p>
              </div>
              <button type="button" onClick={() => setStationPanelOpen((open) => !open)}>
                Change
              </button>
            </div>

            {stationPanelOpen && (
              <div className="station-picker">
                {stationModes.map((station) => (
                  <button
                    type="button"
                    key={station.code}
                    className={station.code === stationCode ? "is-active" : ""}
                    onClick={() => chooseStation(station.code)}
                  >
                    <span>{station.icon}</span>
                    <div><strong>{station.title}</strong><small>{station.description}</small></div>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="command-unlock"
              onClick={handlePasskeyLogin}
              disabled={busy || branchesLoading}
            >
              <span className="command-unlock__icon">◎</span>
              <span><strong>{loadingMode === "passkey" ? "Verifying device…" : "Unlock Chalin 03"}</strong><small>Fingerprint, face, Windows Hello or device PIN</small></span>
              <b>→</b>
            </button>

            <div className="command-gate__secondary-row">
              <button type="button" onClick={() => setPasswordPanelOpen((open) => !open)}>
                Password login
              </button>
              <button
                type="button"
                className={emergencyMode ? "is-active" : ""}
                onClick={() => setEmergencyMode((active) => !active)}
              >
                Emergency operations
              </button>
              <button type="button" onClick={() => {
                setForgotUsername(username);
                setShowForgotPassword(true);
              }}>
                Recovery
              </button>
            </div>

            {passwordPanelOpen && (
              <form className="password-console" onSubmit={handlePasswordLogin}>
                <label className="command-field">
                  <span>Username or phone number</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    disabled={busy}
                  />
                </label>
                <label className="command-field">
                  <span>Password</span>
                  <div className="command-password-input">
                    <input
                      ref={passwordInputRef}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      disabled={busy}
                    />
                    <button type="button" onClick={() => setShowPassword((show) => !show)}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <label className="command-checkbox">
                  <input
                    type="checkbox"
                    checked={sharePreciseLocation}
                    onChange={(event) => setSharePreciseLocation(event.target.checked)}
                  />
                  <span>Include device location evidence when available</span>
                </label>
                <button className="password-console__submit" type="submit" disabled={busy}>
                  {loadingMode === "password" ? "Establishing secure session…" : "Enter with password"}
                </button>
              </form>
            )}

            {error && (
              <div className="command-alert command-alert--error" role="alert">
                <strong>{errorCode === "ACCOUNT_LOCKED" ? "Workspace protected" : "Command not granted"}</strong>
                <span>{error}</span>
                {attemptsRemaining !== null && <small>{attemptsRemaining} attempt(s) remaining</small>}
              </div>
            )}
          </div>
        </section>

        <footer className="command-gate__footer">
          <span>Passkey-ready secure entrance</span>
          <span>Password fallback preserved</span>
          <span>Workspace isolation active</span>
        </footer>
      </section>

      {commandStage >= 0 && (
        <div className="command-sequence" role="status" aria-live="polite">
          <div className="command-sequence__panel">
            <div className="command-sequence__seal">C03</div>
            <p>Welcome back</p>
            <h2>{commandUser?.full_name || commandUser?.username || "Authorised worker"}</h2>
            <strong>{selectedWorkspace.name} · {friendlyRole(commandUser)}</strong>
            <div className="command-sequence__checks">
              {COMMAND_CHECKS.map((check, index) => (
                <span className={index <= commandStage ? "is-complete" : ""} key={check}>
                  <i>{index <= commandStage ? "✓" : "·"}</i>{check}
                </span>
              ))}
            </div>
            <small>Opening {emergencyMode ? "Emergency Operations" : describeResumePath(commandDestination)}</small>
            <b>Command granted</b>
          </div>
        </div>
      )}

      {showForgotPassword && (
        <div className="command-modal" role="dialog" aria-modal="true" aria-label="Account recovery">
          <div className="command-modal__card">
            <button className="command-modal__close" type="button" onClick={() => setShowForgotPassword(false)}>×</button>
            <span className="command-modal__eyebrow">Secure recovery</span>
            <h2>Recover your Chalin account</h2>
            {forgotStage === "request" && (
              <form onSubmit={requestRecoveryCode}>
                <label className="command-field">
                  <span>Username or phone number</span>
                  <input value={forgotUsername} onChange={(event) => setForgotUsername(event.target.value)} />
                </label>
                <button className="password-console__submit" disabled={forgotLoading} type="submit">
                  {forgotLoading ? "Requesting…" : "Send recovery code"}
                </button>
              </form>
            )}
            {forgotStage === "verify" && (
              <form onSubmit={resetRecoveredPassword}>
                <label className="command-field"><span>6-digit recovery code</span><input value={recoveryCode} inputMode="numeric" maxLength={6} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, ""))} /></label>
                <label className="command-field"><span>New password</span><input type={showRecoveryPasswords ? "text" : "password"} value={recoveryNewPassword} onChange={(event) => setRecoveryNewPassword(event.target.value)} /></label>
                <label className="command-field"><span>Confirm new password</span><input type={showRecoveryPasswords ? "text" : "password"} value={recoveryConfirmPassword} onChange={(event) => setRecoveryConfirmPassword(event.target.value)} /></label>
                <label className="command-checkbox"><input type="checkbox" checked={showRecoveryPasswords} onChange={(event) => setShowRecoveryPasswords(event.target.checked)} /><span>Show recovery passwords</span></label>
                <button className="password-console__submit" disabled={forgotLoading} type="submit">{forgotLoading ? "Verifying…" : "Reset password"}</button>
              </form>
            )}
            {forgotStage === "complete" && (
              <button className="password-console__submit" type="button" onClick={() => setShowForgotPassword(false)}>Return to Command Gate</button>
            )}
            {forgotMessage && <div className="command-alert command-alert--success">{forgotMessage}</div>}
            {forgotError && <div className="command-alert command-alert--error">{forgotError}</div>}
          </div>
        </div>
      )}
    </main>
  );
}
