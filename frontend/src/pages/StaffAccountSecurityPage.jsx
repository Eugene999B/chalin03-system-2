import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import axiosClient from "../api/axiosClient";
import { APP_RELEASE_LABEL } from "../config/appVersion";
import "../styles/loginPasswordlessClassic.css";

const API = "/auth/passwordless";
const HOME = { spare_parts: "/", mining: "/mining", equipment_hire: "/equipment-hire-operations" };

function saveBackupPicture(codes) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1120;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image saving is unavailable on this device.");
  ctx.fillStyle = "#f6f7fa"; ctx.fillRect(0, 0, 1080, 1120);
  ctx.fillStyle = "#0c2343"; ctx.fillRect(0, 0, 1080, 176);
  ctx.fillStyle = "#fff"; ctx.font = "800 48px system-ui"; ctx.fillText("CHALIN 03", 60, 78);
  ctx.font = "25px system-ui"; ctx.fillText("Private one-time backup codes", 60, 135);
  ctx.fillStyle = "#1e4064"; ctx.font = "23px system-ui";
  ctx.fillText("Keep this picture private. Each recovery code works once.", 60, 240);
  codes.forEach((code, i) => {
    const col = i < 5 ? 0 : 1, row = i % 5, x = 60 + col * 490, y = 305 + row * 130;
    ctx.fillStyle = "#e6ebf3"; ctx.fillRect(x, y, 455, 92);
    ctx.fillStyle = "#17385f"; ctx.font = "800 33px monospace"; ctx.fillText(code, x + 20, y + 59);
  });
  ctx.fillStyle = "#966e26"; ctx.font = "23px system-ui";
  ctx.fillText("Do not share your codes or save this picture to a shared folder.", 60, 1030);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "CHALIN03-private-backup-codes.png";
  document.body.appendChild(a); a.click(); a.remove();
}

