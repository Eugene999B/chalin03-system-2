import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { businessWorkspaces, getBusinessWorkspace } from "../data/businessWorkspaces";
import { collectDeviceEvidence } from "../utils/deviceEvidence";
import {
  authenticateWithBiometric,
  clearStoredBiometricBinding,
  getStoredBiometricBinding,
  isBiometricAccessAvailable,
  registerBiometricDevice,
  validateStoredBiometricBinding,
} from "../utils/biometricAccess";
import { APP_RELEASE_LABEL } from "../config/appVersion";
import "../styles/commandGateV4.css";
import "../styles/commandGateBankPolish.css";
import "../styles/biometricBankLogin.css";
import "../styles/groupOperationsLogin.css";

const DEFAULT_WORKSPACE = "spare_parts";
const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";
const DASHBOARD_PATHS = {
  spare_parts: "/",
  mining: "/mining",
  equipment_hire: "/equipment-hire-operations",
};

function dashboardPath(workspaceCode) {
  return DASHBOARD_PATHS[workspaceCode] || DASHBOARD_PATHS.spare_parts;
}

function dashboardLabel(workspaceCode) {
  if (workspaceCode === "mining") return "Mining Dashboard";
  if (workspaceCode === "equipment_hire") return "Equipment Sales & Hire Dashboard";
  return "Spare Parts Dashboard";
}

function branchId(branch) {
  return Number(branch?.id || branch?.branch_id || 0);
}

function branchName(branch) {
  return branch?.name || branch?.branch_name || "Store";
}

function branchCode(branch) {
  return branch?.code || branch?.branch_code || "STORE";
}

function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) return data.branches;
  if (Array.isArray(data?.stores)) return data.stores;
  return Array.isArray(data) ? data : [];
}

function deviceName() {
  const platform =
    navigator.userAgentData?.platform || navigator.platform || "Personal device";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  return `${mobile ? "Mobile" : "Computer"} · ${platform}`.slice(0, 120);
}

function promptCancelled(error) {
  const name = String(error?.name || "");
  return name.includes("NotAllowed") || name.includes("Abort");
}

function passwordPolicyError(password) {
  const value = String(password || "");
  if (value.length < 8) return "New password must contain at least 8 characters.";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) {
    return "Use uppercase and lowercase letters.";
  }
  if (!/\d/.test(value)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Include at least one symbol.";
  return "";
}

function persistBiometricSession(payload, fallbackWorkspaceCode) {
  const token = String(payload?.token || "").trim();
  const rawUser = payload?.user;
  if (!token || !rawUser) throw new Error("The secure login response is incomplete.");

  const user = {
    ...rawUser,
    workspace_code:
      rawUser.workspace_code || payload?.workspace?.code || fallbackWorkspaceCode,
    active_workspace: rawUser.active_workspace || payload?.workspace || null,
  };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { ...payload, token, user };
}

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 20c1-6 5-9 10-9 7 0 12 5 12 12 0 8-2 14-6 20" />
      <path d="M10 24c0-9 6-16 15-16 10 0 17 7 17 17" />
      <path d="M16 26c0-6 3-10 9-10 5 0 8 4 8 9 0 8-2 13-5 18" />
      <path d="M22 26c0-2 1-4 3-4s3 2 3 4c0 7-1 12-3 17M10 31c1 5 3 9 7 12" />
    </svg>
  );
}

function GroupOperationsMap() {
  return (
    <div className="group-operations-map" aria-label="Three connected Chalin 03 businesses">
      <svg viewBox="0 0 360 250" aria-hidden="true">
        <path d="M180 118 L82 58" />
        <path d="M180 118 L278 58" />
        <path d="M180 118 L180 210" />
      </svg>
      <div className="group-operations-map__centre">
        <img src="/chalin03-logo.png" alt="" />
        <strong>CHALIN 03</strong>
        <small>GROUP</small>
      </div>
      <div className="group-operations-map__node is-parts">
        <span>🧰</span><strong>Spare Parts</strong><small>Sales & inventory</small>
      </div>
      <div className="group-operations-map__node is-mining">
        <span>⛏️</span><strong>Mining</strong><small>Site operations</small>
      </div>
      <div className="group-operations-map__node is-hire">
        <span>🚜</span><strong>Sales & Hire</strong><small>Equipment operations</small>
      </div>
    </div>
  );
}

