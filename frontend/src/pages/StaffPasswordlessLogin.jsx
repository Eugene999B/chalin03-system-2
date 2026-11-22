import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import {useAuth} from "../context/AuthContext";
import {Navigate} from "react-router";
import {businessWorkspaces} from "../data/businessWorkspaces";
import "../styles/staffPasswordlessLogin.css";

const HOME={spare_parts:"/",mining:"/mining",equipment_hire:"/equipment-hire-operations"};
const ENDPOINT="/auth/passwordless";
function saveBackupPng(codes){
 const canvas=document.createElement("canvas");canvas.width=1040;canvas.height=1060;
 const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image export is unavailable on this device.");
 ctx.fillStyle="#f7f5ee";ctx.fillRect(0,0,1040,1060);
 ctx.fillStyle="#163e38";ctx.fillRect(0,0,1040,180);
 ctx.fillStyle="#fff";ctx.font="bold 42px system-ui";ctx.fillText("CHALIN03",64,84);
 ctx.font="24px system-ui";ctx.fillText("Private account recovery codes",64,132);
 ctx.fillStyle="#243c39";ctx.font="23px system-ui";ctx.fillText("Store this picture in a private, secure location.",64,230);
 ctx.fillText("Each code can be used once if your Authenticator is unavailable.",64,272);
 codes.forEach((code,index)=>{
  const col=index<5?0:1,row=index%5;
  ctx.fillStyle="#dfe7df";ctx.fillRect(64+col*480,310+row*116,432,88);
  ctx.fillStyle="#173d36";ctx.font="bold 33px ui-monospace, monospace";ctx.fillText(code,86+col*480,363+row*116);
 });
 ctx.fillStyle="#795b37";ctx.font="20px system-ui";
 ctx.fillText("Never share these codes with anyone, including CHALIN03 support.",64,970);
 const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download="CHALIN03-private-recovery-codes.png";document.body.appendChild(a);a.click();a.remove();
}
function readError(error){return error.response?.data?.message||"Could not complete this step. Check your connection and try again.";}
export default function StaffPasswordlessLogin(){
 const {completePasswordlessLogin,isLoggedIn,user}=useAuth();
 const [workspace,setWorkspace]=useState("spare_parts"),[branchId,setBranchId]=useState(""),[branches,setBranches]=useState([]);
 const [identifier,setIdentifier]=useState(""),[code,setCode]=useState(""),[challenge,setChallenge]=useState("");
 const [step,setStep]=useState("identify"),[setup,setSetup]=useState(null),[pendingSession,setPendingSession]=useState(null);
 const [backupCodes,setBackupCodes]=useState([]),[saved,setSaved]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [backupMode,setBackupMode]=useState(false);
 useEffect(()=>{let alive=true;axiosClient.get("/branches/public").then(r=>{
  if(!alive)return;const list=Array.isArray(r.data?.branches)?r.data.branches:Array.isArray(r.data?.stores)?r.data.stores:[];
  setBranches(list);setBranchId(String(list[0]?.id||list[0]?.branch_id||""));
 }).catch(()=>{if(alive)setBranches([])});return()=>{alive=false}},[]);
 async function request(event){
  event.preventDefault();if(!identifier.trim()||(workspace==="spare_parts"&&!branchId))return;
  setError("");setBusy(true);
  try{const r=await axiosClient.post(ENDPOINT+"/start",{identifier:identifier.trim(),workspace_code:workspace,branch_id:workspace==="spare_parts"?Number(branchId):null});
   setChallenge(r.data.challenge);setCode("");setStep(r.data.stage==="sms"?"sms":"authenticator");
   setNotice(r.data.stage==="sms"?"A verification code has been sent to the phone registered to this account.":"Enter the six-digit code from your Authenticator app.");
  }catch(err){setError(readError(err))}finally{setBusy(false)}
 }
 async function verifySms(event){
  event.preventDefault();setError("");setBusy(true);
  try{const r=await axiosClient.post(ENDPOINT+"/sms/verify",{challenge,code:code.trim()});
   setSetup(r.data);setCode("");setStep("setup");setNotice("Scan the QR code or enter the setup key in your authenticator app.");
  }catch(err){setError(readError(err))}finally{setBusy(false)}
 }
 async function finishSession(data){
  const result=completePasswordlessLogin(data,workspace);
  window.location.assign(HOME[result.user?.workspace_code]||HOME[workspace]);
 }
 async function verifyAuthenticator(event){
  event.preventDefault();setError("");setBusy(true);
  try{
   const r=await axiosClient.post(ENDPOINT+(step==="setup"?"/setup/confirm":"/verify"),{challenge,code:code.trim()});
   if(step==="setup"){setPendingSession(r.data);setBackupCodes(r.data.recovery_codes||[]);setCode("");setSaved(false);setStep("backup");setNotice("Save these private recovery codes before entering the system.");}
   else await finishSession(r.data);
  }catch(err){setError(readError(err))}finally{setBusy(false)}
 }
 function restart(){setStep("identify");setSetup(null);setChallenge("");setCode("");setBackupMode(false);setError("");setNotice("");}
 if(isLoggedIn&&step!=="backup")return <Navigate to={HOME[user?.workspace_code]||"/"} replace/>;
 return <main className="psl-page">
  <header className="psl-header"><a href="https://homepage.chalin03.com" aria-label="CHALIN03 company homepage" className="psl-logo">
   <img src="/chalin03-logo.png" width="44" height="44" alt=""/><span>CHALIN<span>03</span><small>COMPANY LIMITED</small></span></a>
   <span className="psl-header__label">SECURE STAFF ACCESS</span></header>
  <div className="psl-frame">
   <aside className="psl-aside"><span className="psl-kicker">THE CHALIN03 WORKSPACE</span>
    <h1>One secure account.<br/><em>Your work, ready.</em></h1>
    <p>Access your assigned business workspace using a trusted authenticator app. Every account keeps its own permissions.</p>
    <div className="psl-aside__rule"/><div className="psl-aside__foot"><span>01 / VERIFIED IDENTITY</span><span>02 / PRIVATE ACCOUNT</span><span>03 / CONTROLLED ACCESS</span></div>
   </aside>
   <section className="psl-panel" aria-labelledby="psl-heading">
    <div className="psl-panel__eyebrow">{step==="identify"?"01 / YOUR ACCOUNT":step==="sms"?"02 / VERIFY PHONE":step==="setup"?"03 / SET UP AUTHENTICATOR":step==="backup"?"04 / SAVE RECOVERY CODES":"02 / SECURE VERIFICATION"}</div>
    <h2 id="psl-heading">{step==="identify"?"Welcome back":step==="sms"?"Confirm your identity":step==="setup"?"Secure your account":step==="backup"?"Keep these codes safe":"Enter your security code"}</h2>
    <p className="psl-sub">{step==="identify"?"Enter your username or registered phone number to continue.":step==="sms"?"This SMS is used only for your first account setup.":step==="setup"?"Add CHALIN03 to Google Authenticator or any compatible app.":step==="backup"?"These one-time codes replace your Authenticator if you lose access to it.":backupMode?"Enter one of the recovery codes you saved during setup.":"Open your Authenticator app and enter the current six-digit code."}</p>
    {step==="identify"&&<form onSubmit={request} className="psl-fields">
     <label htmlFor="psl-workspace">Business workspace</label>
     <select id="psl-workspace" value={workspace} onChange={e=>{setWorkspace(e.target.value);setError("")}}>
      {businessWorkspaces.map(x=><option value={x.code} key={x.code}>{x.name}</option>)}
     </select>
     {workspace==="spare_parts"&&<><label htmlFor="psl-store">Store</label><select id="psl-store" value={branchId} onChange={e=>setBranchId(e.target.value)} required>
      <option value="">Choose a store</option>{branches.map(x=><option value={x.id||x.branch_id} key={x.id||x.branch_id}>{x.name||x.branch_name}</option>)}
     </select></>}
     <label htmlFor="psl-identifier">Username or phone number</label><input id="psl-identifier" value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete="username" placeholder="e.g. your username or 024..." required maxLength={120}/>
     <button className="psl-primary" disabled={busy||!identifier.trim()||(workspace==="spare_parts"&&!branchId)}>{busy?"Checking account…":"Continue securely"}<span aria-hidden="true">→</span></button>
    </form>}
    {step==="sms"&&<form onSubmit={verifySms} className="psl-fields">
     <label htmlFor="psl-code">SMS verification code</label><input id="psl-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="6-digit code" maxLength={6} required/>
     <button className="psl-primary" disabled={busy||code.length!==6}>{busy?"Verifying…":"Verify phone"}<span aria-hidden="true">→</span></button>
    </form>}
    {step==="setup"&&<form onSubmit={verifyAuthenticator} className="psl-fields">
      <div className="psl-qr"><img src={setup?.qr_data_url} alt="QR code to add this account to your authenticator app" width="210" height="210"/></div>
      <label htmlFor="psl-secret">Manual setup key</label><div className="psl-key"><code id="psl-secret">{setup?.secret}</code><button type="button" onClick={()=>navigator.clipboard?.writeText(setup?.secret||"")}>Copy</button></div>
      <label htmlFor="psl-code">Authenticator code</label><input id="psl-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="Current 6-digit code" required maxLength={6}/>
      <button className="psl-primary" disabled={busy||code.length!==6}>{busy?"Verifying…":"Activate Authenticator"}<span aria-hidden="true">→</span></button>
    </form>}
    {step==="authenticator"&&<form onSubmit={verifyAuthenticator} className="psl-fields">
      <label htmlFor="psl-code">{backupMode?"Backup recovery code":"Authenticator code"}</label>
      <input id="psl-code" value={code} onChange={e=>setCode(e.target.value.toUpperCase().slice(0,backupMode?12:6))} autoComplete="one-time-code" inputMode={backupMode?"text":"numeric"} placeholder={backupMode?"XXXXX-XXXXX":"6-digit code"} required maxLength={backupMode?12:6}/>
      <button className="psl-primary" disabled={busy||(backupMode?code.length<10:code.length!==6)}>{busy?"Verifying…":"Sign in"}<span aria-hidden="true">→</span></button>
      <button type="button" className="psl-link" onClick={()=>{setBackupMode(v=>!v);setCode("")}}>{backupMode?"Use Authenticator instead":"Use a backup recovery code"}</button>
    </form>}
    {step==="backup"&&<div className="psl-backup">
     <div className="psl-backup__grid">{backupCodes.map(c=><code key={c}>{c}</code>)}</div>
     <button type="button" className="psl-outline" onClick={()=>{try{saveBackupPng(backupCodes)}catch(e){setError(e.message)}}}>Download as PNG image</button>
     <label className="psl-confirm"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I have saved my backup codes privately.</label>
     <button className="psl-primary" disabled={!saved||busy} onClick={()=>finishSession(pendingSession)}>Enter my workspace<span aria-hidden="true">→</span></button>
    </div>}
    {notice&&<div className="psl-note" role="status">{notice}</div>}
    {error&&<div className="psl-error" role="alert">{error}</div>}
    {step!=="identify"&&step!=="backup"&&<button className="psl-back" type="button" onClick={restart}>Back to account</button>}
    <footer className="psl-panel__footer">Keep Authenticator and recovery codes private. CHALIN03 will never ask you to send them.</footer>
   </section>
  </div>
 </main>;
}