export default function StaffAccountSecurityPage() {
  const { isLoggedIn, loading, user, completePasswordlessLogin } = useAuth();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [googleStep, setGoogleStep] = useState(false);
  const [googleCode, setGoogleCode] = useState("");
  const initialStart = useRef(false);
  const back = HOME[user?.workspace_code] || "/";
  useEffect(() => {
    if (loading || !isLoggedIn) return;
    let active = true;
    Promise.all([axiosClient.get(API + "/mode"), axiosClient.get(API + "/account/status")])
      .then(async ([mode, result]) => {
        if (!active) return;
        setReady(mode.data?.pilot === true);
        setStatus(result.data);
        // A previously authenticated, original account owner needs no SMS.
        // Never issue a key from an unverified username typed on the public form.
        if (mode.data?.pilot && !result.data?.authenticator_active &&
          user?.is_original_system_administrator && !initialStart.current) {
          initialStart.current = true;
          try {
            const { data } = await axiosClient.post(API + "/administrator/start");
            if (active) { setPending(data); setNotice("Scan this QR code to add your account to Authenticator."); }
          } catch (err) {
            if (active) setError(err.response?.data?.message || "Confirm your identity from a recently signed-in session to finish setup.");
          }
        }
      })
      .catch(() => { if (active) { setReady(false); setStatus({ unavailable: true }); } });
    return () => { active = false; };
  }, [isLoggedIn, loading, user?.id, user?.is_original_system_administrator]);

  async function retrySetup() {
    setBusy(true); setError("");
    try {
      const { data } = await axiosClient.post(API + "/administrator/start");
      setPending(data); setCode(""); setNotice("Scan the code, then confirm using your Authenticator app.");
    } catch (err) {
      setError(err.response?.data?.message || "Setup needs a recently verified account session.");
    } finally { setBusy(false); }
  }
  async function activate(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      const { data } = await axiosClient.post(API + "/setup/confirm", { challenge: pending.challenge, code });
      if (!Array.isArray(data.recovery_codes) || data.recovery_codes.length !== 10) {
        throw new Error("Recovery codes were not returned. Contact support.");
      }
      completePasswordlessLogin(data, user?.workspace_code);
      setCodes(data.recovery_codes); setPending(null); setCode(""); setSaved(false);
      setStatus((v) => ({ ...v, authenticator_active: true }));
      setNotice("Authenticator is active. Save your backup codes before continuing.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "The code could not be verified.");
    } finally { setBusy(false); }
  }
  async function linkGoogle(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { data } = await axiosClient.post(API + "/google/start", { authenticator_code: googleCode });
      const destination = new URL(data.authorization_url);
      if (destination.origin !== "https://accounts.google.com") throw new Error("The Google address could not be verified.");
      window.location.assign(destination.href);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not connect your Google account.");
      setBusy(false);
    }
  }
  if (!loading && !isLoggedIn) return <Navigate to="/login" replace />;
  if (loading || !status) return <main className="gate4" role="status">Loading account security…</main>;
  return (
    <main className="gate4 group-login biometric-login gate4-passwordless">
      <section className="gate4__shell">
        <header className="gate4__topbar">
          <div className="gate4__brand"><div className="gate4__logo">
            <img src="/chalin03-logo.png" width="48" height="48" alt="" /></div>
            <div><small>Chalin 03 Company Limited</small><strong>Business Operating System</strong></div>
          </div>
          <div className="gate4__status"><span className="gate4__version">{APP_RELEASE_LABEL}</span>
            <span className="gate4__online"><i /> Online</span></div>
        </header>
        <div className="gate4__layout">
          <aside className="gate4__story group-login__story">
            <div className="gate4__story-copy">
              <small>Your staff account</small><h1>Private account. <span>Trusted access.</span></h1>
              <p>Keep your Authenticator and recovery codes safe. Your account permissions remain unchanged.</p>
            </div>
            <div className="gate4__story-foot"><span><i /> Secure sign in</span><span><i /> Private recovery codes</span></div>
          </aside>
          <section className="gate4__access">
            <div className="gate4__access-heading"><div><small>Personal settings</small>
              <h2>{pending ? "Set up Authenticator" : codes.length ? "Save your backup codes" : "Account security"}</h2>
              <p>{user?.full_name || user?.username} · {user?.username}</p>
            </div></div>
            <div className="gate4__divider"><span>My sign-in methods</span></div>
            {!pending && codes.length === 0 && (
              <div className="gpl-account-items">
                <div className="gpl-account-item"><div><strong>Authenticator</strong><small>
                  {status.authenticator_active ? "Active" : "Not set up yet"}</small></div>
                  <span>{status.authenticator_active ? "Enabled" : "Pending"}</span>
                </div>
                <div className="gpl-account-item"><div><strong>Google account</strong><small>
                  {status.google_linked ? status.google_email : status.google_linking_available
                    ? "Connect your Google account" : "Not available until Google sign-in is configured"}</small></div>
                  <span>{status.google_linked ? "Connected" : "Not linked"}</span>
                </div>
              </div>
            )}
            {ready && !status.authenticator_active && user?.is_original_system_administrator && !pending && !codes.length &&
              <button type="button" className="gate4__submit" onClick={retrySetup} disabled={busy}>
                <span>→</span><div><strong>{busy ? "Preparing…" : "Create my Authenticator key"}</strong>
                  <small>Confirm setup from this signed-in device</small></div>
              </button>}
            {pending && <form className="gate4__form" onSubmit={activate}>
              <div className="gpl-setup">
                <div className="gpl-setup__qr"><img src={pending.qr_data_url} alt="Authenticator setup QR code" width="210" height="210" /></div>
                <label className="gate4__field"><span>Manual setup key</span>
                  <div className="gpl-setup__key"><code>{pending.secret}</code>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(pending.secret)}>Copy</button>
                  </div></label>
              </div>
              <label className="gate4__field"><span>Current Authenticator code</span>
                <input type="text" value={code} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                  maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} />
              </label>
              <button type="submit" className="gate4__submit" disabled={busy || code.length !== 6}>
                <span>→</span><div><strong>{busy ? "Activating…" : "Activate Authenticator"}</strong>
                  <small>Recovery codes are saved next</small></div>
              </button>
            </form>}
            {codes.length > 0 && <div className="gpl-recovery">
              <div className="gpl-recovery__codes">{codes.map((value) => <code key={value}>{value}</code>)}</div>
              <button className="gpl-recovery__download" type="button"
                onClick={() => { try { saveBackupPicture(codes); } catch (e) { setError(e.message); } }}>
                <span aria-hidden="true">↓</span> Download codes as image
              </button>
              <label className="gpl-recovery__confirm"><input type="checkbox" checked={saved}
                onChange={(e) => setSaved(e.target.checked)} />I saved my backup codes privately.</label>
              <button className="gate4__submit" type="button" disabled={!saved}
                onClick={() => { setCodes([]); setNotice("Your Authenticator is ready."); }}>
                <span>→</span><div><strong>Finish setup</strong><small>Secure access enabled</small></div>
              </button>
            </div>}
            {ready && status.authenticator_active && !status.google_linked && status.google_linking_available &&
              <div className="gpl-google">
                {!googleStep ? <button type="button" className="gpl-recovery__download" onClick={() => setGoogleStep(true)}>Connect Google account</button> :
                  <form className="gate4__form" onSubmit={linkGoogle}>
                    <label className="gate4__field"><span>Confirm with your Authenticator</span>
                      <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                        maxLength={6} value={googleCode} onChange={(e) => setGoogleCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
                    </label>
                    <button type="submit" className="gate4__submit" disabled={busy || googleCode.length !== 6}>
                      <span>→</span><div><strong>Continue to Google</strong><small>Verify your Google account</small></div>
                    </button>
                    <button type="button" className="gpl-link" onClick={() => { setGoogleStep(false); setGoogleCode(""); }}>Cancel</button>
                  </form>}
              </div>}
            {notice && <div className="gpl-notice" role="status">{notice}</div>}
            {error && <div className="gate4__alert gate4__alert--error" role="alert">{error}</div>}
            {codes.length === 0 && <a className="gpl-link" href={back}>Back to my workspace</a>}
            <p className="gpl-privacy">Keep your account keys and recovery codes private.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
