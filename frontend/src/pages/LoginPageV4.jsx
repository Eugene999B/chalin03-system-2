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
import "../styles/commandGateV4.css";

const DEFAULT_WORKSPACE = "spare_parts";
const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

const ENTRANCE_STEPS = [
  {
    title: "Identity confirmed",
    detail: "Your secure Chalin session is ready.",
  },
  {
    title: "Workspace cleared",
    detail: "Your authorised business workspace has been verified.",
  },
  {
    title: "Device security verified",
    detail: "Passkey and device evidence checks are complete.",
  },
  {
    title: "Work restored",
    detail: "Your role, station and previous work have been recovered.",
  },
  {
    title: "Launching operations",
    detail: "Opening the correct protected page now.",
  },
];

const WORKSPACE_THEME = {
  spare_parts: {
    className: "gate4--spare",
    eyebrow: "Inventory and sales",
    shortName: "Parts",
  },
  mining: {
    className: "gate4--mining",
    eyebrow: "Mining operations",
    shortName: "Mining",
  },
  equipment_hire: {
    className: "gate4--hire",
    eyebrow: "Equipment hire",
    shortName: "Hire",
  },
};

function WorkspaceIcon({ code, className = "" }) {
  if (code === "mining") {
    return (
      <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
        <path d="M8 38h32M13 34l11-23 11 23" />
        <path d="M17 25h14M20 19h8M24 11v27" />
        <path d="M9 14l8 4M39 14l-8 4" />
      </svg>
    );
  }

  if (code === "equipment_hire") {
    return (
      <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="15" cy="36" r="5" />
        <circle cx="35" cy="36" r="5" />
        <path d="M8 31h29l3 5H8zM12 30V18h12l6 12M24 18l8-8 7 4-7 8" />
        <path d="M31 10l4-5M39 14l5-2" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 18h32v22H8zM12 18l4-9h16l4 9" />
      <path d="M8 25h32M18 25v15M30 25v15" />
      <path d="M21 13h6" />
    </svg>
  );
}

function SecurityIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 5l15 6v10c0 10-6 18-15 22C15 39 9 31 9 21V11z" />
      <path d="M17 24l5 5 10-11" />
    </svg>
  );
}

function FingerprintIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 20c1-6 5-9 10-9 7 0 12 5 12 12 0 8-2 14-6 20" />
      <path d="M10 24c0-9 6-16 15-16 10 0 17 7 17 17" />
      <path d="M16 26c0-6 3-10 9-10 5 0 8 4 8 9 0 8-2 13-5 18" />
      <path d="M22 26c0-2 1-4 3-4s3 2 3 4c0 7-1 12-3 17M10 31c1 5 3 9 7 12" />
    </svg>
  );
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

