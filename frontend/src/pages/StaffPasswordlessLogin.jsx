import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { businessWorkspaces, getBusinessWorkspace } from "../data/businessWorkspaces";
import { APP_RELEASE_LABEL } from "../config/appVersion";
import "../styles/loginPasswordlessClassic.css";

const API = "/auth/passwordless";
const HOME = { spare_parts: "/", mining: "/mining", equipment_hire: "/equipment-hire-operations" };
const branchId = (item) => Number(item?.id || item?.branch_id || 0);
const branchName = (item) => item?.name || item?.branch_name || "Store";
const branchCode = (item) => item?.code || item?.branch_code || "STORE";
const branchesFrom = (data) => Array.isArray(data?.branches) ? data.branches : Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
const messageFrom = (error) => error.response?.data?.message || "We couldn't verify your details. Please check and try again.";

function downloadRecoveryImage(codes) {
  if (!Array.isArray(codes) || codes.length !== 10) throw new Error("The recovery codes are not ready.");
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1120;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image saving is not available on this device.");
  ctx.fillStyle = "#f7f8fb"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0a2343"; ctx.fillRect(0, 0, canvas.width, 175);
  ctx.fillStyle = "#ffffff"; ctx.font = "800 48px system-ui"; ctx.fillText("CHALIN 03", 64, 84);
  ctx.font = "25px system-ui"; ctx.fillText("Private recovery codes", 64, 135);
  ctx.fillStyle = "#1a3454"; ctx.font = "25px system-ui";
  ctx.fillText("Each code works only once. Keep this picture somewhere private.", 64, 240);
  codes.forEach((code, i) => {
    const col = i < 5 ? 0 : 1, row = i % 5, x = 64 + col * 488, y = 307 + row * 130;
    ctx.fillStyle = "#e8edf5"; ctx.fillRect(x, y, 452, 96);
    ctx.fillStyle = "#092b52"; ctx.font = "800 33px ui-monospace, monospace";
    ctx.fillText(String(code), x + 22, y + 60);
  });
  ctx.fillStyle = "#9b7125"; ctx.font = "24px system-ui";
  ctx.fillText("Never share these codes. Do not store them on a shared device.", 64, 1030);
  const link = document.createElement("a");
  link.download = "CHALIN03-private-backup-codes.png";
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link); link.click(); link.remove();
}

