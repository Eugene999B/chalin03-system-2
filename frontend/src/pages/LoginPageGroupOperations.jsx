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
import "../styles/chalin03LoginEmojiFinal.css";

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

function branchId(branch) { return Number(branch?.id || branch?.branch_id || 0); }
function branchName(branch) { return branch?.name || branch?.branch_name || "Store"; }
function branchCode(branch) { return branch?.code || branch?.branch_code || "STORE"; }
function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) return data.branches;
  if (Array.isArray(data?.stores)) return data.stores;
  return Array.isArray(data) ? data : [];
}
function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Personal device";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  return `${mobile ? "Mobile" : "Computer"} · ${platform}`.slice(0, 120);
}
function promptCancelled(error) { const name = String(error?.name || ""); return name.includes("NotAllowed") || name.includes("Abort"); }
function passwordPolicyError(password) {
  const value = String(password || "");
  if (value.length < 8) return "New password must contain at least 8 characters.";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) return "Use uppercase and lowercase letters.";
  if (!/\d/.test(value)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Include at least one symbol.";
  return "";
}
function persistBiometricSession(payload, fallbackWorkspaceCode) {
  const token = String(payload?.token || "").trim();
  const rawUser = payload?.user;
  if (!token || !rawUser) throw new Error("The secure login response is incomplete.");
  const user = { ...rawUser, workspace_code: rawUser.workspace_code || payload?.workspace?.code || fallbackWorkspaceCode, active_workspace: rawUser.active_workspace || payload?.workspace || null };
  localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { ...payload, token, user };
}
function FingerprintIcon() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 20c1-6 5-9 10-9 7 0 12 5 12 12 0 8-2 14-6 20" /><path d="M10 24c0-9 6-16 15-16 10 0 17 7 17 17" /><path d="M16 26c0-6 3-10 9-10 5 0 8 4 8 9 0 8-2 13-5 18" /><path d="M22 26c0-2 1-4 3-4s3 2 3 4c0 7-1 12-3 17M10 31c1 5 3 9 7 12" /></svg>;
}
function GroupOperationsMap() {
  return <div className="group-operations-map" aria-label="Three connected Chalin 03 businesses"><svg viewBox="0 0 360 250" aria-hidden="true"><path d="M180 118 L82 58" /><path d="M180 118 L278 58" /><path d="M180 118 L180 210" /></svg><div className="group-operations-map__centre"><img src="/chalin03-logo.png" alt="" /><strong>CHALIN 03</strong><small>GROUP</small></div><div className="group-operations-map__node is-parts"><span>🧰</span><strong>Spare Parts</strong><small>Sales & inventory</small></div><div className="group-operations-map__node is-mining"><span>⛏️</span><strong>Mining</strong><small>Site operations</small></div><div className="group-operations-map__node is-hire"><span>🚜</span><strong>Sales & Hire</strong><small>Equipment operations</small></div></div>;
}