export default function LoginPageGroupOperations() {
  const {
    isLoggedIn,
    login,
    workspaceCode: activeWorkspaceCode,
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordRef = useRef(null);
  const passwordFieldName = `chalin03-entry-${useId().replace(/:/g, "")}`;

  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [workspaceCode, setWorkspaceCode] = useState(
    requestedWorkspace?.code || DEFAULT_WORKSPACE
  );
  const workspace =
    getBusinessWorkspace(workspaceCode) || getBusinessWorkspace(DEFAULT_WORKSPACE);
  const isSpareParts = workspaceCode === DEFAULT_WORKSPACE;

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordUnlocked, setPasswordUnlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [loadingMode, setLoadingMode] = useState("");
  const [postLoginProcessing, setPostLoginProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);

  const [bindingLoading, setBindingLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBinding, setBiometricBinding] = useState(null);
  const [pendingSession, setPendingSession] = useState(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [consentLoading, setConsentLoading] = useState(false);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState("request");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  const selectedBranch = useMemo(
    () => branches.find((branch) => branchId(branch) === Number(selectedBranchId)),
    [branches, selectedBranchId]
  );

  useEffect(() => {
    function clearPasswordField() {
      setPassword("");
      setShowPassword(false);
      setPasswordUnlocked(false);
      if (passwordRef.current) passwordRef.current.value = "";
    }

    clearPasswordField();
    window.addEventListener("pageshow", clearPasswordField);
    return () => window.removeEventListener("pageshow", clearPasswordField);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function inspectDevice() {
      setBindingLoading(true);
      try {
        const available = await isBiometricAccessAvailable();
        if (cancelled) return;
        setBiometricAvailable(available);

        if (!available) {
          setBiometricBinding(null);
          return;
        }

        const result = await validateStoredBiometricBinding();
        if (!cancelled) setBiometricBinding(result.valid ? result.stored : null);
      } catch {
        if (!cancelled) {
          setBiometricAvailable(false);
          setBiometricBinding(null);
        }
      } finally {
        if (!cancelled) setBindingLoading(false);
      }
    }

    inspectDevice();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (requestedWorkspace?.code) setWorkspaceCode(requestedWorkspace.code);
  }, [requestedWorkspace?.code]);

  useEffect(() => {
    setAdvancedOpen(false);
    setEmergencyMode(false);
    setError("");
    setPassword("");
    setPasswordUnlocked(false);
  }, [workspaceCode]);

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
          if (list.some((branch) => branchId(branch) === Number(current))) {
            return current;
          }
          return list[0] ? String(branchId(list[0])) : "";
        });
      } catch (requestError) {
        if (!cancelled) {
          setBranchesError(
            requestError.response?.data?.message ||
              "Could not load Spare Parts stores. Check the internet connection."
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

  if (isLoggedIn && !postLoginProcessing) {
    return <Navigate to={dashboardPath(activeWorkspaceCode)} replace />;
  }

  function chooseWorkspace(code) {
    if (!getBusinessWorkspace(code)) return;
    setWorkspaceCode(code);
    const params = new URLSearchParams(searchParams);
    if (code === DEFAULT_WORKSPACE) params.delete("workspace");
    else params.set("workspace", code);
    setSearchParams(params, { replace: true });
  }

  async function completeEntrance(session, securityStatus) {
    const destination = dashboardPath(workspaceCode);

    sessionStorage.setItem(
      "chalin03_command_arrival",
      JSON.stringify({
        workspaceCode,
        workspaceName: workspace.name,
        userName: session.user?.full_name || session.user?.username,
        destination,
        destinationLabel: dashboardLabel(workspaceCode),
        deviceSetupStatus: securityStatus,
        emergencyMode,
        createdAt: new Date().toISOString(),
      })
    );

    setProgressMessage("Identity verified. Opening your dashboard…");
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    window.location.assign(destination);
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();
    setError("");
    setAttemptsRemaining(null);
    setProgressMessage("");

    if (isSpareParts && !selectedBranchId) {
      setError("Choose the Spare Parts store before signing in.");
      return;
    }
    if (!identifier.trim() || !password) {
      setError("Enter your username or phone number and password.");
      return;
    }

    setLoadingMode("password");
    setPostLoginProcessing(true);

    try {
      const evidence = await collectDeviceEvidence({ requestLocation: shareLocation });
      const result = await login({
        identifier: identifier.trim(),
        username: identifier.trim(),
        password,
        workspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence: evidence,
      });

      setPassword("");
      setPasswordUnlocked(false);
      const sameBoundAccount =
        Number(biometricBinding?.account?.id || 0) === Number(result.user?.id || 0);

      if (biometricAvailable && !sameBoundAccount) {
        setPendingSession(result);
        setConsentOpen(true);
        setConsentError("");
        setLoadingMode("");
        return;
      }

      await completeEntrance(
        result,
        sameBoundAccount ? "biometric-already-linked" : "password-only"
      );
    } catch (requestError) {
      const data = requestError.response?.data || {};
      setAttemptsRemaining(
        Number.isInteger(Number(data.attempts_remaining))
          ? Number(data.attempts_remaining)
          : null
      );
      setError(data.message || requestError.message || "Sign-in could not be completed.");
      setPassword("");
      setPasswordUnlocked(false);
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function handleBiometricLogin() {
    setError("");
    setProgressMessage("");

    if (isSpareParts && !selectedBranchId) {
      setError("Choose the Spare Parts store before using fingerprint or face login.");
      return;
    }
    if (!biometricAvailable || !biometricBinding) {
      setError("Use the account password on this device.");
      return;
    }

    setLoadingMode("biometric");
    setPostLoginProcessing(true);
    setProgressMessage("Verify your fingerprint or face on this device…");

    try {
      const evidence = await collectDeviceEvidence({ requestLocation: shareLocation });
      const response = await authenticateWithBiometric({
        workspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence: evidence,
      });
      const result = persistBiometricSession(response, workspaceCode);
      await completeEntrance(result, "biometric-verified");
    } catch (requestError) {
      const code = requestError.response?.data?.code || requestError.code;
      if (
        code === "BIOMETRIC_DEVICE_REVOKED" ||
        code === "BIOMETRIC_BINDING_REQUIRED"
      ) {
        clearStoredBiometricBinding();
        setBiometricBinding(null);
      }
      setError(
        promptCancelled(requestError)
          ? "Fingerprint or face verification was cancelled. Use your password to continue."
          : requestError.response?.data?.message ||
              requestError.message ||
              "Fingerprint or face login could not be completed."
      );
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function acceptBiometricSetup() {
    setConsentLoading(true);
    setConsentError("");
    try {
      const binding = await registerBiometricDevice({ displayName: deviceName() });
      setBiometricBinding(binding);
      setConsentOpen(false);
      await completeEntrance(pendingSession, "biometric-registered");
    } catch (setupError) {
      setConsentError(
        promptCancelled(setupError)
          ? "Fingerprint or face setup was cancelled. Choose Not now to continue."
          : setupError.response?.data?.message ||
              setupError.message ||
              "Fingerprint or face setup could not be completed."
      );
    } finally {
      setConsentLoading(false);
    }
  }

  async function skipBiometricSetup() {
    setConsentOpen(false);
    await completeEntrance(pendingSession, "biometric-not-now");
  }

  async function requestRecovery(event) {
    event.preventDefault();
    const value = (recoveryIdentifier || identifier).trim();
    setRecoveryError("");
    setRecoveryMessage("");
    if (!value) {
      setRecoveryError("Enter your username or phone number.");
      return;
    }

    setRecoveryLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/request-otp", {
        identifier: value,
        username: value,
      });
      setRecoveryIdentifier(value);
      setRecoveryMessage(response.data?.message || "Recovery code sent.");
      setRecoveryStage("verify");
    } catch (requestError) {
      setRecoveryError(
        requestError.response?.data?.message || "Password recovery is unavailable."
      );
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setRecoveryError("");
    const policyError = passwordPolicyError(recoveryPassword);
    if (!/^\d{6}$/.test(recoveryCode.trim())) {
      setRecoveryError("Enter the 6-digit recovery code.");
      return;
    }
    if (policyError) {
      setRecoveryError(policyError);
      return;
    }
    if (recoveryPassword !== recoveryConfirm) {
      setRecoveryError("The new passwords do not match.");
      return;
    }

    setRecoveryLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/reset-password", {
        identifier: recoveryIdentifier.trim(),
        username: recoveryIdentifier.trim(),
        otp: recoveryCode.trim(),
        new_password: recoveryPassword,
        confirm_password: recoveryConfirm,
      });
      clearStoredBiometricBinding();
      setBiometricBinding(null);
      setIdentifier(recoveryIdentifier.trim());
      setRecoveryMessage(response.data?.message || "Password changed successfully.");
      setRecoveryStage("complete");
      setRecoveryCode("");
      setRecoveryPassword("");
      setRecoveryConfirm("");
    } catch (requestError) {
      setRecoveryError(
        requestError.response?.data?.message ||
          "Password recovery could not be completed."
      );
    } finally {
      setRecoveryLoading(false);
    }
  }

  const busy = Boolean(loadingMode);
  const contextLabel = isSpareParts
    ? selectedBranch
      ? `${branchCode(selectedBranch)} · ${branchName(selectedBranch)}`
      : "Choose store"
    : workspace.loginContextTitle;
  const boundAccountName =
    biometricBinding?.account?.full_name || biometricBinding?.account?.username || "";

  return (
    <main className={`gate4 biometric-login group-login group-login--${workspaceCode}`}>
      <section className="gate4__shell">
        <header className="gate4__topbar">
          <div className="gate4__brand">
            <div className="gate4__logo"><span>C03</span></div>
            <div>
              <small>Chalin 03 Company Limited</small>
              <strong>Business Operating System</strong>
            </div>
          </div>
          <div className="gate4__status">
            <span className="gate4__version">{APP_RELEASE_LABEL}</span>
            <span className="gate4__online"><i /> Online</span>
          </div>
        </header>

        <div className="gate4__layout">
          <aside className="gate4__story group-login__story">
            <div className="gate4__story-copy">
              <small>Chalin 03 Group Operations</small>
              <h1>One company. <span>Three connected businesses.</span></h1>
              <p>
                Spare Parts, Mining Operations and Equipment Sales & Hire share one
                professional operating platform while keeping each business record,
                location and permission securely separated.
              </p>
            </div>
            <GroupOperationsMap />
            <div className="gate4__story-foot">
              <span><i /> One secure staff account</span>
              <span><i /> Separate business records</span>
              <span><i /> Dashboard first after every login</span>
            </div>
          </aside>

          <section className="gate4__access">
            <div className="gate4__access-heading">
              <div>
                <small>Secure access</small>
                <h2>Welcome back</h2>
                <p>Select a business and continue.</p>
              </div>
            </div>

            <div className="gate4__workspace-tabs" aria-label="Choose business workspace">
              {businessWorkspaces.map((item) => (
                <button
                  type="button"
                  key={item.code}
                  className={item.code === workspaceCode ? "is-selected" : ""}
                  onClick={() => chooseWorkspace(item.code)}
                  aria-pressed={item.code === workspaceCode}
                >
                  <span>{item.icon}</span>
                  <strong>{item.shortName}</strong>
                  <i>{item.code === workspaceCode ? "✓" : ""}</i>
                </button>
              ))}
            </div>

            <div className="gate4__context-strip">
              <div className="gate4__context-icon">{workspace.icon}</div>
              <div><small>{workspace.name}</small><strong>{contextLabel}</strong></div>
              <span>{dashboardLabel(workspaceCode)}</span>
            </div>

            {isSpareParts && (
              <label className="gate4__field gate4__field--store">
                <span>Spare Parts store</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) => setSelectedBranchId(event.target.value)}
                  disabled={branchesLoading || busy}
                >
                  <option value="">
                    {branchesLoading ? "Loading stores…" : "Choose store"}
                  </option>
                  {branches.map((branch) => (
                    <option value={branchId(branch)} key={branchId(branch)}>
                      {branchCode(branch)} — {branchName(branch)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {branchesError && (
              <div className="gate4__alert gate4__alert--error">{branchesError}</div>
            )}

            {!bindingLoading && biometricAvailable && biometricBinding && (
              <button
                type="button"
                className="gate4__passkey biometric-login__continue"
                onClick={handleBiometricLogin}
                disabled={busy || branchesLoading}
              >
                <span className="gate4__passkey-icon"><FingerprintIcon /></span>
                <div>
                  <strong>
                    {loadingMode === "biometric"
                      ? "Verify on this device…"
                      : `Continue as ${boundAccountName}`}
                  </strong>
                  <small>Use fingerprint or face for this account only</small>
                </div>
                <b>→</b>
              </button>
            )}

            <div className="gate4__divider">
              <span>
                {biometricAvailable && biometricBinding
                  ? "or use password"
                  : "password required on this device"}
              </span>
            </div>

            <form onSubmit={handlePasswordLogin} className="gate4__form" autoComplete="off">
              <label className="gate4__field">
                <span>Username or phone number</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  placeholder="Enter username or phone"
                  disabled={busy}
                />
              </label>

              <label className="gate4__field">
                <span>Password</span>
                <div className="gate4__password">
                  <input
                    ref={passwordRef}
                    name={passwordFieldName}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onFocus={() => {
                      if (!passwordUnlocked) {
                        setPassword("");
                        setPasswordUnlocked(true);
                      }
                    }}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    readOnly={!passwordUnlocked}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    placeholder="Enter password"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <button
                className="gate4__submit"
                type="submit"
                disabled={busy || branchesLoading}
              >
                <span>{loadingMode === "password" ? "◌" : "→"}</span>
                <div>
                  <strong>
                    {loadingMode === "password"
                      ? progressMessage || "Signing in securely…"
                      : "Sign in to Chalin 03"}
                  </strong>
                  <small>Your password is never pre-filled by Chalin 03</small>
                </div>
              </button>
            </form>

            {progressMessage && busy && (
              <div className="gate4__progress-message" role="status">
                <i /><span>{progressMessage}</span>
              </div>
            )}
            {error && (
              <div className="gate4__alert gate4__alert--error" role="alert">
                <strong>Access protected</strong>
                <span>{error}</span>
                {attemptsRemaining !== null && (
                  <small>{attemptsRemaining} attempt(s) remaining</small>
                )}
              </div>
            )}

            <div className="gate4__quick-links">
              <button
                type="button"
                onClick={() => {
                  setRecoveryIdentifier(identifier);
                  setRecoveryOpen(true);
                }}
              >
                Recover password
              </button>
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                Privacy options {advancedOpen ? "−" : "+"}
              </button>
            </div>

            {advancedOpen && (
              <div className="gate4__advanced">
                <div className="group-login__dashboard-note">
                  <strong>Dashboard-first entry</strong>
                  <small>
                    Every successful login opens the selected business dashboard before
                    any other operation.
                  </small>
                </div>
                <label className="gate4__check">
                  <input
                    type="checkbox"
                    checked={shareLocation}
                    onChange={(event) => setShareLocation(event.target.checked)}
                  />
                  <span>Include device location evidence when available</span>
                </label>
                <label className="gate4__check gate4__check--danger">
                  <input
                    type="checkbox"
                    checked={emergencyMode}
                    onChange={(event) => setEmergencyMode(event.target.checked)}
                  />
                  <span>Open protected Emergency Operations after dashboard entry</span>
                </label>
              </div>
            )}
          </section>
        </div>
      </section>

      {consentOpen && biometricAvailable && (
        <div
          className="biometric-consent"
          role="dialog"
          aria-modal="true"
          aria-labelledby="biometric-consent-title"
        >
          <div className="biometric-consent__card">
            <div className="biometric-consent__icon"><FingerprintIcon /></div>
            <small>Successful password login</small>
            <h2 id="biometric-consent-title">
              Use fingerprint or face on this device?
            </h2>
            <p>
              This device will be linked only to <strong>
                {pendingSession?.user?.full_name || pendingSession?.user?.username}
              </strong>. Future sign-ins on this browser can use its built-in
              fingerprint or face verification.
            </p>
            {getStoredBiometricBinding()?.account && (
              <div className="biometric-consent__notice">
                Setting this up replaces the previous local account link on this browser.
              </div>
            )}
            {consentError && (
              <div className="gate4__alert gate4__alert--error">{consentError}</div>
            )}
            <button
              type="button"
              className="biometric-consent__accept"
              onClick={acceptBiometricSetup}
              disabled={consentLoading}
            >
              {consentLoading
                ? "Waiting for device verification…"
                : "Set up fingerprint or face"}
            </button>
            <button
              type="button"
              className="biometric-consent__skip"
              onClick={skipBiometricSetup}
              disabled={consentLoading}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {recoveryOpen && (
        <div className="biometric-consent" role="dialog" aria-modal="true">
          <div className="biometric-consent__card">
            <small>Account recovery</small><h2>Reset your password</h2>
            {recoveryStage === "request" && (
              <form onSubmit={requestRecovery}>
                <input
                  value={recoveryIdentifier}
                  onChange={(event) => setRecoveryIdentifier(event.target.value)}
                  placeholder="Username or phone number"
                />
                <button className="biometric-consent__accept" disabled={recoveryLoading}>
                  {recoveryLoading ? "Sending…" : "Send recovery code"}
                </button>
              </form>
            )}
            {recoveryStage === "verify" && (
              <form onSubmit={resetPassword}>
                <input
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                />
                <input
                  value={recoveryPassword}
                  onChange={(event) => setRecoveryPassword(event.target.value)}
                  placeholder="New password"
                  type="password"
                  autoComplete="new-password"
                />
                <input
                  value={recoveryConfirm}
                  onChange={(event) => setRecoveryConfirm(event.target.value)}
                  placeholder="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                />
                <button className="biometric-consent__accept" disabled={recoveryLoading}>
                  {recoveryLoading ? "Changing…" : "Change password"}
                </button>
              </form>
            )}
            {recoveryStage === "complete" && (
              <div className="biometric-consent__notice">{recoveryMessage}</div>
            )}
            {recoveryMessage && recoveryStage !== "complete" && (
              <div className="biometric-consent__notice">{recoveryMessage}</div>
            )}
            {recoveryError && (
              <div className="gate4__alert gate4__alert--error">{recoveryError}</div>
            )}
            <button
              type="button"
              className="biometric-consent__skip"
              onClick={() => {
                setRecoveryOpen(false);
                setRecoveryStage("request");
                setRecoveryError("");
                setRecoveryMessage("");
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
