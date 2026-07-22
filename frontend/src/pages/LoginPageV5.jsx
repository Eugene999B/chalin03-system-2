import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { openEmergencyCommand } from "../components/EmergencyCommandOverlay";
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
  registerPasskey,
  saveStationMode,
  supportsPasskeys,
} from "../utils/commandGate";
import "../styles/commandGateV5.css";

const DEFAULT_WORKSPACE = "spare_parts";
const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

const FLOW_STEPS = [
  ["Identity confirmed", "Secure staff identity accepted"],
  ["Access verified", "Role and workspace permissions checked"],
  ["Device secured", "Passkey and device evidence confirmed"],
  ["Work restored", "Store, station and previous activity recovered"],
  ["Operations ready", "Opening the authorised workspace"],
];

const WORKSPACE_META = {
  spare_parts: { short: "Parts", tone: "gold" },
  mining: { short: "Mining", tone: "earth" },
  equipment_hire: { short: "Hire", tone: "blue" },
};

function WorkspaceIcon({ code }) {
  if (code === "mining") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 39h32M13 35l11-24 11 24M17 26h14M20 19h8M24 11v28M9 14l8 4M39 14l-8 4" /></svg>;
  }
  if (code === "equipment_hire") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="14" cy="36" r="5" /><circle cx="35" cy="36" r="5" /><path d="M7 31h30l4 5H7zM12 30V18h12l7 12M24 18l8-8 7 4-7 8M31 10l4-5M39 14l5-2" /></svg>;
  }
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 18h32v22H8zM12 18l4-9h16l4 9M8 25h32M18 25v15M30 25v15M21 13h6" /></svg>;
}

function FingerprintIcon() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 20c1-6 5-9 10-9 7 0 12 5 12 12 0 8-2 14-6 20M10 24c0-9 6-16 15-16 10 0 17 7 17 17M16 26c0-6 3-10 9-10 5 0 8 4 8 9 0 8-2 13-5 18M22 26c0-2 1-4 3-4s3 2 3 4c0 7-1 12-3 17M10 31c1 5 3 9 7 12" /></svg>;
}

function branchId(branch) { return Number(branch?.id || branch?.branch_id || 0); }
function branchName(branch) { return branch?.name || branch?.branch_name || "Store"; }
function branchCode(branch) { return branch?.code || branch?.branch_code || "STORE"; }
function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) return data.branches;
  if (Array.isArray(data?.stores)) return data.stores;
  return Array.isArray(data) ? data : [];
}
function roleLabel(user) {
  return String(user?.workspace_role || user?.role || "Authorised worker")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function promptCancelled(error) {
  const name = String(error?.name || "");
  return name.includes("NotAllowed") || name.includes("Abort");
}
function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Secure device";
  return `${/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "") ? "Mobile" : "Workstation"} · ${platform}`.slice(0, 120);
}
function persistPasskeySession(payload, workspaceCode) {
  const token = String(payload?.token || "").trim();
  if (!token || !payload?.user) throw new Error("The secure session response is incomplete.");
  const user = {
    ...payload.user,
    workspace_code: payload.user.workspace_code || payload?.workspace?.code || workspaceCode,
    active_workspace: payload.user.active_workspace || payload.workspace || null,
  };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { ...payload, token, user };
}
function passwordPolicyError(password) {
  const value = String(password || "");
  if (value.length < 8) return "New password must contain at least 8 characters.";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) return "Use uppercase and lowercase letters.";
  if (!/\d/.test(value)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Include at least one symbol.";
  return "";
}