export default function LoginPageGroupOperations() {
  const { isLoggedIn, login, workspaceCode: activeWorkspaceCode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const passwordRef = useRef(null);
  const passwordFieldName = `chalin03-entry-${useId().replace(/:/g, "")}`;
  const requestedWorkspace = getBusinessWorkspace(searchParams.get("workspace"));
  const [workspaceCode, setWorkspaceCode] = useState(requestedWorkspace?.code || DEFAULT_WORKSPACE);
  const workspace = getBusinessWorkspace(workspaceCode) || getBusinessWorkspace(DEFAULT_WORKSPACE);
  const isSpareParts = workspaceCode === DEFAULT_WORKSPACE;
  const [branches, setBranches] = useState([]); const [selectedBranchId, setSelectedBranchId] = useState(""); const [branchesLoading, setBranchesLoading] = useState(true); const [branchesError, setBranchesError] = useState(""); const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState(""); const [passwordUnlocked, setPasswordUnlocked] = useState(false); const [showPassword, setShowPassword] = useState(false); const [shareLocation, setShareLocation] = useState(true); const [advancedOpen, setAdvancedOpen] = useState(false); const [emergencyMode, setEmergencyMode] = useState(false); const [loadingMode, setLoadingMode] = useState(""); const [postLoginProcessing, setPostLoginProcessing] = useState(false); const [progressMessage, setProgressMessage] = useState(""); const [error, setError] = useState(""); const [attemptsRemaining, setAttemptsRemaining] = useState(null); const [bindingLoading, setBindingLoading] = useState(true); const [biometricAvailable, setBiometricAvailable] = useState(false); const [biometricBinding, setBiometricBinding] = useState(null); const [pendingSession, setPendingSession] = useState(null); const [consentOpen, setConsentOpen] = useState(false); const [consentError, setConsentError] = useState(""); const [consentLoading, setConsentLoading] = useState(false); const [recoveryOpen, setRecoveryOpen] = useState(false); const [recoveryStage, setRecoveryStage] = useState("request"); const [recoveryIdentifier, setRecoveryIdentifier] = useState(""); const [recoveryCode, setRecoveryCode] = useState(""); const [recoveryPassword, setRecoveryPassword] = useState(""); const [recoveryConfirm, setRecoveryConfirm] = useState(""); const [recoveryLoading, setRecoveryLoading] = useState(false); const [recoveryMessage, setRecoveryMessage] = useState(""); const [recoveryError, setRecoveryError] = useState("");
  const selectedBranch = useMemo(() => branches.find((branch) => branchId(branch) === Number(selectedBranchId)), [branches, selectedBranchId]);
  useEffect(() => { function clearPasswordField(){ setPassword(""); setShowPassword(false); setPasswordUnlocked(false); if(passwordRef.current) passwordRef.current.value=""; } clearPasswordField(); window.addEventListener("pageshow",clearPasswordField); return()=>window.removeEventListener("pageshow",clearPasswordField); },[]);
  useEffect(() => { let cancelled=false; async function inspectDevice(){ setBindingLoading(true); try{ const available=await isBiometricAccessAvailable(); if(cancelled)return; setBiometricAvailable(available); if(!available){setBiometricBinding(null);return;} const result=await validateStoredBiometricBinding(); if(!cancelled)setBiometricBinding(result.valid?result.stored:null);}catch{if(!cancelled){setBiometricAvailable(false);setBiometricBinding(null);}}finally{if(!cancelled)setBindingLoading(false);}} inspectDevice(); return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(requestedWorkspace?.code)setWorkspaceCode(requestedWorkspace.code);},[requestedWorkspace?.code]);
  useEffect(()=>{setAdvancedOpen(false);setEmergencyMode(false);setError("");setPassword("");setPasswordUnlocked(false);},[workspaceCode]);
  useEffect(()=>{let cancelled=false; if(!isSpareParts){setBranchesLoading(false);setBranchesError("");setSelectedBranchId("");return()=>{cancelled=true;};} async function loadBranches(){setBranchesLoading(true);setBranchesError("");try{const response=await axiosClient.get("/branches/public");const list=normalizeBranches(response.data);if(cancelled)return;setBranches(list);setSelectedBranchId(current=>list.some(branch=>branchId(branch)===Number(current))?current:(list[0]?String(branchId(list[0])):""));}catch(requestError){if(!cancelled)setBranchesError(requestError.response?.data?.message||"Could not load Spare Parts stores. Check the internet connection.");}finally{if(!cancelled)setBranchesLoading(false);}} loadBranches();return()=>{cancelled=true;};},[isSpareParts]);
  if(isLoggedIn&&!postLoginProcessing)return <Navigate to={dashboardPath(activeWorkspaceCode)} replace />;
  function chooseWorkspace(code){if(!getBusinessWorkspace(code))return;setWorkspaceCode(code);const params=new URLSearchParams(searchParams);if(code===DEFAULT_WORKSPACE)params.delete("workspace");else params.set("workspace",code);setSearchParams(params,{replace:true});}
  const busy=Boolean(loadingMode); const contextLabel=isSpareParts?(selectedBranch?`${branchCode(selectedBranch)} · ${branchName(selectedBranch)}`:"Choose store"):workspace.loginContextTitle; const boundAccountName=biometricBinding?.account?.full_name||biometricBinding?.account?.username||"";
  return <main className={`gate4 biometric-login group-login group-login--${workspaceCode}`}><section className="gate4__shell"><header className="gate4__topbar"><div className="gate4__brand"><div className="gate4__logo"><span>C03</span></div><div><small>Chalin 03 Company Limited</small><strong>Business Operating System</strong></div></div><div className="gate4__status"><span className="gate4__version">{APP_RELEASE_LABEL}</span><span className="gate4__online"><i/> Online</span></div></header><div className="gate4__layout"><aside className="gate4__story group-login__story"><div className="gate4__story-copy"><small>Chalin 03 Group Operations</small><h1>One company. <span>Three connected businesses.</span></h1><p>Spare Parts, Mining Operations and Equipment Sales & Hire share one professional operating platform while keeping each business record, location and permission securely separated.</p></div><GroupOperationsMap/><div className="gate4__story-foot"><span><i/> One secure staff account</span><span><i/> Separate business records</span><span><i/> Dashboard first after every login</span></div></aside><section className="gate4__access"><div className="gate4__access-heading"><div><small>Secure access</small><h2>Welcome back</h2><p>Select a business and continue.</p></div></div><div className="gate4__workspace-tabs" aria-label="Choose business workspace">{businessWorkspaces.map(item=><button type="button" key={item.code} className={item.code===workspaceCode?"is-selected":""} onClick={()=>chooseWorkspace(item.code)} aria-pressed={item.code===workspaceCode}><span>{item.icon}</span><strong>{item.shortName}</strong><i>{item.code===workspaceCode?"✓":""}</i></button>)}</div><div className="gate4__context-strip"><div className="gate4__context-icon">{workspace.icon}</div><div><small>{workspace.name}</small><strong>{contextLabel}</strong></div><span>{dashboardLabel(workspaceCode)}</span></div>{isSpareParts&&<label className="gate4__field gate4__field--store"><span>Spare Parts store</span><select value={selectedBranchId} onChange={event=>setSelectedBranchId(event.target.value)} disabled={branchesLoading||busy}><option value="">{branchesLoading?"Loading stores…":"Choose store"}</option>{branches.map(branch=><option value={branchId(branch)} key={branchId(branch)}>{branchCode(branch)} — {branchName(branch)}</option>)}</select></label>}{branchesError&&<div className="gate4__alert gate4__alert--error">{branchesError}</div>}{!bindingLoading&&biometricAvailable&&biometricBinding&&<button type="button" className="gate4__passkey biometric-login__continue" onClick={()=>{}} disabled={busy||branchesLoading}><span className="gate4__passkey-icon"><FingerprintIcon/></span><div><strong>Continue as {boundAccountName}</strong><small>Use fingerprint or face for this account only</small></div><b>→</b></button>}<div className="gate4__divider"><span>{biometricAvailable&&biometricBinding?"or use password":"password required on this device"}</span></div><form className="gate4__form" autoComplete="off"><label className="gate4__field"><span>Username or phone number</span><input value={identifier} onChange={event=>setIdentifier(event.target.value)} disabled={busy}/></label><label className="gate4__field"><span>Password</span><div className="gate4__password"><input ref={passwordRef} name={passwordFieldName} value={password} onChange={event=>setPassword(event.target.value)} type={showPassword?"text":"password"} readOnly={!passwordUnlocked} data-lpignore="true" placeholder="Enter password" disabled={busy}/><button type="button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?"Hide":"Show"}</button></div></label><button className="gate4__submit" type="submit" disabled={busy||branchesLoading}><span>→</span><div><strong>Sign in to Chalin 03</strong><small>Your password is never pre-filled by Chalin 03</small></div></button></form></section></div></section></main>;
}