function roleLabel(user) {
  return String(user?.workspace_role || user?.role || "Authorised worker")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deviceName() {
  const platform =
    navigator.userAgentData?.platform || navigator.platform || "Secure device";
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
      rawUser.workspace_code ||
      payload?.workspace?.code ||
      fallbackWorkspaceCode,
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

export default function LoginPageV4() {
  const {
    isLoggedIn,
    login,
    user: activeUser,
    workspaceCode: activeWorkspaceCode,
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordRef = useRef(null);

  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [workspaceCode, setWorkspaceCode] = useState(
    requestedWorkspace?.code || DEFAULT_WORKSPACE
  );
  const workspace =
    getBusinessWorkspace(workspaceCode) ||
    getBusinessWorkspace(DEFAULT_WORKSPACE);
  const theme = WORKSPACE_THEME[workspaceCode] || WORKSPACE_THEME.spare_parts;
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
  const [stationCode, setStationCode] = useState(() =>
    getSavedStationMode(requestedWorkspace?.code || DEFAULT_WORKSPACE)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [loadingMode, setLoadingMode] = useState("");
  const [postLoginProcessing, setPostLoginProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);

  const [sequenceStage, setSequenceStage] = useState(-1);
  const [sequenceUser, setSequenceUser] = useState(null);
  const [sequenceDestination, setSequenceDestination] = useState("");
  const [sequenceSecurity, setSequenceSecurity] = useState("");

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
    () =>
      branches.find(
        (branch) => branchId(branch) === Number(selectedBranchId)
      ),
    [branches, selectedBranchId]
  );

  const stations = useMemo(
    () => getStationModes(workspaceCode),
    [workspaceCode]
  );
  const selectedStation =
    stations.find((station) => station.code === stationCode) || stations[0];
  const lastWork = getLastWork(workspaceCode);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroVisible(false), 1850);
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
    setAdvancedOpen(false);
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
          if (
            list.some((branch) => branchId(branch) === Number(current))
          ) {
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
  }

  async function automaticDeviceSetup(currentPassword) {
    if (!supportsPasskeys()) return "unsupported";

    try {
      setProgressMessage("Checking trusted-device security…");
      const response = await axiosClient.get("/auth/passkeys");
      const passkeys = Array.isArray(response.data?.passkeys)
        ? response.data.passkeys
        : [];

      if (passkeys.length > 0) {
        setProgressMessage(
          "Passkey access is ready. Face, fingerprint or device PIN will be required every time it is used."
        );
        return "already-ready";
      }

      setProgressMessage(
        "Set up face, fingerprint, Windows Hello or device PIN for faster secure login."
      );

      await registerPasskey({
        currentPassword,
        displayName: deviceName(),
      });

      setProgressMessage("Secure device login is ready.");
      return "registered";
    } catch (setupError) {
      if (promptCancelled(setupError)) {
        setProgressMessage(
          "Device setup was skipped. Password login remains available."
        );
        return "skipped";
      }

      setProgressMessage(
        "Device setup is unavailable now. Password login remains available."
      );
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
        userName:
          user?.full_name || user?.username || "Authorised worker",
        role: roleLabel(user),
        destination,
        destinationLabel: describeResumePath(destination),
        deviceSetupStatus,
        createdAt: new Date().toISOString(),
      })
    );

    setSequenceUser(user);
    setSequenceDestination(destination);
    setSequenceSecurity(deviceSetupStatus);
    setSequenceStage(0);

    for (let index = 1; index < ENTRANCE_STEPS.length; index += 1) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, 360)
      );
      setSequenceStage(index);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 850));
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
      const evidence = await collectDeviceEvidence({
        requestLocation: shareLocation,
      });

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
      setError(
        data.message ||
          requestError.message ||
          "Sign-in could not be completed."
      );
      setPassword("");
      setPostLoginProcessing(false);
    } finally {
      setLoadingMode("");
    }
  }

  async function handlePasskeyLogin() {
    setError("");
    setProgressMessage("");

    if (isSpareParts && !selectedBranchId) {
      setError("Choose the Spare Parts store before using device login.");
      return;
    }

    if (!supportsPasskeys()) {
      setError(
        "This browser does not support passkeys. Use your password instead."
      );
      return;
    }

    setLoadingMode("passkey");
    setPostLoginProcessing(true);
    setProgressMessage(
      "Verify your face, fingerprint, Windows Hello or device PIN."
    );

    try {
      const response = await authenticateWithPasskey({
        workspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        collectDeviceEvidence: () =>
          collectDeviceEvidence({ requestLocation: shareLocation }),
      });

      const result = persistPasskeySession(response, workspaceCode);
      await completeEntrance(result, "verified-now");
    } catch (requestError) {
      const cancelled = promptCancelled(requestError);
      setError(
        cancelled
          ? "Device verification was cancelled. Try again or use your password."
          : requestError.response?.data?.message ||
              requestError.message ||
              "Secure device login could not be completed."
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
      const response = await axiosClient.post(
        "/auth/recovery/request-otp",
        {
          identifier: value,
          username: value,
        }
      );

      setRecoveryIdentifier(value);
      setRecoveryMessage(
        response.data?.message || "Recovery code sent."
      );
      setRecoveryStage("verify");
    } catch (requestError) {
      setRecoveryError(
        requestError.response?.data?.message ||
          "Password recovery is unavailable."
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
      const response = await axiosClient.post(
        "/auth/recovery/reset-password",
        {
          identifier: recoveryIdentifier.trim(),
          username: recoveryIdentifier.trim(),
          otp: recoveryCode.trim(),
          new_password: recoveryPassword,
          confirm_password: recoveryConfirm,
        }
      );

      setIdentifier(recoveryIdentifier.trim());
      setRecoveryMessage(
        response.data?.message || "Password changed successfully."
      );
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

  function closeRecovery() {
    setRecoveryOpen(false);
    setRecoveryStage("request");
    setRecoveryCode("");
    setRecoveryPassword("");
    setRecoveryConfirm("");
    setRecoveryMessage("");
    setRecoveryError("");
  }

  const busy = Boolean(loadingMode);
  const contextLabel = isSpareParts
    ? selectedBranch
      ? `${branchCode(selectedBranch)} · ${branchName(selectedBranch)}`
      : "Choose store"
    : workspace.loginContextTitle;

  const destinationLabel = emergencyMode
    ? "Emergency Operations"
    : lastWork && stationCode === "auto"
    ? `Resume ${describeResumePath(lastWork)}`
    : selectedStation.title;

  return (
    <main className={`gate4 ${theme.className}`}>
      {introVisible && !isLoggedIn && (
        <button
          type="button"
          className="gate4-intro"
          onClick={() => setIntroVisible(false)}
          aria-label="Continue to Chalin 03 sign in"
        >
          <div className="gate4-intro__glow" />
          <div className="gate4-intro__orbit gate4-intro__orbit--one">
            <span><WorkspaceIcon code="spare_parts" /></span>
          </div>
          <div className="gate4-intro__orbit gate4-intro__orbit--two">
            <span><WorkspaceIcon code="mining" /></span>
          </div>
          <div className="gate4-intro__orbit gate4-intro__orbit--three">
            <span><WorkspaceIcon code="equipment_hire" /></span>
          </div>
          <div className="gate4-intro__content">
            <div className="gate4-intro__logo">C03</div>
            <small>Chalin 03 Company Limited</small>
            <h1>Welcome to your <span>operating system.</span></h1>
            <p>Sales · Mining · Equipment Hire</p>
            <div className="gate4-intro__progress"><i /></div>
            <em>Tap to continue</em>
          </div>
        </button>
      )}

      <div className="gate4__mesh" aria-hidden="true" />
      <div className="gate4__flare gate4__flare--one" aria-hidden="true" />
      <div className="gate4__flare gate4__flare--two" aria-hidden="true" />

      <section className="gate4__shell">
        <header className="gate4__topbar">
          <div className="gate4__brand">
            <div className="gate4__logo">
              <img
                src="/logo.png"
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <span>C03</span>
            </div>
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
          <aside className="gate4__story">
            <div className="gate4__story-copy">
              <small>{theme.eyebrow}</small>
              <h1>One secure entrance. <span>Every operation.</span></h1>
              <p>
                Move directly into the right business, role and work station
                without losing security or operational context.
              </p>
            </div>

            <div className="gate4__story-visual">
              <div className="gate4__story-ring gate4__story-ring--outer" />
              <div className="gate4__story-ring gate4__story-ring--inner" />
              <div className="gate4__story-core">
                <SecurityIcon />
                <strong>Protected</strong>
                <small>Identity · Role · Workspace</small>
              </div>
              <span className="gate4__story-node gate4__story-node--one">
                <WorkspaceIcon code="spare_parts" />
              </span>
              <span className="gate4__story-node gate4__story-node--two">
                <WorkspaceIcon code="mining" />
              </span>
              <span className="gate4__story-node gate4__story-node--three">
                <WorkspaceIcon code="equipment_hire" />
              </span>
            </div>

            <div className="gate4__story-foot">
              <span><i /> Secure session</span>
              <span><i /> Role-aware route</span>
              <span><i /> Work recovery</span>
            </div>
          </aside>

          <section className="gate4__access">
            <div className="gate4__access-heading">
              <div>
                <small>Secure access</small>
                <h2>Welcome back</h2>
                <p>Select a business and continue.</p>
              </div>
              <div className="gate4__access-shield">
                <SecurityIcon />
              </div>
            </div>

            <div className="gate4__workspace-tabs" aria-label="Choose business workspace">
              {businessWorkspaces.map((item) => {
                const selected = item.code === workspaceCode;
                const itemTheme =
                  WORKSPACE_THEME[item.code] || WORKSPACE_THEME.spare_parts;

                return (
                  <button
                    type="button"
                    key={item.code}
                    className={selected ? "is-selected" : ""}
                    onClick={() => chooseWorkspace(item.code)}
                    aria-pressed={selected}
                  >
                    <span><WorkspaceIcon code={item.code} /></span>
                    <strong>{itemTheme.shortName}</strong>
                    <i>{selected ? "✓" : ""}</i>
                  </button>
                );
              })}
            </div>

            <div className="gate4__context-strip">
              <div className="gate4__context-icon">
                <WorkspaceIcon code={workspaceCode} />
              </div>
              <div>
                <small>{workspace.name}</small>
                <strong>{contextLabel}</strong>
              </div>
              <span>{destinationLabel}</span>
            </div>

            {isSpareParts && (
              <label className="gate4__field gate4__field--store">
                <span>Spare Parts store</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) =>
                    setSelectedBranchId(event.target.value)
                  }
                  disabled={branchesLoading || busy}
                >
                  <option value="">
                    {branchesLoading ? "Loading stores…" : "Choose store"}
                  </option>
                  {branches.map((branch) => (
                    <option
                      value={branchId(branch)}
                      key={branchId(branch)}
                    >
                      {branchCode(branch)} — {branchName(branch)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {branchesError && (
              <div className="gate4__alert gate4__alert--error">
                {branchesError}
              </div>
            )}

            <button
              type="button"
              className="gate4__passkey"
              onClick={handlePasskeyLogin}
              disabled={busy || branchesLoading}
            >
              <span className="gate4__passkey-icon">
                <FingerprintIcon />
              </span>
              <div>
                <strong>
                  {loadingMode === "passkey"
                    ? "Verify on this device…"
                    : "Continue with face or fingerprint"}
                </strong>
                <small>
                  Verification is required every time you use secure device login
                </small>
              </div>
              <b>→</b>
            </button>

            <div className="gate4__divider"><span>or use password</span></div>

            <form onSubmit={handlePasswordLogin} className="gate4__form">
              <label className="gate4__field">
                <span>Username or phone number</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  inputMode="text"
                  placeholder="Enter username or phone"
                  disabled={busy}
                />
              </label>

              <label className="gate4__field">
                <span>Password</span>
                <div className="gate4__password">
                  <input
                    ref={passwordRef}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
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
                  <small>
                    New accounts are offered automatic device-security setup
                  </small>
                </div>
              </button>
            </form>

            {progressMessage && busy && (
              <div className="gate4__progress-message" role="status">
                <i />
                <span>{progressMessage}</span>
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
                aria-expanded={advancedOpen}
              >
                Entry options {advancedOpen ? "−" : "+"}
              </button>
            </div>

            {advancedOpen && (
              <div className="gate4__advanced">
                <div className="gate4__advanced-heading">
                  <div>
                    <small>After sign-in</small>
                    <strong>{destinationLabel}</strong>
                  </div>
                  <span>{selectedStation.icon}</span>
                </div>

                <div className="gate4__station-grid">
                  {stations.map((station) => (
                    <button
                      type="button"
                      key={station.code}
                      className={
                        station.code === stationCode ? "is-selected" : ""
                      }
                      onClick={() => chooseStation(station.code)}
                    >
                      <span>{station.icon}</span>
                      <div>
                        <strong>{station.title}</strong>
                        <small>{station.description}</small>
                      </div>
                    </button>
                  ))}
                </div>

                <label className="gate4__check">
                  <input
                    type="checkbox"
                    checked={shareLocation}
                    onChange={(event) =>
                      setShareLocation(event.target.checked)
                    }
                  />
                  <span>Include device location evidence when available</span>
                </label>

                <label className="gate4__check gate4__check--danger">
                  <input
                    type="checkbox"
                    checked={emergencyMode}
                    onChange={(event) =>
                      setEmergencyMode(event.target.checked)
                    }
                  />
                  <span>Open protected Emergency Operations after sign-in</span>
                </label>
              </div>
            )}
          </section>
        </div>
      </section>

      {sequenceStage >= 0 && (
        <div className="gate4-sequence" role="status" aria-live="polite">
          <div className="gate4-sequence__mesh" />
          <div className="gate4-sequence__ring gate4-sequence__ring--one" />
          <div className="gate4-sequence__ring gate4-sequence__ring--two" />

          <div className="gate4-sequence__content">
            <div className="gate4-sequence__brand">
              <div>C03</div>
              <span>
                <small>Chalin 03</small>
                <strong>{workspace.name}</strong>
              </span>
            </div>

            <div className="gate4-sequence__identity">
              <span><WorkspaceIcon code={workspaceCode} /></span>
              <small>Welcome back</small>
              <h2>
                {sequenceUser?.full_name ||
                  sequenceUser?.username ||
                  "Authorised worker"}
              </h2>
              <p>{roleLabel(sequenceUser)}</p>
            </div>

            <div className="gate4-sequence__steps">
              {ENTRANCE_STEPS.map((step, index) => (
                <div
                  key={step.title}
                  className={
                    index < sequenceStage
                      ? "is-complete"
                      : index === sequenceStage
                      ? "is-active"
                      : ""
                  }
                >
                  <i>{index < sequenceStage ? "✓" : index + 1}</i>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                </div>
              ))}
            </div>

            <div className="gate4-sequence__launch">
              <div className="gate4-sequence__bar">
                <i
                  style={{
                    width: `${((sequenceStage + 1) / ENTRANCE_STEPS.length) * 100}%`,
                  }}
                />
              </div>
              <strong>
                Opening {describeResumePath(sequenceDestination)}
              </strong>
              <small>
                {sequenceSecurity === "verified-now"
                  ? "Fresh biometric or device-PIN verification completed"
                  : "Secure operational context prepared"}
              </small>
            </div>
          </div>
        </div>
      )}

      {recoveryOpen && (
        <div
          className="gate4-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Recover password"
        >
          <div className="gate4-modal__card">
            <button
              className="gate4-modal__close"
              type="button"
              onClick={closeRecovery}
              aria-label="Close password recovery"
            >
              ×
            </button>

            <small>Secure account recovery</small>
            <h2>
              {recoveryStage === "request"
                ? "Request recovery code"
                : recoveryStage === "verify"
                ? "Create a new password"
                : "Password changed"}
            </h2>

            {recoveryStage === "request" && (
              <form onSubmit={requestRecovery}>
                <label className="gate4__field">
                  <span>Username or phone number</span>
                  <input
                    value={recoveryIdentifier}
                    onChange={(event) =>
                      setRecoveryIdentifier(event.target.value)
                    }
                    placeholder="Enter username or phone"
                  />
                </label>
                <button
                  className="gate4__submit"
                  type="submit"
                  disabled={recoveryLoading}
                >
                  <span>→</span>
                  <div>
                    <strong>
                      {recoveryLoading
                        ? "Requesting code…"
                        : "Send recovery code"}
                    </strong>
                  </div>
                </button>
              </form>
            )}

            {recoveryStage === "verify" && (
              <form onSubmit={resetPassword}>
                <label className="gate4__field">
                  <span>Six-digit recovery code</span>
                  <input
                    value={recoveryCode}
                    onChange={(event) =>
                      setRecoveryCode(event.target.value)
                    }
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                  />
                </label>

                <label className="gate4__field">
                  <span>New password</span>
                  <div className="gate4__password">
                    <input
                      value={recoveryPassword}
                      onChange={(event) =>
                        setRecoveryPassword(event.target.value)
                      }
                      type={recoveryShow ? "text" : "password"}
                      placeholder="Create strong password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRecoveryShow((value) => !value)
                      }
                    >
                      {recoveryShow ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <label className="gate4__field">
                  <span>Confirm password</span>
                  <input
                    value={recoveryConfirm}
                    onChange={(event) =>
                      setRecoveryConfirm(event.target.value)
                    }
                    type={recoveryShow ? "text" : "password"}
                    placeholder="Repeat new password"
                  />
                </label>

                <button
                  className="gate4__submit"
                  type="submit"
                  disabled={recoveryLoading}
                >
                  <span>✓</span>
                  <div>
                    <strong>
                      {recoveryLoading
                        ? "Changing password…"
                        : "Change password"}
                    </strong>
                  </div>
                </button>
              </form>
            )}

            {recoveryStage === "complete" && (
              <button
                className="gate4__submit"
                type="button"
                onClick={closeRecovery}
              >
                <span>✓</span>
                <div>
                  <strong>Return to sign in</strong>
                </div>
              </button>
            )}

            {recoveryMessage && (
              <div className="gate4__alert gate4__alert--success">
                {recoveryMessage}
              </div>
            )}

            {recoveryError && (
              <div className="gate4__alert gate4__alert--error">
                {recoveryError}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