export default function LoginPageV5() {
  const { isLoggedIn, login, user: activeUser, workspaceCode: activeWorkspaceCode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordRef = useRef(null);
  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [workspaceCode, setWorkspaceCode] = useState(requestedWorkspace?.code || DEFAULT_WORKSPACE);
  const workspace = getBusinessWorkspace(workspaceCode) || getBusinessWorkspace(DEFAULT_WORKSPACE);
  const isSpareParts = workspaceCode === DEFAULT_WORKSPACE;
  const [introVisible, setIntroVisible] = useState(true);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [stationCode, setStationCode] = useState(() => getSavedStationMode(requestedWorkspace?.code || DEFAULT_WORKSPACE));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [loadingMode, setLoadingMode] = useState("");
  const [postLoginProcessing, setPostLoginProcessing] = useState(false);
  const [error, setError] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [biometricState, setBiometricState] = useState(null);
  const [flowStage, setFlowStage] = useState(-1);
  const [flowUser, setFlowUser] = useState(null);
  const [flowDestination, setFlowDestination] = useState("");
  const [flowSecurity, setFlowSecurity] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState("request");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryShow, setRecoveryShow] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  const selectedBranch = useMemo(() => branches.find((branch) => branchId(branch) === Number(selectedBranchId)), [branches, selectedBranchId]);
  const stations = useMemo(() => getStationModes(workspaceCode), [workspaceCode]);
  const selectedStation = stations.find((station) => station.code === stationCode) || stations[0];
  const lastWork = getLastWork(workspaceCode);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroVisible(false), 1450);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const notice = sessionStorage.getItem("chalin03_login_notice");
    if (notice) {
      setError(notice);
      sessionStorage.removeItem("chalin03_login_notice");
    }
  }, []);
  useEffect(() => {
    if (requestedWorkspace?.code) setWorkspaceCode(requestedWorkspace.code);
  }, [requestedWorkspace?.code]);
  useEffect(() => {
    setStationCode(getSavedStationMode(workspaceCode));
    setEmergencyMode(false);
    setOptionsOpen(false);
    setError("");
  }, [workspaceCode]);
  useEffect(() => {
    let cancelled = false;
    if (!isSpareParts) {
      setBranchesLoading(false);
      setBranchesError("");
      setSelectedBranchId("");
      return () => { cancelled = true; };
    }
    async function loadBranches() {
      setBranchesLoading(true);
      setBranchesError("");
      try {
        const response = await axiosClient.get("/branches/public");
        const list = normalizeBranches(response.data);
        if (cancelled) return;
        setBranches(list);
        setSelectedBranchId((current) => list.some((branch) => branchId(branch) === Number(current)) ? current : list[0] ? String(branchId(list[0])) : "");
      } catch (requestError) {
        if (!cancelled) setBranchesError(requestError.response?.data?.message || "Could not load Spare Parts stores.");
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    }
    loadBranches();
    return () => { cancelled = true; };
  }, [isSpareParts]);

  if (isLoggedIn && !postLoginProcessing) {
    return <Navigate to={getPostLoginDestination({ user: activeUser, workspaceCode: activeWorkspaceCode, stationCode: getSavedStationMode(activeWorkspaceCode) })} replace />;
  }

  function chooseWorkspace(code) {
    if (!getBusinessWorkspace(code)) return;
    setWorkspaceCode(code);
    const params = new URLSearchParams(searchParams);
    if (code === DEFAULT_WORKSPACE) params.delete("workspace"); else params.set("workspace", code);
    setSearchParams(params, { replace: true });
  }
  function chooseStation(code) {
    setStationCode(saveStationMode(workspaceCode, code));
  }
  function validateContext(message) {
    setError("");
    setAttemptsRemaining(null);
    if (isSpareParts && !selectedBranchId) {
      setError(`Choose the Spare Parts store before ${message}.`);
      return false;
    }
    return true;
  }

  async function automaticDeviceSetup(currentPassword) {
    if (!supportsPasskeys()) return "unsupported";
    try {
      const response = await axiosClient.get("/auth/passkeys");
      const passkeys = Array.isArray(response.data?.passkeys) ? response.data.passkeys : [];
      if (passkeys.length > 0) return "already-ready";
      setBiometricState("enrolling");
      await registerPasskey({ currentPassword, displayName: deviceName() });
      setBiometricState("enrolled");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setBiometricState(null);
      return "registered";
    } catch (setupError) {
      setBiometricState(null);
      return promptCancelled(setupError) ? "skipped" : "unavailable";
    }
  }

  async function completeEntrance(session, securityStatus) {
    const user = session.user;
    const destination = getPostLoginDestination({ user, workspaceCode, stationCode, preferResume: stationCode === "auto" });
    if (emergencyMode) openEmergencyCommand(workspaceCode);
    sessionStorage.setItem("chalin03_command_arrival", JSON.stringify({
      workspaceCode,
      workspaceName: workspace.name,
      userName: user?.full_name || user?.username || "Authorised worker",
      role: roleLabel(user),
      destination,
      destinationLabel: describeResumePath(destination),
      deviceSetupStatus: securityStatus,
      createdAt: new Date().toISOString(),
    }));
    setFlowUser(user);
    setFlowDestination(destination);
    setFlowSecurity(securityStatus);
    setFlowStage(0);
    for (let index = 1; index < FLOW_STEPS.length; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      setFlowStage(index);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    window.location.assign(destination);
  }

  async function handlePasskeyLogin() {
    if (!validateContext("using secure device sign-in")) return;
    if (!supportsPasskeys()) {
      setError("This browser does not support secure device sign-in. Use your password.");
      return;
    }
    setLoadingMode("passkey");
    setPostLoginProcessing(true);
    setBiometricState("waiting");
    try {
      const response = await authenticateWithPasskey({
        workspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        collectDeviceEvidence: () => collectDeviceEvidence({ requestLocation: shareLocation }),
      });
      setBiometricState("verified");
      const result = persistPasskeySession(response, workspaceCode);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setBiometricState(null);
      await completeEntrance(result, "verified-now");
    } catch (requestError) {
      setBiometricState(null);
      setError(promptCancelled(requestError)
        ? "Device verification was cancelled. Try again or use your password."
        : requestError.response?.data?.message || requestError.message || "Secure device sign-in could not be completed.");
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();
    if (!validateContext("signing in")) return;
    if (!identifier.trim() || !password) {
      setError("Enter your username or phone number and password.");
      return;
    }
    setLoadingMode("password");
    setPostLoginProcessing(true);
    try {
      const evidence = await collectDeviceEvidence({ requestLocation: shareLocation });
      const result = await login({
        identifier: identifier.trim(), username: identifier.trim(), password,
        workspaceCode, branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence: evidence,
      });
      const setupStatus = await automaticDeviceSetup(password);
      await completeEntrance(result, setupStatus);
    } catch (requestError) {
      const data = requestError.response?.data || {};
      setAttemptsRemaining(Number.isInteger(Number(data.attempts_remaining)) ? Number(data.attempts_remaining) : null);
      setError(data.message || requestError.message || "Sign-in could not be completed.");
      setPassword("");
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function requestRecovery(event) {
    event.preventDefault();
    const value = (recoveryIdentifier || identifier).trim();
    setRecoveryError(""); setRecoveryMessage("");
    if (!value) { setRecoveryError("Enter your username or phone number."); return; }
    setRecoveryLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/request-otp", { identifier: value, username: value });
      setRecoveryIdentifier(value);
      setRecoveryMessage(response.data?.message || "Recovery code sent.");
      setRecoveryStage("verify");
    } catch (requestError) {
      setRecoveryError(requestError.response?.data?.message || "Password recovery is unavailable.");
    } finally { setRecoveryLoading(false); }
  }
  async function resetPassword(event) {
    event.preventDefault();
    setRecoveryError(""); setRecoveryMessage("");
    if (!/^\d{6}$/.test(recoveryCode.trim())) { setRecoveryError("Enter the 6-digit recovery code."); return; }
    const policyError = passwordPolicyError(recoveryPassword);
    if (policyError) { setRecoveryError(policyError); return; }
    if (recoveryPassword !== recoveryConfirm) { setRecoveryError("The new passwords do not match."); return; }
    setRecoveryLoading(true);
    try {
      const response = await axiosClient.post("/auth/recovery/reset-password", {
        identifier: recoveryIdentifier.trim(), username: recoveryIdentifier.trim(), otp: recoveryCode.trim(),
        new_password: recoveryPassword, confirm_password: recoveryConfirm,
      });
      setIdentifier(recoveryIdentifier.trim());
      setRecoveryMessage(response.data?.message || "Password changed successfully.");
      setRecoveryStage("complete");
      setRecoveryCode(""); setRecoveryPassword(""); setRecoveryConfirm("");
    } catch (requestError) {
      setRecoveryError(requestError.response?.data?.message || "Password recovery could not be completed.");
    } finally { setRecoveryLoading(false); }
  }
  function closeRecovery() {
    setRecoveryOpen(false); setRecoveryStage("request"); setRecoveryCode("");
    setRecoveryPassword(""); setRecoveryConfirm(""); setRecoveryMessage(""); setRecoveryError("");
  }

  const busy = Boolean(loadingMode);
  const contextLabel = isSpareParts
    ? selectedBranch ? `${branchCode(selectedBranch)} · ${branchName(selectedBranch)}` : "Choose store"
    : workspace.loginContextTitle;
  const destinationLabel = emergencyMode ? "Emergency Operations"
    : lastWork && stationCode === "auto" ? `Resume ${describeResumePath(lastWork)}` : selectedStation.title;

  return <main className={`gate5 gate5--${WORKSPACE_META[workspaceCode]?.tone || "gold"}`}>
    {introVisible && !isLoggedIn && <button type="button" className="gate5-intro" onClick={() => setIntroVisible(false)} aria-label="Continue to staff sign in">
      <div className="gate5-intro__halo" />
      <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
      <small>Chalin 03 Company Limited</small>
      <h1>Welcome to your business.</h1>
      <p>Preparing secure staff access</p>
      <div><i /></div>
    </button>}

    <div className="gate5__backdrop" />
    <section className="gate5__shell">
      <header className="gate5__brandbar">
        <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited logo" />
        <div><strong>Chalin 03 Company Limited</strong><small>Secure Business Access</small></div>
        <span><i /> Online</span>
      </header>

      <div className="gate5__body">
        <section className="gate5__welcome">
          <small>Protected staff portal</small>
          <h1>Welcome back.</h1>
          <p>Choose your operation and enter securely.</p>
          <div className="gate5__welcome-art">
            <span><img src="/chalin03-logo.png" alt="" /></span>
            <i className="gate5__orbit gate5__orbit--one" />
            <i className="gate5__orbit gate5__orbit--two" />
            {businessWorkspaces.map((item, index) => <b className={`gate5__node gate5__node--${index + 1}`} key={item.code}><WorkspaceIcon code={item.code} /></b>)}
          </div>
          <div className="gate5__trust"><span>✓ Role verified</span><span>✓ Workspace separated</span><span>✓ Actions audited</span></div>
        </section>

        <section className="gate5__card">
          <div className="gate5__card-head">
            <div><small>Staff sign in</small><h2>Choose your workspace</h2></div>
            <span>🔒</span>
          </div>

          <div className="gate5__workspaces">
            {businessWorkspaces.map((item) => {
              const selected = item.code === workspaceCode;
              return <button type="button" className={selected ? "is-selected" : ""} key={item.code} onClick={() => chooseWorkspace(item.code)} aria-pressed={selected}>
                <span><WorkspaceIcon code={item.code} /></span><strong>{WORKSPACE_META[item.code]?.short || item.shortName}</strong><i>{selected ? "✓" : ""}</i>
              </button>;
            })}
          </div>

          <div className="gate5__context">
            <span><WorkspaceIcon code={workspaceCode} /></span>
            <div><small>{workspace.name}</small><strong>{contextLabel}</strong></div>
            <em>{destinationLabel}</em>
          </div>

          {isSpareParts && <label className="gate5__field gate5__field--store"><span>Spare Parts store</span><select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} disabled={branchesLoading || busy}>
            <option value="">{branchesLoading ? "Loading stores…" : "Choose store"}</option>
            {branches.map((branch) => <option value={branchId(branch)} key={branchId(branch)}>{branchCode(branch)} — {branchName(branch)}</option>)}
          </select></label>}
          {branchesError && <div className="gate5__alert gate5__alert--error">{branchesError}</div>}

          <button type="button" className="gate5__biometric" onClick={handlePasskeyLogin} disabled={busy || branchesLoading}>
            <span><FingerprintIcon /></span><div><strong>{loadingMode === "passkey" ? "Waiting for secure verification…" : "Sign in with face or fingerprint"}</strong><small>Fresh verification is required every time</small></div><b>→</b>
          </button>

          <div className="gate5__divider"><span>or continue with password</span></div>
          <form onSubmit={handlePasswordLogin} className="gate5__form">
            <label className="gate5__field"><span>Username or phone number</span><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder="Enter username or phone" disabled={busy} /></label>
            <label className="gate5__field"><span>Password</span><div className="gate5__password"><input ref={passwordRef} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter password" disabled={busy} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div></label>
            <button className="gate5__submit" type="submit" disabled={busy || branchesLoading}><span>{loadingMode === "password" ? "◌" : "→"}</span><div><strong>{loadingMode === "password" ? "Signing in securely…" : "Sign in to Chalin 03"}</strong><small>Password access with automatic secure-device setup</small></div></button>
          </form>

          {error && <div className="gate5__alert gate5__alert--error" role="alert"><strong>Access protected</strong><span>{error}</span>{attemptsRemaining !== null && <small>{attemptsRemaining} attempt(s) remaining</small>}</div>}
          <div className="gate5__links"><button type="button" onClick={() => { setRecoveryIdentifier(identifier); setRecoveryOpen(true); }}>Recover password</button><button type="button" onClick={() => setOptionsOpen((value) => !value)}>Entry options {optionsOpen ? "−" : "+"}</button></div>

          {optionsOpen && <div className="gate5__options">
            <div><small>After sign-in</small><strong>{destinationLabel}</strong></div>
            <div className="gate5__stations">{stations.map((station) => <button type="button" key={station.code} className={station.code === stationCode ? "is-selected" : ""} onClick={() => chooseStation(station.code)}><span>{station.icon}</span><div><strong>{station.title}</strong><small>{station.description}</small></div></button>)}</div>
            <label><input type="checkbox" checked={shareLocation} onChange={(event) => setShareLocation(event.target.checked)} /> Include device location evidence when available</label>
            <label className="is-danger"><input type="checkbox" checked={emergencyMode} onChange={(event) => setEmergencyMode(event.target.checked)} /> Open protected Emergency Operations after sign-in</label>
          </div>}
        </section>
      </div>
    </section>

    {biometricState && <div className="gate5-bio" role="status" aria-live="polite"><div className={`gate5-bio__card is-${biometricState}`}>
      <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
      <div className="gate5-bio__finger"><FingerprintIcon /><i /></div>
      <small>Secure device sign-in</small>
      <h2>{biometricState === "verified" ? "Identity verified" : biometricState === "enrolled" ? "Device sign-in activated" : biometricState === "enrolling" ? "Set up secure sign-in" : "Verify to continue"}</h2>
      <p>{biometricState === "verified" ? "Your face, fingerprint or device PIN has been accepted." : biometricState === "enrolled" ? "This device can now use secure biometric sign-in." : biometricState === "enrolling" ? "Follow the device prompt to register face, fingerprint or device PIN." : "Use your face, fingerprint, Windows Hello or device PIN in the system prompt."}</p>
      <div className="gate5-bio__status"><i />{biometricState === "verified" || biometricState === "enrolled" ? "Secure verification complete" : "Waiting for device verification"}</div>
    </div></div>}

    {flowStage >= 0 && <div className="gate5-flow" role="status" aria-live="polite"><div className="gate5-flow__card">
      <header><img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" /><div><small>{workspace.name}</small><strong>Preparing your workspace</strong></div></header>
      <section><span><WorkspaceIcon code={workspaceCode} /></span><small>Welcome back</small><h2>{flowUser?.full_name || flowUser?.username || "Authorised worker"}</h2><p>{roleLabel(flowUser)}</p></section>
      <div className="gate5-flow__steps">{FLOW_STEPS.map(([title, detail], index) => <div className={index < flowStage ? "is-complete" : index === flowStage ? "is-active" : ""} key={title}><i>{index < flowStage ? "✓" : index + 1}</i><span><strong>{title}</strong><small>{detail}</small></span></div>)}</div>
      <footer><div><i style={{ width: `${((flowStage + 1) / FLOW_STEPS.length) * 100}%` }} /></div><strong>Opening {describeResumePath(flowDestination)}</strong><small>{flowSecurity === "verified-now" ? "Fresh device verification completed" : "Secure operational context prepared"}</small></footer>
    </div></div>}

    {recoveryOpen && <div className="gate5-modal" role="dialog" aria-modal="true" aria-label="Recover password"><div className="gate5-modal__card"><button type="button" className="gate5-modal__close" onClick={closeRecovery}>×</button><img src="/chalin03-logo.png" alt="" /><small>Secure account recovery</small><h2>{recoveryStage === "request" ? "Request recovery code" : recoveryStage === "verify" ? "Create a new password" : "Password changed"}</h2>
      {recoveryStage === "request" && <form onSubmit={requestRecovery}><label className="gate5__field"><span>Username or phone number</span><input value={recoveryIdentifier} onChange={(event) => setRecoveryIdentifier(event.target.value)} placeholder="Enter username or phone" /></label><button className="gate5__submit" type="submit" disabled={recoveryLoading}><span>→</span><div><strong>{recoveryLoading ? "Requesting code…" : "Send recovery code"}</strong></div></button></form>}
      {recoveryStage === "verify" && <form onSubmit={resetPassword}><label className="gate5__field"><span>Six-digit recovery code</span><input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" /></label><label className="gate5__field"><span>New password</span><div className="gate5__password"><input value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} type={recoveryShow ? "text" : "password"} placeholder="Create strong password" /><button type="button" onClick={() => setRecoveryShow((value) => !value)}>{recoveryShow ? "Hide" : "Show"}</button></div></label><label className="gate5__field"><span>Confirm password</span><input value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} type={recoveryShow ? "text" : "password" placeholder="Repeat new password" /></label><button className="gate5__submit" type="submit" disabled={recoveryLoading}><span>✓</span><div><strong>{recoveryLoading ? "Changing password…" : "Change password"}</strong></div></button></form>}
      {recoveryStage === "complete" && <button className="gate5__submit" type="button" onClick={closeRecovery}><span>✓</span><div><strong>Return to sign in</strong></div></button>}
      {recoveryMessage && <div className="gate5__alert gate5__alert--success">{recoveryMessage}</div>}{recoveryError && <div className="gate5__alert gate5__alert--error">{recoveryError}</div>}
    </div></div>}
  </main>;
}
