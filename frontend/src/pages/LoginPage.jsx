import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import BusinessWorkspaceSelector from "../components/BusinessWorkspaceSelector";
import { getBusinessWorkspace } from "../data/businessWorkspaces";
import { collectDeviceEvidence } from "../utils/deviceEvidence";

function getBranchId(branch) {
  return Number(branch?.id || branch?.branch_id || 0);
}

function getBranchCode(branch) {
  return branch?.code || branch?.branch_code || "";
}

function getBranchName(branch) {
  return branch?.name || branch?.branch_name || "Store";
}

function getBranchLocation(branch) {
  return branch?.location || branch?.branch_location || "";
}

function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) {
    return data.branches;
  }

  if (Array.isArray(data?.stores)) {
    return data.stores;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "New password must be at least 8 characters long.";
  }

  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "New password must include uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "New password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "New password must include at least one symbol.";
  }

  return "";
}

export default function LoginPage() {
  const { login, isLoggedIn, workspaceCode: activeWorkspaceCode } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedWorkspaceCode = searchParams.get("workspace");
  const requestedWorkspace = getBusinessWorkspace(requestedWorkspaceCode);

  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState(
    requestedWorkspace?.code || "spare_parts"
  );

  const selectedWorkspace =
    getBusinessWorkspace(selectedWorkspaceCode) ||
    getBusinessWorkspace("spare_parts");

  const selectedWorkspaceRoute = selectedWorkspace?.openRoute || "/";
  const isSparePartsWorkspace = selectedWorkspaceCode === "spare_parts";

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFieldActivated, setPasswordFieldActivated] = useState(false);
  const passwordInputRef = useRef(null);
  const [sharePreciseLocation, setSharePreciseLocation] = useState(true);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotStage, setForgotStage] = useState("request");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [showRecoveryPasswords, setShowRecoveryPasswords] = useState(false);

  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loginNotice = sessionStorage.getItem("chalin03_login_notice");

    if (loginNotice) {
      setError(loginNotice);
      sessionStorage.removeItem("chalin03_login_notice");
    }
  }, []);

  useEffect(() => {
    function clearRememberedPassword() {
      setPassword("");
      setShowPassword(false);
      setPasswordFieldActivated(false);

      if (passwordInputRef.current) {
        passwordInputRef.current.value = "";
      }
    }

    clearRememberedPassword();
    const earlyClear = window.setTimeout(clearRememberedPassword, 80);
    const delayedClear = window.setTimeout(clearRememberedPassword, 550);

    function handlePageShow() {
      clearRememberedPassword();
    }

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.clearTimeout(earlyClear);
      window.clearTimeout(delayedClear);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const selectedBranch = useMemo(() => {
    return branches.find(
      (branch) => getBranchId(branch) === Number(selectedBranchId)
    );
  }, [branches, selectedBranchId]);

  const selectedContextTitle = isSparePartsWorkspace
    ? selectedBranch
      ? `${getBranchCode(selectedBranch) || "STORE"} — ${getBranchName(
          selectedBranch
        )}`
      : "Choose your Spare Parts store"
    : selectedWorkspace?.name || "Business Workspace";

  const selectedContextMessage = isSparePartsWorkspace
    ? selectedBranch
      ? getBranchLocation(selectedBranch) || "Location not set"
      : "Select Main Store or Second Store before logging into Spare Parts."
    : selectedWorkspace?.loginContextMessage ||
      "This workspace does not use a Spare Parts store.";

  useEffect(() => {
    if (requestedWorkspace?.code) {
      setSelectedWorkspaceCode(requestedWorkspace.code);
    }
  }, [requestedWorkspace?.code]);

  useEffect(() => {
    let ignore = false;

    if (!isSparePartsWorkspace) {
      setBranchesLoading(false);
      setBranchesError("");
      setSelectedBranchId("");
      return () => {
        ignore = true;
      };
    }

    async function loadBranches() {
      setBranchesLoading(true);
      setBranchesError("");

      try {
        const response = await axiosClient.get("/branches/public");
        const list = normalizeBranches(response.data);

        if (ignore) {
          return;
        }

        setBranches(list);
        setSelectedBranchId((currentBranchId) => {
          const stillExists = list.some(
            (branch) => getBranchId(branch) === Number(currentBranchId)
          );

          return stillExists || list.length === 0
            ? currentBranchId
            : String(getBranchId(list[0]));
        });
      } catch (error) {
        if (ignore) {
          return;
        }

        setBranchesError(
          error.response?.data?.message ||
            "Could not load Spare Parts stores. Please check backend connection."
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
  }, [isSparePartsWorkspace]);

  if (isLoggedIn) {
    const activeWorkspace =
      getBusinessWorkspace(activeWorkspaceCode) || selectedWorkspace;
    return <Navigate to={activeWorkspace?.openRoute || "/"} replace />;
  }

  function handleWorkspaceSelect(workspaceCode) {
    const workspace = getBusinessWorkspace(workspaceCode);

    if (!workspace) {
      return;
    }

    setSelectedWorkspaceCode(workspace.code);

    if (workspace.code !== "spare_parts") {
      setSelectedBranchId("");
      setBranchesError("");
    }

    const nextParams = new URLSearchParams(searchParams);

    if (workspace.code === "spare_parts") {
      nextParams.delete("workspace");
    } else {
      nextParams.set("workspace", workspace.code);
    }

    setSearchParams(nextParams, { replace: true });
    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
  }

  async function handleLogin(event) {
    event.preventDefault();

    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
    setForgotMessage("");
    setForgotError("");

    if (isSparePartsWorkspace && !selectedBranchId) {
      setError("Please choose a Spare Parts store before logging in.");
      return;
    }

    if (!username.trim() || !password.trim()) {
      setError("Please enter your username or phone number and password.");
      return;
    }

    setLoading(true);

    try {
      const deviceEvidence = await collectDeviceEvidence({
        requestLocation: sharePreciseLocation,
      });

      await login({
        identifier: username.trim(),
        username: username.trim(),
        password,
        workspaceCode: selectedWorkspaceCode,
        branchId: isSparePartsWorkspace
          ? Number(selectedBranchId)
          : null,
        deviceEvidence,
      });

      navigate(selectedWorkspaceRoute, { replace: true });
    } catch (error) {
      const responseData = error.response?.data || {};
      setErrorCode(responseData.code || "");
      const rawAttemptsRemaining = responseData.attempts_remaining;
      setAttemptsRemaining(
        rawAttemptsRemaining !== undefined &&
        rawAttemptsRemaining !== null &&
        Number.isInteger(Number(rawAttemptsRemaining))
          ? Number(rawAttemptsRemaining)
          : null
      );
      setError(
        responseData.message ||
          error.message ||
          "Invalid username, phone number or password."
      );
      setPassword("");
      setShowPassword(false);
      setPasswordFieldActivated(false);
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
      setForgotError("Please enter your username or phone number first.");
      return;
    }

    setForgotLoading(true);

    try {
      const response = await axiosClient.post("/auth/recovery/request-otp", {
        identifier: usernameToSend,
        username: usernameToSend,
      });

      setForgotUsername(usernameToSend);
      setForgotMessage(
        response.data?.message ||
          "Check the registered phone for a recovery code. Contact the original System Administrator when no code arrives."
      );
      setForgotStage("verify");
    } catch (requestError) {
      setForgotError(
        requestError.response?.data?.message ||
          "Password recovery is temporarily unavailable."
      );
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleRecoveryReset(event) {
    event.preventDefault();

    setForgotMessage("");
    setForgotError("");
    setError("");

    const usernameToSend = forgotUsername.trim() || username.trim();
    const cleanCode = recoveryCode.trim();

    if (!usernameToSend) {
      setForgotError("Username or phone number is required.");
      return;
    }

    if (!/^\d{6}$/.test(cleanCode)) {
      setForgotError("Enter the 6-digit recovery code.");
      return;
    }

    const passwordPolicyError = strongPasswordError(recoveryNewPassword);

    if (passwordPolicyError) {
      setForgotError(passwordPolicyError);
      return;
    }

    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setForgotError("New password and confirmation do not match.");
      return;
    }

    setForgotLoading(true);

    try {
      const response = await axiosClient.post(
        "/auth/recovery/reset-password",
        {
          identifier: usernameToSend,
          username: usernameToSend,
          otp: cleanCode,
          new_password: recoveryNewPassword,
          confirm_password: recoveryConfirmPassword,
        }
      );

      setUsername(usernameToSend);
      setPassword("");
      setRecoveryCode("");
      setRecoveryNewPassword("");
      setRecoveryConfirmPassword("");
      setForgotMessage(
        response.data?.message ||
          "Password changed successfully. You may now login with the new password."
      );
      setForgotStage("complete");
    } catch (requestError) {
      setForgotError(
        requestError.response?.data?.message ||
          "Password recovery could not be completed."
      );
    } finally {
      setForgotLoading(false);
    }
  }

  function restartForgotPassword() {
    setForgotStage("request");
    setRecoveryCode("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setShowRecoveryPasswords(false);
    setForgotMessage("");
    setForgotError("");
  }

  function openForgotPassword() {
    setShowForgotPassword(true);
    setForgotUsername(username);
    setForgotStage("request");
    setRecoveryCode("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setShowRecoveryPasswords(false);
    setForgotMessage("");
    setForgotError("");
    setError("");
    setErrorCode("");
    setAttemptsRemaining(null);
  }

  function closeForgotPassword() {
    setShowForgotPassword(false);
    setForgotUsername("");
    setForgotStage("request");
    setRecoveryCode("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setShowRecoveryPasswords(false);
    setForgotMessage("");
    setForgotError("");
  }

  return (
    <div className="premium-login-page">
      <style>{`
        .premium-login-page {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          color: #ffffff;
          padding: 28px;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 13% 10%, rgba(224, 186, 40, 0.35), transparent 26%),
            radial-gradient(circle at 88% 9%, rgba(14, 165, 233, 0.24), transparent 30%),
            radial-gradient(circle at 80% 88%, rgba(34, 197, 94, 0.18), transparent 31%),
            linear-gradient(135deg, #020617 0%, #07182c 38%, #0f172a 100%);
        }

        .premium-login-page * {
          box-sizing: border-box;
        }

        .premium-login-page button,
        .premium-login-page input {
          font: inherit;
        }

        .premium-login-noise {
          position: absolute;
          inset: 0;
          opacity: 0.22;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
          background-size: 52px 52px;
          mask-image: radial-gradient(circle at center, black, transparent 75%);
        }

        .premium-login-page::before,
        .premium-login-page::after {
          content: "";
          position: absolute;
          width: 520px;
          height: 520px;
          border-radius: 999px;
          filter: blur(34px);
          opacity: 0.28;
          pointer-events: none;
          animation: glowFloat 9s ease-in-out infinite;
        }

        .premium-login-page::before {
          left: -180px;
          bottom: -160px;
          background: #e0ba28;
        }

        .premium-login-page::after {
          right: -190px;
          top: -160px;
          background: #38bdf8;
          animation-delay: 2s;
        }

        @keyframes glowFloat {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -24px, 0) scale(1.05); }
        }

        .premium-login-shell {
          position: relative;
          z-index: 2;
          width: min(1240px, 100%);
          min-height: 720px;
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 20px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 38px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.06));
          backdrop-filter: blur(24px);
          box-shadow:
            0 42px 120px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }

        .premium-hero {
          position: relative;
          overflow: hidden;
          border-radius: 30px;
          padding: 34px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background:
            linear-gradient(140deg, rgba(7, 24, 44, 0.92), rgba(15, 23, 42, 0.72)),
            radial-gradient(circle at 38% 20%, rgba(224, 186, 40, 0.24), transparent 34%);
          border: 1px solid rgba(255, 255, 255, 0.14);
        }

        .premium-hero::before {
          content: "";
          position: absolute;
          inset: auto -28% -34% 23%;
          height: 370px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(224, 186, 40, 0.44), rgba(14, 165, 233, 0.1));
          filter: blur(32px);
          transform: rotate(-12deg);
        }

        .premium-brand-row {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .premium-brand-mark {
          width: 86px;
          height: 86px;
          position: relative;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border-radius: 27px;
          overflow: hidden;
          background:
            linear-gradient(135deg, #07182c, #0f2a48),
            #07182c;
          border: 3px solid #e0ba28;
          box-shadow: 0 22px 50px rgba(224, 186, 40, 0.22);
        }

        .premium-brand-mark img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          z-index: 2;
        }

        .premium-brand-mark span {
          font-size: 24px;
          font-weight: 950;
          color: #e0ba28;
          letter-spacing: -0.05em;
        }

        .premium-brand-kicker {
          margin: 0 0 5px;
          color: rgba(255, 255, 255, 0.64);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .premium-brand-name {
          margin: 0;
          font-size: 27px;
          font-weight: 950;
          letter-spacing: -0.06em;
        }

        .premium-hero-copy {
          position: relative;
          z-index: 1;
          margin-top: 48px;
        }

        .premium-pill-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }

        .premium-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 9px 12px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          font-weight: 900;
        }

        .premium-hero-title {
          margin: 0;
          font-size: clamp(44px, 6vw, 86px);
          line-height: 0.9;
          letter-spacing: -0.085em;
          font-weight: 950;
        }

        .premium-gold {
          color: #e0ba28;
          text-shadow: 0 24px 80px rgba(224, 186, 40, 0.26);
        }

        .premium-hero-subtitle {
          width: min(620px, 100%);
          margin: 24px 0 0;
          color: rgba(255, 255, 255, 0.72);
          font-size: 17px;
          line-height: 1.75;
          font-weight: 680;
        }

        .premium-hero-bottom {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 16px;
        }

        .premium-stat-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }

        .premium-stat-card,
        .premium-selected-store {
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.13);
          background: rgba(255, 255, 255, 0.09);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
        }

        .premium-stat-card {
          padding: 16px;
        }

        .premium-stat-card strong {
          display: block;
          font-size: 27px;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .premium-stat-card span {
          display: block;
          margin-top: 5px;
          color: rgba(255, 255, 255, 0.65);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }

        .premium-selected-store {
          padding: 22px;
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.22), rgba(255, 255, 255, 0.08));
          border-color: rgba(224, 186, 40, 0.34);
        }

        .premium-selected-store small {
          display: block;
          margin-bottom: 8px;
          color: rgba(255, 255, 255, 0.66);
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0.15em;
        }

        .premium-selected-store h2 {
          margin: 0;
          font-size: 26px;
          font-weight: 950;
          letter-spacing: -0.055em;
        }

        .premium-selected-store p {
          margin: 8px 0 0;
          color: rgba(255, 255, 255, 0.74);
          font-weight: 750;
        }

        .premium-login-panel {
          border-radius: 30px;
          padding: 28px;
          background: rgba(248, 250, 252, 0.985);
          color: #07182c;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .premium-login-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 20px;
        }

        .premium-login-eyebrow {
          margin: 0 0 6px;
          color: #9a6b00;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .premium-login-title {
          margin: 0;
          font-size: 36px;
          line-height: 1;
          letter-spacing: -0.065em;
          font-weight: 950;
        }

        .premium-secure-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
          border-radius: 999px;
          padding: 9px 12px;
          background: #ecfdf3;
          color: #027a48;
          border: 1px solid #bbf7d0;
          font-size: 12px;
          font-weight: 950;
          box-shadow: 0 12px 25px rgba(2, 122, 72, 0.09);
        }

        .premium-login-help {
          margin: 0 0 18px;
          color: #667085;
          font-weight: 720;
          line-height: 1.6;
        }

        .premium-branch-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: 18px 0 10px;
        }

        .premium-branch-title label {
          margin: 0;
          font-size: 14px;
          color: #07182c;
          font-weight: 950;
        }

        .premium-branch-count {
          border-radius: 999px;
          padding: 7px 10px;
          background: #eef2ff;
          border: 1px solid #dbe4ff;
          color: #344054;
          font-size: 12px;
          font-weight: 950;
        }

        .premium-workspace-context-card {
          margin: 18px 0 16px;
          border: 1px solid #d8e2ee;
          border-radius: 22px;
          padding: 16px;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 13px;
          align-items: start;
          background:
            radial-gradient(circle at top right, rgba(14, 116, 144, 0.12), transparent 44%),
            linear-gradient(145deg, #f8fbff, #ffffff);
          color: #142036;
        }

        .premium-workspace-context-card > span {
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          background: #07182c;
          font-size: 23px;
        }

        .premium-workspace-context-card strong {
          display: block;
          margin: 1px 0 5px;
          color: #07182c;
          font-size: 15px;
          font-weight: 950;
        }

        .premium-workspace-context-card p {
          margin: 0;
          color: #65758a;
          font-size: 12.5px;
          font-weight: 720;
          line-height: 1.55;
        }

        .premium-workspace-context-card small {
          display: block;
          margin-top: 8px;
          color: #8a6200;
          font-size: 10.5px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .premium-branch-grid {
          display: grid;
          gap: 10px;
          max-height: 280px;
          overflow: auto;
          padding-right: 3px;
          margin-bottom: 16px;
        }

        .premium-branch-card {
          width: 100%;
          text-align: left;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #07182c;
          border-radius: 21px;
          padding: 14px;
          cursor: pointer;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 12px;
          transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .premium-branch-card:hover {
          transform: translateY(-2px);
          border-color: rgba(224, 186, 40, 0.55);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.11);
        }

        .premium-branch-card.active {
          border-color: #e0ba28;
          background:
            linear-gradient(135deg, rgba(224, 186, 40, 0.17), #ffffff);
          box-shadow: 0 18px 38px rgba(224, 186, 40, 0.18);
        }

        .premium-branch-icon {
          width: 48px;
          height: 48px;
          border-radius: 17px;
          display: grid;
          place-items: center;
          background: #07182c;
          color: #e0ba28;
          font-size: 23px;
          box-shadow: 0 10px 25px rgba(7, 24, 44, 0.14);
        }

        .premium-branch-card.active .premium-branch-icon {
          background: #e0ba28;
          color: #07182c;
        }

        .premium-branch-info strong {
          display: block;
          margin-bottom: 4px;
          font-size: 15px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }

        .premium-branch-info span {
          display: block;
          color: #667085;
          font-size: 13px;
          font-weight: 760;
        }

        .premium-branch-check {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          border: 2px solid #d0d5dd;
          color: transparent;
          font-weight: 950;
        }

        .premium-branch-card.active .premium-branch-check {
          color: #07182c;
          background: #e0ba28;
          border-color: #e0ba28;
        }

        .premium-form-box {
          border: 1px solid #e5e7eb;
          border-radius: 25px;
          padding: 18px;
          background: #ffffff;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
        }

        .premium-form-box label,
        .premium-forgot-panel label {
          display: block;
          margin: 0 0 8px;
          color: #344054;
          font-size: 13px;
          font-weight: 950;
        }

        .premium-field-wrap {
          position: relative;
        }

        .premium-field-icon {
          position: absolute;
          left: 14px;
          top: 14px;
          color: #98a2b3;
          pointer-events: none;
        }

        .premium-form-box input,
        .premium-forgot-panel input {
          width: 100%;
          border: 1px solid #d0d5dd;
          background: #f8fafc;
          color: #07182c;
          border-radius: 16px;
          padding: 13px 14px 13px 42px;
          outline: none;
          font-weight: 760;
          margin-bottom: 14px;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .premium-form-box input:focus,
        .premium-forgot-panel input:focus {
          background: #ffffff;
          border-color: #e0ba28;
          box-shadow: 0 0 0 4px rgba(224, 186, 40, 0.15);
        }

        .premium-password-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: start;
        }

        .premium-password-toggle {
          height: 48px;
          border: 1px solid #d0d5dd;
          border-radius: 16px;
          background: #f2f4f7;
          color: #344054;
          padding: 0 14px;
          font-weight: 950;
          cursor: pointer;
        }

        .premium-login-button {
          width: 100%;
          border: none;
          border-radius: 18px;
          padding: 15px 16px;
          cursor: pointer;
          color: #ffffff;
          font-size: 16px;
          font-weight: 950;
          background: linear-gradient(135deg, #07182c 0%, #0f2a48 55%, #07182c 100%);
          box-shadow: 0 20px 42px rgba(7, 24, 44, 0.25);
          transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }

        .premium-login-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 26px 55px rgba(7, 24, 44, 0.31);
        }

        .premium-login-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .premium-forgot-button {
          width: 100%;
          margin-top: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 12px 14px;
          background: #f8fafc;
          color: #475467;
          font-weight: 950;
          cursor: pointer;
        }

        .premium-forgot-button:hover {
          background: #eef2f7;
        }

        .premium-error-box,
        .premium-success-box,
        .premium-warning-box {
          padding: 12px 13px;
          border-radius: 16px;
          margin-bottom: 14px;
          font-weight: 850;
          font-size: 13px;
          line-height: 1.45;
        }

        .premium-error-box {
          display: grid;
          gap: 4px;
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .premium-error-box.is-locked {
          padding: 15px;
          background: linear-gradient(135deg, #7f1d1d, #b42318);
          color: #ffffff;
          border-color: #dc2626;
          box-shadow: 0 14px 30px rgba(180, 35, 24, 0.2);
        }

        .premium-error-box strong {
          font-size: 15px;
        }

        .premium-error-box small {
          font-weight: 900;
          opacity: 0.88;
        }

        .premium-location-consent {
          display: flex !important;
          align-items: flex-start;
          gap: 11px;
          margin: 2px 0 16px;
          padding: 12px 13px;
          border-radius: 16px;
          border: 1px solid #d0d5dd;
          background: #f8fafc;
          color: #344054;
          cursor: pointer;
        }

        .premium-location-consent input {
          width: 18px;
          height: 18px;
          margin: 2px 0 0;
          accent-color: #0f2a48;
          flex: 0 0 auto;
        }

        .premium-location-consent span {
          display: grid;
          gap: 3px;
        }

        .premium-location-consent strong {
          color: #101828;
          font-size: 13px;
        }

        .premium-location-consent small {
          color: #667085;
          font-size: 11px;
          line-height: 1.45;
        }

        .premium-success-box {
          background: #ecfdf3;
          color: #027a48;
          border: 1px solid #bbf7d0;
        }

        .premium-warning-box {
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fed7aa;
        }

        .premium-forgot-panel {
          margin-top: 16px;
          padding: 16px;
          border-radius: 24px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
        }

        .premium-forgot-panel h3 {
          margin: 0 0 8px;
          color: #9a3412;
          font-size: 20px;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .premium-forgot-panel p {
          margin: 0 0 12px;
          line-height: 1.55;
          font-weight: 720;
        }

        .premium-forgot-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .premium-forgot-action,
        .premium-forgot-cancel {
          border-radius: 16px;
          padding: 12px 14px;
          cursor: pointer;
          font-weight: 950;
        }

        .premium-forgot-action {
          border: none;
          background: #9a3412;
          color: #ffffff;
        }

        .premium-forgot-cancel {
          border: 1px solid #fed7aa;
          background: #ffffff;
          color: #9a3412;
        }

        .premium-login-footer {
          margin: 15px 0 0;
          color: #667085;
          font-size: 12px;
          font-weight: 760;
          text-align: center;
          line-height: 1.55;
        }

        @media (max-width: 1020px) {
          .premium-login-page {
            padding: 16px;
            place-items: start center;
          }

          .premium-login-shell {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .premium-hero {
            min-height: auto;
          }
        }

        @media (max-width: 620px) {
          .premium-login-page {
            padding: 10px;
          }

          .premium-login-shell {
            border-radius: 28px;
            padding: 10px;
          }

          .premium-hero,
          .premium-login-panel {
            border-radius: 23px;
            padding: 20px;
          }

          .premium-brand-mark {
            width: 64px;
            height: 64px;
            border-radius: 20px;
          }

          .premium-brand-name {
            font-size: 20px;
          }

          .premium-hero-title {
            font-size: 44px;
          }

          .premium-stat-grid {
            grid-template-columns: 1fr;
          }

          .premium-login-header {
            flex-direction: column;
          }

          .premium-login-title {
            font-size: 31px;
          }

          .premium-branch-card {
            grid-template-columns: auto 1fr;
          }

          .premium-branch-check {
            display: none;
          }

          .premium-password-grid,
          .premium-forgot-actions {
            grid-template-columns: 1fr;
          }

          .premium-password-toggle {
            width: 100%;
          }
        }
      `}</style>

      <div className="premium-login-noise" />

      <main className="premium-login-shell">
        <section className="premium-hero">
          <div>
            <div className="premium-brand-row">
              <div className="premium-brand-mark">
                <span>C03</span>
                <img
                  src="/chalin03-logo.png"
                  alt="Chalin 03 Logo"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              </div>

              <div>
                <p className="premium-brand-kicker">Group Operations Platform</p>
                <h2 className="premium-brand-name">Chalin 03 Company Ltd</h2>
              </div>
            </div>

            <div className="premium-hero-copy">
              <div className="premium-pill-row">
                <span className="premium-pill">● Spare parts</span>
                <span className="premium-pill">● Mining</span>
                <span className="premium-pill">● Equipment hire</span>
              </div>

              <h1 className="premium-hero-title">
                Welcome to the
                <br />
                <span className="premium-gold">control room.</span>
              </h1>

              <p className="premium-hero-subtitle">
                One secure group gateway for the live spare-parts operation and
                the new Mining Operations and Equipment Hire workspaces being
                built for Chalin 03 Company Limited.
              </p>
            </div>
          </div>

          <div className="premium-hero-bottom">
            <div className="premium-stat-grid">
              <div className="premium-stat-card">
                <strong>
                  {isSparePartsWorkspace
                    ? branchesLoading
                      ? "..."
                      : branches.length
                    : "Separate"}
                </strong>
                <span>
                  {isSparePartsWorkspace
                    ? "Spare Parts stores"
                    : "Business workspace"}
                </span>
              </div>

              <div className="premium-stat-card">
                <strong>Live</strong>
                <span>Business portal</span>
              </div>

              <div className="premium-stat-card">
                <strong>Secure</strong>
                <span>Staff access</span>
              </div>
            </div>

            <div className="premium-selected-store">
              <small>
                {isSparePartsWorkspace
                  ? "Selected Spare Parts store"
                  : "Selected independent workspace"}
              </small>
              <h2>{selectedContextTitle}</h2>
              <p>{selectedContextMessage}</p>
            </div>
          </div>
        </section>

        <section className="premium-login-panel">
          <div className="premium-login-header">
            <div>
              <p className="premium-login-eyebrow">Authorized staff only</p>
              <h1 className="premium-login-title">Staff Login</h1>
            </div>

            <div className="premium-secure-badge">● Secure</div>
          </div>

          <p className="premium-login-help">
            Choose the business first. Spare Parts requires one of its two stores.
            Mining Operations and Equipment Hire are independent and do not use
            those stores.
          </p>

          <BusinessWorkspaceSelector
            selectedCode={selectedWorkspaceCode}
            onSelect={handleWorkspaceSelect}
          />

          <form onSubmit={handleLogin} autoComplete="off" data-form-type="other">
            {isSparePartsWorkspace ? (
              <>
                <div className="premium-branch-title">
                  <label>Choose Spare Parts Store</label>
                  <span className="premium-branch-count">
                    {branchesLoading ? "Loading..." : `${branches.length} stores`}
                  </span>
                </div>

                {branchesError && (
                  <div className="premium-error-box">{branchesError}</div>
                )}

                {branchesLoading && (
                  <div className="premium-warning-box">
                    Loading Spare Parts stores...
                  </div>
                )}

                {!branchesLoading && branches.length === 0 && !branchesError && (
                  <div className="premium-error-box">
                    No active Spare Parts stores found. Please contact the system
                    administrator.
                  </div>
                )}

                <div className="premium-branch-grid">
                  {branches.map((branch) => {
                    const branchId = getBranchId(branch);
                    const active = Number(selectedBranchId) === branchId;

                    return (
                      <button
                        type="button"
                        key={branchId}
                        className={`premium-branch-card ${
                          active ? "active" : ""
                        }`}
                        onClick={() => setSelectedBranchId(String(branchId))}
                      >
                        <div className="premium-branch-icon">
                          {branch.is_head_office ? "🏢" : "🏬"}
                        </div>

                        <div className="premium-branch-info">
                          <strong>
                            {getBranchName(branch)}
                            {getBranchCode(branch)
                              ? ` — ${getBranchCode(branch)}`
                              : ""}
                          </strong>
                          <span>
                            {getBranchLocation(branch) || "No location set"}
                          </span>
                        </div>

                        <div className="premium-branch-check">✓</div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="premium-workspace-context-card">
                <span aria-hidden="true">{selectedWorkspace?.icon || "🏢"}</span>
                <div>
                  <strong>
                    {selectedWorkspace?.loginContextTitle ||
                      selectedWorkspace?.name}
                  </strong>
                  <p>{selectedWorkspace?.loginContextMessage}</p>
                  <small>
                    Administrator-managed sites and locations — no Spare Parts
                    store selection
                  </small>
                </div>
              </div>
            )}

            <div className="premium-form-box">
              {error ? (
                <div
                  className={`premium-error-box ${
                    errorCode === "ACCOUNT_LOCKED" ? "is-locked" : ""
                  }`}
                  role="alert"
                >
                  {errorCode === "ACCOUNT_LOCKED" ? (
                    <strong>Account blocked</strong>
                  ) : null}
                  <span>{error}</span>
                  {attemptsRemaining !== null &&
                  errorCode !== "ACCOUNT_LOCKED" ? (
                    <small>
                      Attempts remaining before block: {attemptsRemaining}
                    </small>
                  ) : null}
                </div>
              ) : null}

              <label>Username or phone number</label>
              <div className="premium-field-wrap">
                <span className="premium-field-icon">👤</span>
                <input
                  name="chalin03_login_username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username or Ghana phone number"
                  autoComplete="username"
                />
              </div>

              <label>Password</label>
              <div className="premium-password-grid">
                <div className="premium-field-wrap">
                  <span className="premium-field-icon">🔒</span>
                  <input
                    ref={passwordInputRef}
                    name="chalin03_login_secret_unstored"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    readOnly={!passwordFieldActivated}
                    onFocus={() => setPasswordFieldActivated(true)}
                    onPointerDown={() => setPasswordFieldActivated(true)}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    aria-label="Password"
                  />
                </div>

                <button
                  type="button"
                  className="premium-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <label className="premium-location-consent">
                <input
                  type="checkbox"
                  checked={sharePreciseLocation}
                  onChange={(event) =>
                    setSharePreciseLocation(event.target.checked)
                  }
                />
                <span>
                  <strong>Record this login device and precise location</strong>
                  <small>
                    Your browser may request location permission. Login continues
                    when permission is denied or unavailable.
                  </small>
                </span>
              </label>

              <button
                type="submit"
                className="premium-login-button"
                disabled={
                  loading ||
                  (isSparePartsWorkspace &&
                    (branchesLoading || !branches.length))
                }
              >
                {loading
                  ? `Checking device and opening ${
                      selectedWorkspace?.shortName || "workspace"
                    }...`
                  : selectedWorkspace
                  ? `Login to ${selectedWorkspace.shortName}`
                  : "Login"}
              </button>

              <button
                type="button"
                className="premium-forgot-button"
                onClick={openForgotPassword}
              >
                Forgot Password / Unlock Account?
              </button>
            </div>
          </form>

          {showForgotPassword && (
            <div className="premium-forgot-panel">
              <h3>Forgot Password / Unlock Account</h3>

              {forgotStage === "request" && (
                <form onSubmit={handleForgotPassword}>
                  <p>
                    Enter your username or phone number. Eligible accounts receive a 6-digit
                    recovery code on the registered phone. The code expires
                    after 5 minutes.
                  </p>

                  {forgotError && (
                    <div className="premium-error-box">{forgotError}</div>
                  )}

                  <label>Username or phone number</label>
                  <div className="premium-field-wrap">
                    <span className="premium-field-icon">👤</span>
                    <input
                      value={forgotUsername}
                      onChange={(event) =>
                        setForgotUsername(event.target.value)
                      }
                      placeholder="Username or Ghana phone number"
                      autoComplete="username"
                    />
                  </div>

                  <div className="premium-warning-box">
                    The original System Administrator cannot use ordinary SMS recovery. Use the separately protected Owner Break-Glass process for emergency administrator recovery.
                  </div>

                  <div className="premium-forgot-actions">
                    <button
                      type="submit"
                      className="premium-forgot-action"
                      disabled={forgotLoading}
                    >
                      {forgotLoading ? "Requesting..." : "Send Recovery Code"}
                    </button>

                    <button
                      type="button"
                      className="premium-forgot-cancel"
                      onClick={closeForgotPassword}
                      disabled={forgotLoading}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {forgotStage === "verify" && (
                <form onSubmit={handleRecoveryReset}>
                  <p>
                    Enter the code sent to the registered phone and choose a
                    new secure password. No employee should ask you to reveal
                    the code.
                  </p>

                  {forgotMessage && (
                    <div className="premium-success-box">{forgotMessage}</div>
                  )}

                  {forgotError && (
                    <div className="premium-error-box">{forgotError}</div>
                  )}

                  <label>Username or phone number</label>
                  <div className="premium-field-wrap">
                    <span className="premium-field-icon">👤</span>
                    <input
                      value={forgotUsername}
                      onChange={(event) =>
                        setForgotUsername(event.target.value)
                      }
                      placeholder="Username or Ghana phone number"
                      autoComplete="username"
                    />
                  </div>

                  <label>6-Digit Recovery Code</label>
                  <div className="premium-field-wrap">
                    <span className="premium-field-icon">🔐</span>
                    <input
                      value={recoveryCode}
                      onChange={(event) =>
                        setRecoveryCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6)
                        )
                      }
                      placeholder="000000"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                    />
                  </div>

                  <label>New Password</label>
                  <div className="premium-field-wrap">
                    <span className="premium-field-icon">🔑</span>
                    <input
                      type={showRecoveryPasswords ? "text" : "password"}
                      value={recoveryNewPassword}
                      onChange={(event) =>
                        setRecoveryNewPassword(event.target.value)
                      }
                      placeholder="8+ characters with upper/lower, number and symbol"
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>

                  <label>Confirm New Password</label>
                  <div className="premium-field-wrap">
                    <span className="premium-field-icon">✓</span>
                    <input
                      type={showRecoveryPasswords ? "text" : "password"}
                      value={recoveryConfirmPassword}
                      onChange={(event) =>
                        setRecoveryConfirmPassword(event.target.value)
                      }
                      placeholder="Confirm the new password"
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      marginBottom: "14px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showRecoveryPasswords}
                      onChange={(event) =>
                        setShowRecoveryPasswords(event.target.checked)
                      }
                      style={{
                        width: "auto",
                        margin: 0,
                        padding: 0,
                      }}
                    />
                    <span>Show passwords while typing</span>
                  </label>

                  <div className="premium-forgot-actions">
                    <button
                      type="submit"
                      className="premium-forgot-action"
                      disabled={forgotLoading}
                    >
                      {forgotLoading ? "Verifying..." : "Reset Password"}
                    </button>

                    <button
                      type="button"
                      className="premium-forgot-cancel"
                      onClick={restartForgotPassword}
                      disabled={forgotLoading}
                    >
                      Request New Code
                    </button>
                  </div>
                </form>
              )}

              {forgotStage === "complete" && (
                <div>
                  <div className="premium-success-box">
                    {forgotMessage ||
                      "Password changed successfully. You may now login."}
                  </div>

                  <p>
                    All previous sessions were signed out. Enter the new
                    password in the normal login form.
                  </p>

                  <button
                    type="button"
                    className="premium-forgot-action"
                    onClick={closeForgotPassword}
                  >
                    Return to Login
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="premium-login-footer">
            Protected Chalin 03 access. Your selected workspace opens only after
            successful login, and every action remains traceable.
          </p>
        </section>
      </main>
    </div>
  );
}
