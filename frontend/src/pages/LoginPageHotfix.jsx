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
import { APP_RELEASE_LABEL } from "../config/appVersion";
import "../styles/appVersion.css";
import "../styles/commandGateHotfix.css";

const DEFAULT_WORKSPACE = "spare_parts";
const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

const COMMAND_CHECKS = [
  "Secure session established",
  "Workspace access verified",
  "Device security checked",
  "Working context recovered",
];

const WORKSPACE_THEMES = {
  spare_parts: {
    className: "gate2--spare",
    badge: "Inventory & Sales",
    accent: "#f2c94c",
  },
  mining: {
    className: "gate2--mining",
    badge: "Site Operations",
    accent: "#f2994a",
  },
  equipment_hire: {
    className: "gate2--hire",
    badge: "Commercial Operations",
    accent: "#56ccf2",
  },
};

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

function roleLabel(user) {
  return String(user?.workspace_role || user?.role || "Authorised worker")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Device";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  return `${mobile ? "Mobile" : "Workstation"} · ${platform}`.slice(0, 120);
}

function promptCancelled(error) {
  const name = String(error?.name || "");
  return name.includes("NotAllowed") || name.includes("Abort");
}

function persistPasskeySession(payload, fallbackWorkspaceCode) {
  const token = String(payload?.token || "").trim();
  const rawUser = payload?.user;

  if (!token || !rawUser) {
    throw new Error("The secure session response is incomplete.");
  }

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

export default function LoginPageHotfix() {
  const { isLoggedIn, login, user: activeUser, workspaceCode: activeWorkspaceCode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordRef = useRef(null);

  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [workspaceCode, setWorkspaceCode] = useState(
    requestedWorkspace?.code || DEFAULT_WORKSPACE
  );
  const workspace =
    getBusinessWorkspace(workspaceCode) || getBusinessWorkspace(DEFAULT_WORKSPACE);
  const theme = WORKSPACE_THEMES[workspaceCode] || WORKSPACE_THEMES.spare_parts;
  const isSpareParts = workspaceCode === DEFAULT_WORKSPACE;

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [stationCode, setStationCode] = useState(() =>
    getSavedStationMode(requestedWorkspace?.code || DEFAULT_WORKSPACE)
  );
  const [stationOpen, setStationOpen] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [loadingMode, setLoadingMode] = useState("");
  const [postLoginProcessing, setPostLoginProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [sequenceStage, setSequenceStage] = useState(-1);
  const [sequenceUser, setSequenceUser] = useState(null);
  const [sequenceDestination, setSequenceDestination] = useState("");

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

  const selectedBranch = useMemo(
    () => branches.find((branch) => branchId(branch) === Number(selectedBranchId)),
    [branches, selectedBranchId]
  );
  const stations = useMemo(() => getStationModes(workspaceCode), [workspaceCode]);
  const selectedStation =
    stations.find((station) => station.code === stationCode) || stations[0];
  const lastWork = getLastWork(workspaceCode);

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
    setError("");
    setProgressMessage("");
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
          if (list.some((branch) => branchId(branch) === Number(current))) return current;
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
    const destination = getPostLoginDestination({
      user: activeUser,
      workspaceCode: activeWorkspaceCode,
      stationCode: getSavedStationMode(activeWorkspaceCode),
    });
    return <Navigate to={destination} replace />;
  }

  function chooseWorkspace(code) {
    const nextWorkspace = getBusinessWorkspace(code);
    if (!nextWorkspace) return;

    setWorkspaceCode(code);
    const params = new URLSearchParams(searchParams);
    if (code === DEFAULT_WORKSPACE) params.delete("workspace");
    else params.set("workspace", code);
    setSearchParams(params, { replace: true });
  }

  function chooseStation(code) {
    const saved = saveStationMode(workspaceCode, code);
    setStationCode(saved);
    setStationOpen(false);
  }

  async function automaticDeviceSetup(currentPassword) {
    if (!supportsPasskeys()) return "unsupported";

    try {
      setProgressMessage("Checking this device for fingerprint or device-PIN access…");
      const response = await axiosClient.get("/auth/passkeys");
      const passkeys = Array.isArray(response.data?.passkeys)
        ? response.data.passkeys
        : [];

      if (passkeys.length > 0) {
        setProgressMessage("Trusted device access is already ready.");
        return "already-ready";
      }

      setProgressMessage(
        "Complete the device security prompt to enable fingerprint, face, Windows Hello or device PIN."
      );
      await registerPasskey({
        currentPassword,
        displayName: deviceName(),
      });
      setProgressMessage("This device is now ready for secure access.");
      return "registered";
    } catch (setupError) {
      if (promptCancelled(setupError)) {
        setProgressMessage("Device setup was skipped. Password login remains available.");
        return "skipped";
      }

      setProgressMessage("Device setup is unavailable now. Password login remains available.");
      return "unavailable";
    }
  }

  async function completeEntrance(session, deviceSetupStatus) {
    const user = session.user;
    const destination = getPostLoginDestination({
      user,
      workspaceCode,
      stationCode,
      preferResume: stationCode === "auto",
    });

    if (emergencyMode) openEmergencyCommand(workspaceCode);

    sessionStorage.setItem(
      "chalin03_command_arrival",
      JSON.stringify({
        workspaceCode,
        workspaceName: workspace.name,
        userName: user?.full_name || user?.username || "Authorised worker",
        role: roleLabel(user),
        destination,
        destinationLabel: describeResumePath(destination),
        deviceSetupStatus,
        createdAt: new Date().toISOString(),
      })
    );

    setSequenceUser(user);
    setSequenceDestination(destination);
    setSequenceStage(0);

    for (let index = 1; index < COMMAND_CHECKS.length; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      setSequenceStage(index);
    }

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

      const setupStatus = await automaticDeviceSetup(password);
      await completeEntrance(result, setupStatus);
    } catch (requestError) {
      const data = requestError.response?.data || {};
      setAttemptsRemaining(
        Number.isInteger(Number(data.attempts_remaining))
          ? Number(data.attempts_remaining)
          : null
      );
      setError(data.message || requestError.message || "Sign-in could not be completed.");
      setPassword("");
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function handleRegisteredDeviceLogin() {
    setError("");
    setProgressMessage("");

    if (isSpareParts && !selectedBranchId) {
      setError("Choose the Spare Parts store before using a registered device.");
      return;
    }
    if (!supportsPasskeys()) {
      setError("This browser does not support registered-device access. Use your password.");
      return;
    }

    setLoadingMode("passkey");
    setPostLoginProcessing(true);
    try {
      const response = await authenticateWithPasskey({
        workspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        collectDeviceEvidence: () =>
          collectDeviceEvidence({ requestLocation: shareLocation }),
      });
      const result = persistPasskeySession(response, workspaceCode);
      await completeEntrance(result, "already-ready");
    } catch (requestError) {
      const cancelled = promptCancelled(requestError);
      setError(
        cancelled
          ? "Device verification was cancelled. Use your password to continue."
          : requestError.response?.data?.message ||
              requestError.message ||
              "Registered-device access could not be completed."
      );
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
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
    setRecoveryMessage("");

    if (!/^\d{6}$/.test(recoveryCode.trim())) {
      setRecoveryError("Enter the 6-digit recovery code.");
      return;
    }
    const policyError = passwordPolicyError(recoveryPassword);
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
      setIdentifier(recoveryIdentifier.trim());
      setRecoveryMessage(response.data?.message || "Password changed successfully.");
      setRecoveryStage("complete");
      setRecoveryCode("");
      setRecoveryPassword("");
      setRecoveryConfirm("");
    } catch (requestError) {
      setRecoveryError(
        requestError.response?.data?.message || "Password recovery could not be completed."
      );
    } finally {
      setRecoveryLoading(false);
    }
  }

  const busy = Boolean(loadingMode);
  const contextTitle = isSpareParts
    ? selectedBranch
      ? `${branchCode(selectedBranch)} — ${branchName(selectedBranch)}`
      : "Choose your store"
    : workspace.loginContextTitle;

  return (
    <main className={`gate2 ${theme.className}`}>
      <div className="gate2__orb gate2__orb--one" aria-hidden="true" />
      <div className="gate2__orb gate2__orb--two" aria-hidden="true" />
      <div className="premium-version-badge">{APP_RELEASE_LABEL}</div>

      <section className="gate2__shell">
        <header className="gate2__topbar">
          <div className="gate2__brand">
            <div className="gate2__logo">
              <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
              <span>C03</span>
            </div>
            <div>
              <small>Chalin 03 Company Limited</small>
              <strong>Business Operating System</strong>
            </div>
          </div>
          <div className="gate2__online"><i /> System online</div>
        </header>

        <section className="gate2__hero">
          <div className="gate2__hero-copy">
            <p>{theme.badge}</p>
            <h1>Welcome to <span>Chalin 03.</span></h1>
            <div className="gate2__hero-description">
              Choose your business, sign in normally and continue directly to the right work.
            </div>
          </div>
          <div className="gate2__hero-proof">
            <span>🛡️</span>
            <div>
              <strong>Automatic device security</strong>
              <small>
                After password login, Chalin automatically opens fingerprint, face, Windows Hello
                or device-PIN setup when the account has no trusted device.
              </small>
            </div>
          </div>
        </section>

        <section className="gate2__workspace-section" aria-label="Choose business workspace">
          <div className="gate2__section-heading">
            <div>
              <small>Step 1</small>
              <strong>Choose business workspace</strong>
            </div>
            <span>Swipe on mobile</span>
          </div>
          <div className="gate2__workspace-grid">
            {businessWorkspaces.map((item) => {
              const selected = item.code === workspaceCode;
              return (
                <button
                  type="button"
                  className={`gate2__workspace-card gate2__workspace-card--${item.accent} ${
                    selected ? "is-selected" : ""
                  }`}
                  key={item.code}
                  onClick={() => chooseWorkspace(item.code)}
                  aria-pressed={selected}
                >
                  <span className="gate2__workspace-icon" aria-hidden="true">{item.icon}</span>
                  <span className="gate2__workspace-copy">
                    <small>{item.status}</small>
                    <strong>{item.shortName}</strong>
                    <em>{item.description}</em>
                  </span>
                  <b>{selected ? "✓" : "→"}</b>
                </button>
              );
            })}
          </div>
        </section>

        <section className="gate2__body">
          <aside className="gate2__context-card">
            <div className="gate2__context-icon" aria-hidden="true">{workspace.icon}</div>
            <small>Selected operating context</small>
            <h2>{contextTitle}</h2>
            <p>{workspace.loginContextMessage}</p>

            {isSpareParts && (
              <label className="gate2__field">
                <span>Spare Parts store</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) => setSelectedBranchId(event.target.value)}
                  disabled={branchesLoading || busy}
                >
                  <option value="">{branchesLoading ? "Loading stores…" : "Choose store"}</option>
                  {branches.map((branch) => (
                    <option value={branchId(branch)} key={branchId(branch)}>
                      {branchCode(branch)} — {branchName(branch)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {branchesError && <div className="gate2__alert gate2__alert--error">{branchesError}</div>}

            <div className="gate2__destination">
              <div>
                <small>After login</small>
                <strong>{emergencyMode ? "Emergency Operations" : selectedStation.title}</strong>
                <span>
                  {emergencyMode
                    ? "Open the protected emergency interface."
                    : lastWork && stationCode === "auto"
                    ? `Resume ${describeResumePath(lastWork)}`
                    : selectedStation.description}
                </span>
              </div>
              <button type="button" onClick={() => setStationOpen((value) => !value)}>
                Change
              </button>
            </div>

            {stationOpen && (
              <div className="gate2__stations">
                {stations.map((station) => (
                  <button
                    type="button"
                    key={station.code}
                    className={station.code === stationCode ? "is-selected" : ""}
                    onClick={() => chooseStation(station.code)}
                  >
                    <span>{station.icon}</span>
                    <div><strong>{station.title}</strong><small>{station.description}</small></div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="gate2__login-card">
            <div className="gate2__login-heading">
              <div>
                <small>Step 2</small>
                <h2>Sign in securely</h2>
              </div>
              <span>🔒 Protected</span>
            </div>

            <form onSubmit={handlePasswordLogin} className="gate2__form">
              <label className="gate2__field">
                <span>Username or phone number</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  placeholder="Enter username or phone"
                  disabled={busy}
                />
              </label>

              <label className="gate2__field">
                <span>Password</span>
                <div className="gate2__password">
                  <input
                    ref={passwordRef}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    disabled={busy}
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <label className="gate2__check">
                <input
                  type="checkbox"
                  checked={shareLocation}
                  onChange={(event) => setShareLocation(event.target.checked)}
                />
                <span>Include device location evidence when available</span>
              </label>

              <button className="gate2__submit" type="submit" disabled={busy || branchesLoading}>
                <span>{loadingMode === "password" ? "◌" : "→"}</span>
                <div>
                  <strong>
                    {loadingMode === "password"
                      ? progressMessage || "Signing in securely…"
                      : "Sign in to Chalin 03"}
                  </strong>
                  <small>Password first; device security opens automatically when needed</small>
                </div>
              </button>
            </form>

            <div className="gate2__secondary-actions">
              <button type="button" onClick={handleRegisteredDeviceLogin} disabled={busy}>
                <span>◎</span> Use a registered device
              </button>
              <button
                type="button"
                className={emergencyMode ? "is-selected" : ""}
                onClick={() => setEmergencyMode((value) => !value)}
              >
                <span>⚠</span> Emergency mode
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryIdentifier(identifier);
                  setRecoveryOpen(true);
                }}
              >
                <span>↻</span> Recover password
              </button>
            </div>

            {error && (
              <div className="gate2__alert gate2__alert--error" role="alert">
                <strong>Sign-in protected</strong>
                <span>{error}</span>
                {attemptsRemaining !== null && <small>{attemptsRemaining} attempt(s) remaining</small>}
              </div>
            )}
          </section>
        </section>
      </section>

      {sequenceStage >= 0 && (
        <div className="gate2__sequence" role="status" aria-live="polite">
          <div className="gate2__sequence-card">
            <div className="gate2__sequence-logo">✓</div>
            <small>Welcome back</small>
            <h2>{sequenceUser?.full_name || sequenceUser?.username || "Authorised worker"}</h2>
            <p>{workspace.name} · {roleLabel(sequenceUser)}</p>
            <div className="gate2__sequence-list">
              {COMMAND_CHECKS.map((check, index) => (
                <span className={index <= sequenceStage ? "is-complete" : ""} key={check}>
                  <i>{index <= sequenceStage ? "✓" : "·"}</i>{check}
                </span>
              ))}
            </div>
            <strong>Opening {describeResumePath(sequenceDestination)}</strong>
          </div>
        </div>
      )}

      {recoveryOpen && (
        <div className="gate2__modal" role="dialog" aria-modal="true" aria-label="Recover password">
          <div className="gate2__modal-card">
            <button className="gate2__modal-close" type="button" onClick={() => setRecoveryOpen(false)}>×</button>
            <small>Secure account recovery</small>
            <h2>Recover your password</h2>

            {recoveryStage === "request" && (
              <form onSubmit={requestRecovery} className="gate2__form">
                <label className="gate2__field">
                  <span>Username or phone number</span>
                  <input
                    value={recoveryIdentifier}
                    onChange={(event) => setRecoveryIdentifier(event.target.value)}
                  />
                </label>
                <button className="gate2__submit gate2__submit--simple" disabled={recoveryLoading}>
                  {recoveryLoading ? "Requesting…" : "Send recovery code"}
                </button>
              </form>
            )}

            {recoveryStage === "verify" && (
              <form onSubmit={resetPassword} className="gate2__form">
                <label className="gate2__field">
                  <span>6-digit recovery code</span>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label className="gate2__field">
                  <span>New password</span>
                  <input
                    type={recoveryShow ? "text" : "password"}
                    value={recoveryPassword}
                    onChange={(event) => setRecoveryPassword(event.target.value)}
                  />
                </label>
                <label className="gate2__field">
                  <span>Confirm new password</span>
                  <input
                    type={recoveryShow ? "text" : "password"}
                    value={recoveryConfirm}
                    onChange={(event) => setRecoveryConfirm(event.target.value)}
                  />
                </label>
                <label className="gate2__check">
                  <input
                    type="checkbox"
                    checked={recoveryShow}
                    onChange={(event) => setRecoveryShow(event.target.checked)}
                  />
                  <span>Show passwords</span>
                </label>
                <button className="gate2__submit gate2__submit--simple" disabled={recoveryLoading}>
                  {recoveryLoading ? "Changing password…" : "Reset password"}
                </button>
              </form>
            )}

            {recoveryStage === "complete" && (
              <button
                className="gate2__submit gate2__submit--simple"
                type="button"
                onClick={() => setRecoveryOpen(false)}
              >
                Return to sign in
              </button>
            )}

            {recoveryMessage && <div className="gate2__alert gate2__alert--success">{recoveryMessage}</div>}
            {recoveryError && <div className="gate2__alert gate2__alert--error">{recoveryError}</div>}
          </div>
        </div>
      )}
    </main>
  );
}