function GroupOperationsMap() {
  return (
    <div className="group-operations-map" aria-label="Three connected Chalin 03 businesses">
      <svg viewBox="0 0 360 250" aria-hidden="true">
        <path d="M180 118 L82 58" /><path d="M180 118 L278 58" /><path d="M180 118 L180 210" />
      </svg>
      <div className="group-operations-map__centre">
        <img src="/chalin03-logo.png" alt="" /><strong>CHALIN 03</strong><small>GROUP</small>
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

export default function StaffPasswordlessLogin({ allowSignedInSetup = false }) {
  const { completePasswordlessLogin, isLoggedIn, user } = useAuth();
  const [workspaceCode, setWorkspaceCode] = useState(() => {
    const search = new URLSearchParams(window.location.search);
    return getBusinessWorkspace(search.get("workspace"))?.code || "spare_parts";
  });
  const workspace = getBusinessWorkspace(workspaceCode);
  const isSpareParts = workspaceCode === "spare_parts";
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [challenge, setChallenge] = useState("");
  const [oneTimeVerification, setOneTimeVerification] = useState("");
  const [step, setStep] = useState("identify");
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [pendingSession, setPendingSession] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationError, setVerificationError] = useState(null);
  const [remainingAttempts, setRemainingAttempts] = useState(null);
  const [verificationBlocked, setVerificationBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedBranch = useMemo(
    () => branches.find((item) => branchId(item) === Number(selectedBranchId)),
    [branches, selectedBranchId]
  );
  useEffect(() => {
    if (!isSpareParts) { setBranchesLoading(false); setBranchesError(""); return; }
    let active = true;
    setBranchesLoading(true);
    axiosClient.get("/branches/public")
      .then((response) => {
        if (!active) return;
        const entries = branchesFrom(response.data);
        setBranches(entries);
        setSelectedBranchId((current) => entries.some((item) => branchId(item) === Number(current))
          ? current : String(branchId(entries[0]) || ""));
        setBranchesError("");
      })
      .catch((e) => { if (active) setBranchesError(e.response?.data?.message || "Could not load the stores. Please retry."); })
      .finally(() => { if (active) setBranchesLoading(false); });
    return () => { active = false; };
  }, [isSpareParts]);

  function switchWorkspace(value) {
    if (step !== "identify" || !getBusinessWorkspace(value)) return;
    setWorkspaceCode(value);
    setError("");
    const url = new URL(window.location.href);
    if (value === "spare_parts") url.searchParams.delete("workspace");
    else url.searchParams.set("workspace", value);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  function reset() {
    setStep("identify"); setCode(""); setChallenge(""); setOneTimeVerification("");
    setSetup(null); setRecoveryCodes([]); setBackupMode(false);
    setPendingSession(null); setError(""); setNotice(""); setVerificationError(null); setRemainingAttempts(null); setVerificationBlocked(false);
  }
  async function submitIdentifier(event) {
    event.preventDefault();
    if (!identifier.trim() || (isSpareParts && !selectedBranchId)) return;
    setBusy(true); setError(""); setNotice(""); setVerificationError(null); setRemainingAttempts(null); setVerificationBlocked(false);
    try {
      const { data } = await axiosClient.post(API + (allowSignedInSetup ? "/start/verified" : "/start"), {
        identifier: identifier.trim(),
        workspace_code: workspaceCode,
        branch_id: isSpareParts ? Number(selectedBranchId) : null,
      });
      setChallenge(data.challenge); setCode(""); setBackupMode(false);
      if (data.stage === "identity") {
        setStep("identity");
        setNotice("Confirm ownership once to activate your Authenticator. Future sign-ins will not ask for this.");
        return;
      }
      if (data.stage === "sms") {
        setStep("sms"); setNotice("Enter the one-time message sent to your registered phone.");
      } else if (data.stage === "authenticator") {
        setStep("authenticator"); setNotice("Open your authenticator app and enter the current code.");
      } else if (data.stage === "setup") {
        setSetup(data); setStep("setup");
      } else throw new Error("We couldn't start secure sign-in. Please try again.");
    } catch (e) { setError(messageFrom(e)); }
    finally { setBusy(false); }
  }
  async function submitFirstSetupIdentity(event) {
    event.preventDefault();
    if (!oneTimeVerification || busy) return;
    setBusy(true); setError("");
    try {
      const { data } = await axiosClient.post(API + "/first-setup/verify", {
        challenge, verification: oneTimeVerification,
      });
      setOneTimeVerification("");
      if (data.stage !== "setup" || !data.qr_data_url || !data.secret) {
        throw new Error("Authenticator enrollment could not be started.");
      }
      setSetup(data); setStep("setup"); setCode("");
      setNotice("Account confirmed. Add CHALIN03 to your Authenticator app and enter its six-digit code.");
    } catch (error) {
      setOneTimeVerification("");
      setError(error.response?.data?.message || "Account confirmation failed. Check your existing credential and try again.");
    } finally { setBusy(false); }
  }

  async function submitSms(event) {
    event.preventDefault(); if (!/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      const { data } = await axiosClient.post(API + "/sms/verify", { challenge, code });
      setSetup(data); setStep("setup"); setCode("");
      setNotice("Add this account to your authenticator app. Then enter the current code.");
    } catch (e) { setError(messageFrom(e)); }
    finally { setBusy(false); }
  }
  function openWorkspace(data) {
    const result = completePasswordlessLogin(data, workspaceCode);
    window.location.assign(HOME[result.user?.workspace_code] || HOME[workspaceCode] || "/");
  }
  function updateCode(value) {
    setCode(value);
    if (!verificationBlocked) {
      setVerificationError(null);
      setError("");
    }
  }
  async function submitAuthenticator(event) {
    event.preventDefault(); if (!code.trim() || verificationBlocked) return;
    setBusy(true); setError(""); setVerificationError(null);
    try {
      const endpoint = step === "setup" ? "/setup/confirm" : "/verify";
      const { data } = await axiosClient.post(API + endpoint, { challenge, code: code.trim() });
      setCode("");
      if (step === "setup") {
        if (!Array.isArray(data.recovery_codes) || data.recovery_codes.length !== 10) {
          throw new Error("Recovery codes were not returned. Contact support before continuing.");
        }
        setPendingSession(data); setRecoveryCodes(data.recovery_codes);
        setStep("backup"); setSaved(false);
        setNotice("Save these codes now. They won't be displayed again.");
      } else openWorkspace(data);
    } catch (e) {
      const serverCode = e.response?.data?.code || "";
      const wrongCode = serverCode === "SECURITY_CODE_INCORRECT";
      const blockedCode = ["CODE_ATTEMPTS_EXHAUSTED", "RATE_LIMITED", "VERIFICATION_EXPIRED"].includes(serverCode);
      const displayMessage = wrongCode ? "Incorrect code. Check Google Authenticator, then enter the newest six-digit code."
        : blockedCode ? messageFrom(e) : e.response ? messageFrom(e) : e.message;
      setCode("");
      setVerificationError(displayMessage);
      setRemainingAttempts(Number.isInteger(e.response?.data?.attempts_remaining) ? e.response.data.attempts_remaining : null);
      setVerificationBlocked(blockedCode);
    } finally { setBusy(false); }
  }

  if (isLoggedIn && step !== "backup" && !allowSignedInSetup) {
    return <Navigate to={HOME[user?.workspace_code] || "/"} replace />;
  }
  const currentContext = isSpareParts
    ? selectedBranch ? branchCode(selectedBranch) + " · " + branchName(selectedBranch) : "Choose store"
    : workspace?.loginContextTitle || workspace?.name;
  const label = workspaceCode === "mining" ? "Mining Dashboard"
    : workspaceCode === "equipment_hire" ? "Equipment Sales & Hire Dashboard" : "Spare Parts Dashboard";
  const title = { identify: "Welcome back", identity: "Confirm your account", sms: "Verify your phone", setup: "Set up Authenticator",
    authenticator: "Enter your security code", backup: "Save your backup codes" }[step];
  const subtitle = { identify: "Select a business and continue.", identity: "A one-time identity check protects your first Authenticator key. No SMS is needed.", sms: "This check is only needed when you set up your account.",
    setup: "Scan the QR code or copy the setup key into your Authenticator app.",
    authenticator: "Enter the code from your Authenticator app to continue.",
    backup: "Keep a private copy of these one-time recovery codes." }[step];

  return (
    <main className={"gate4 group-login biometric-login gate4-passwordless group-login--" + workspaceCode}>
      <section className="gate4__shell">
        <header className="gate4__topbar">
          <div className="gate4__brand">
            <div className="gate4__logo"><img src="/chalin03-logo.png" width="48" height="48" alt="" /></div>
            <div><small>Chalin 03 Company Limited</small><strong>Business Operating System</strong></div>
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
              <p>Spare Parts, Mining Operations and Equipment Sales & Hire share one professional operating platform while keeping each business record, location and permission securely separated.</p>
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
              <div><small>Secure access</small><h2>{title}</h2><p>{subtitle}</p></div>
            </div>
            <div className="gate4__workspace-tabs" aria-label="Choose business workspace">
              {businessWorkspaces.map((item) => (
                <button type="button" key={item.code}
                  className={item.code === workspaceCode ? "is-selected" : ""}
                  onClick={() => switchWorkspace(item.code)}
                  disabled={step !== "identify" || busy}
                  aria-pressed={item.code === workspaceCode}>
                  <span>{item.icon}</span><strong>{item.shortName}</strong>
                  <i>{item.code === workspaceCode ? "✓" : ""}</i>
                </button>
              ))}
            </div>
            <div className="gate4__context-strip">
              <div className="gate4__context-icon">{workspace?.icon}</div>
              <div><small>{workspace?.name}</small><strong>{currentContext}</strong></div>
              <span>{label}</span>
            </div>
            {isSpareParts && step === "identify" && (
              <label className="gate4__field gate4__field--store">
                <span>Spare Parts store</span>
                <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}
                  disabled={branchesLoading || busy} required>
                  <option value="">{branchesLoading ? "Loading stores…" : "Choose store"}</option>
                  {branches.map((item) => <option key={branchId(item)} value={branchId(item)}>{branchCode(item)} — {branchName(item)}</option>)}
                </select>
              </label>
            )}
            {branchesError && step === "identify" && <div className="gate4__alert gate4__alert--error">{branchesError}</div>}

            <div className="gate4__divider"><span>{
              step === "identify" ? "Secure sign in" : step === "backup" ? "Keep your account safe" : "Identity verification"
            }</span></div>
            {step === "identify" && <form className="gate4__form" onSubmit={submitIdentifier}>
              <label className="gate4__field"><span>Username or phone number</span>
                <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username" placeholder="Enter username or phone" maxLength={120} required disabled={busy} />
              </label>
              <button type="submit" className="gate4__submit"
                disabled={busy || branchesLoading || !identifier.trim() || (isSpareParts && !selectedBranchId)}>
                <span>{busy ? "◌" : "→"}</span>
                <div><strong>{busy ? "Checking account…" : "Continue securely"}</strong>
                  <small>Use Authenticator or a one-time backup code</small></div>
              </button>
            </form>}

            {step === "identity" && <form className="gate4__form" onSubmit={submitFirstSetupIdentity}>
              <p className="gpl-notice">This is your first setup. Confirm that the account belongs to you using your existing sign-in credential. You won't need it after activating Authenticator.</p>
              <label className="gate4__field"><span>One-time account confirmation</span>
                <input type="password" value={oneTimeVerification} onChange={(e) => setOneTimeVerification(e.target.value)}
                  autoComplete="current-password" placeholder="Enter your existing credential" maxLength={256}
                  disabled={busy} required autoFocus />
              </label>
              <button type="submit" className="gate4__submit" disabled={busy || !oneTimeVerification}>
                <span>→</span><div><strong>{busy ? "Confirming account…" : "Create my Authenticator key"}</strong>
                  <small>No SMS. The next screen shows your private QR code.</small></div>
              </button>
            </form>}

            {step === "sms" && <form className="gate4__form" onSubmit={submitSms}>
              <label className="gate4__field"><span>SMS verification code</span>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6} disabled={busy} required />
              </label>
              <button type="submit" className="gate4__submit" disabled={busy || code.length !== 6}>
                <span>→</span><div><strong>{busy ? "Checking code…" : "Verify and continue"}</strong>
                  <small>One-time account verification</small></div>
              </button>
            </form>}

            {step === "setup" && <form className="gate4__form" onSubmit={submitAuthenticator}>
              <div className="gpl-step-label"><span>02</span><div><strong>Connect your Authenticator</strong><small>Scan the QR code, then confirm the new account.</small></div></div>
              <div className="gpl-setup">
                <div className="gpl-setup__qr"><img src={setup?.qr_data_url} width="210" height="210" alt="Scan to add CHALIN03 to your authenticator app" /></div>
                <label className="gate4__field"><span>Manual setup key</span>
                  <div className="gpl-setup__key"><code>{setup?.secret}</code>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(setup?.secret || "")}>Copy</button>
                  </div>
                </label>
              </div>
              <label className="gate4__field"><span>Current Authenticator code</span>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                  value={code} onChange={(e) => updateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6} disabled={busy || verificationBlocked} required aria-invalid={Boolean(verificationError)} aria-describedby={verificationError ? "gpl-verification-error" : undefined} />
              </label>
              {verificationError && <div className="gpl-code-feedback" id="gpl-verification-error" role="alert"><strong>Code not accepted</strong><p>{verificationError}</p>{remainingAttempts !== null && remainingAttempts > 0 && <small>{remainingAttempts} tries left in this verification.</small>}{verificationBlocked && <button type="button" onClick={reset}>Start again</button>}</div>}
              <p className="gpl-code-tip">The code changes every 30 seconds. Enter the newest one shown in your app.</p>
              <button type="submit" className="gate4__submit" disabled={busy || verificationBlocked || code.length !== 6}>
                <span>→</span><div><strong>{busy ? "Activating…" : "Activate Authenticator"}</strong>
                  <small>Save your recovery codes in the next step</small></div>
              </button>
            </form>}

            {step === "authenticator" && <form className="gate4__form" onSubmit={submitAuthenticator}>
              <div className="gpl-step-label"><span>02</span><div><strong>Verify it's you</strong><small>Your secure code stays on this screen until accepted.</small></div></div>
              <label className="gate4__field"><span>{backupMode ? "One-time backup code" : "Authenticator code"}</span>
                <input type="text" autoComplete="one-time-code" inputMode={backupMode ? "text" : "numeric"}
                  value={code} onChange={(e) => updateCode(backupMode ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24)
                    : e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={backupMode ? 24 : 6} placeholder={backupMode ? "Enter your saved recovery code" : "6-digit code"}
                  disabled={busy || verificationBlocked} required aria-invalid={Boolean(verificationError)} aria-describedby={verificationError ? "gpl-verification-error" : undefined} />
              </label>
              {verificationError && <div className="gpl-code-feedback" id="gpl-verification-error" role="alert"><strong>{verificationBlocked ? "Verification paused" : "Incorrect code"}</strong><p>{verificationError}</p>{remainingAttempts !== null && remainingAttempts > 0 && <small>{remainingAttempts} tries left in this verification.</small>}{verificationBlocked && <button type="button" onClick={reset}>Start again</button>}</div>}
              {!backupMode && <p className="gpl-code-tip">Codes change every 30 seconds. Use the latest one and check that your phone's time is automatic.</p>}
              <button type="submit" className="gate4__submit" disabled={busy || verificationBlocked || (backupMode ? code.replace(/[^A-Z0-9]/g, "").length < 10 : code.length !== 6)}>
                <span>→</span><div><strong>{busy ? "Verifying…" : "Sign in to Chalin 03"}</strong>
                  <small>Secure access to your business dashboard</small></div>
              </button>
              <button className="gpl-link" type="button" onClick={() => { setBackupMode(!backupMode); setCode(""); setVerificationError(null); setRemainingAttempts(null); }}>
                {backupMode ? "Use Authenticator instead" : "Use a backup code instead"}
              </button>
            </form>}

            {step === "backup" && <div className="gpl-recovery" aria-label="Your private backup codes">
              <div className="gpl-recovery__codes">{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
              <button type="button" className="gpl-recovery__download"
                onClick={() => { try { downloadRecoveryImage(recoveryCodes); } catch (e) { setError(e.message); } }}>
                <span aria-hidden="true">↓</span> Download codes as image
              </button>
              <label className="gpl-recovery__confirm">
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                I have saved my backup codes somewhere private.
              </label>
              <button type="button" className="gate4__submit" disabled={!saved || busy} onClick={() => openWorkspace(pendingSession)}>
                <span>→</span><div><strong>Open my dashboard</strong><small>Authenticator is ready</small></div>
              </button>
            </div>}

            {notice && <div className="gpl-notice" role="status">{notice}</div>}
            {error && <div className="gate4__alert gate4__alert--error" role="alert">
              <strong>We couldn't complete that step</strong><span>{error}</span>
            </div>}
            {step !== "identify" && step !== "backup" && <button type="button" className="gpl-link gpl-link--back" onClick={reset}>
              ← Back to sign in
            </button>}
            <p className="gpl-privacy">Keep your Authenticator key and recovery codes private.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
