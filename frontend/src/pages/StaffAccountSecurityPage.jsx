import {useEffect,useState} from "react";
import {Navigate} from "react-router";
import {useAuth} from "../context/AuthContext";
import axiosClient from "../api/axiosClient";
import "../styles/staffPasswordlessLogin.css";

const BASE="/auth/passwordless";
const HOME={spare_parts:"/",mining:"/mining",equipment_hire:"/equipment-hire-operations"};
function exportCodes(codes){
 const canvas=document.createElement("canvas");canvas.width=1000;canvas.height=950;
 const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image export is not supported in this browser.");
 ctx.fillStyle="#f7f5ef";ctx.fillRect(0,0,1000,950);
 ctx.fillStyle="#173e35";ctx.fillRect(0,0,1000,150);
 ctx.fillStyle="white";ctx.font="bold 40px system-ui";ctx.fillText("CHALIN03",54,75);
 ctx.font="23px system-ui";ctx.fillText("Private account recovery codes",54,118);
 ctx.fillStyle="#22473d";ctx.font="22px system-ui";ctx.fillText("Store this image privately. Each code works only once.",54,205);
 codes.forEach((code,index)=>{
  const x=54+(index>=5?470:0),y=255+(index%5)*112;
  ctx.fillStyle="#e1e9e1";ctx.fillRect(x,y,420,83);
  ctx.fillStyle="#173e35";ctx.font="bold 29px monospace";ctx.fillText(code,x+22,y+54);
 });
 ctx.fillStyle="#775e3a";ctx.font="20px system-ui";ctx.fillText("Never share your Authenticator or recovery codes.",54,885);
 const a=document.createElement("a");a.href=canvas.toDataURL("image/png");
 a.download="CHALIN03-private-backup-codes.png";document.body.appendChild(a);a.click();a.remove();
}
export default function StaffAccountSecurityPage(){
 const {isLoggedIn,loading,user,completePasswordlessLogin}=useAuth();
 const [state,setState]=useState(null),[mode,setMode]=useState(false);
 const [pending,setPending]=useState(null),[code,setCode]=useState(""),[codes,setCodes]=useState([]);
 const [saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [googleCode,setGoogleCode]=useState(""),[googleStep,setGoogleStep]=useState(false);
 useEffect(()=>{let active=true;
  Promise.all([axiosClient.get(BASE+"/mode"),axiosClient.get(BASE+"/account/status")])
   .then(([m,s])=>{if(active){setMode(m.data?.pilot===true);setState(s.data);}})
   .catch(()=>{if(active){setMode(false);setState({status:"unavailable"});}});
  return()=>{active=false};
 },[]);
 if(!loading&&!isLoggedIn)return <Navigate to="/login" replace/>;
 const back=HOME[user?.workspace_code]||"/";
 async function linkGoogle(event){
  event.preventDefault();setError("");setBusy(true);
  try{
    const r=await axiosClient.post(BASE+"/google/start",{authenticator_code:googleCode});
    const url=new URL(r.data?.authorization_url);
    if(url.origin!=="https://accounts.google.com")throw new Error("Google sign-in address could not be verified.");
    window.location.assign(url.href);
  }catch(err){setError(err.response?.data?.message||err.message||"Unable to connect Google account.");setBusy(false);}
 }
 async function startAdmin(){
  setBusy(true);setError("");setMessage("");
  try{const r=await axiosClient.post(BASE+"/administrator/start");
   setPending(r.data);setCode("");setMessage("Scan this QR code in your Authenticator app, then enter the current code to activate your account.");
  }catch(e){setError(e.response?.data?.message||"Unable to begin setup. Sign in again from your trusted administrator session.");}
  finally{setBusy(false);}
 }
 async function confirm(e){
  e.preventDefault();setBusy(true);setError("");
  try{const r=await axiosClient.post(BASE+"/setup/confirm",{challenge:pending.challenge,code:code.trim()});
   completePasswordlessLogin(r.data,user?.workspace_code);
   setCodes(r.data.recovery_codes||[]);setPending(null);setCode("");setSaved(false);
   setState(s=>({...s,authenticator_active:true}));
   setMessage("Authenticator is active. Download your recovery codes and keep them private.");
  }catch(e){setError(e.response?.data?.message||"The code could not be verified.");}
  finally{setBusy(false);}
 }
 if(loading||!state)return <main className="psl-page" style={{display:"grid",placeItems:"center"}}>Loading account security…</main>;
 return <main className="psl-page">
   <header className="psl-header"><a className="psl-logo" href={back}><img src="/chalin03-logo.png" width="44" height="44" alt=""/><span>CHALIN<span>03</span><small>COMPANY LIMITED</small></span></a><span className="psl-header__label">MY ACCOUNT</span></header>
   <div className="psl-frame">
    <aside className="psl-aside"><span className="psl-kicker">YOUR PERSONAL WORKSPACE</span><h1>Account<br/><em>security.</em></h1>
     <p>Manage your sign-in security. Changes to your role, store or business permissions remain under administrator control.</p>
     <div className="psl-aside__rule"/><div className="psl-aside__foot"><span>PRIVATE ACCOUNT</span><span>SECURE ACCESS</span></div>
    </aside>
    <section className="psl-panel">
     <div className="psl-panel__eyebrow">PERSONAL SETTINGS</div><h2>{user?.full_name||user?.username||"My account"}</h2>
     <p className="psl-sub">Username: <strong>{user?.username}</strong></p>
     <div className="psl-setting"><div><strong>Authenticator</strong><small>{state.authenticator_active?"Enabled · Your sign-in codes are active":"Not set up yet"}</small></div><span>{state.authenticator_active?"Active":"Pending"}</span></div>
     <div className="psl-setting"><div><strong>Google account</strong><small>{state.google_linked?"Linked to "+state.google_email:state.google_linking_available?"Connect a verified Google account to your CHALIN03 profile.":"Linking becomes available when Google sign-in is configured."}</small></div><span>{state.google_linked?"Linked":"Not linked"}</span></div>
     {mode&&state.authenticator_active&&!state.google_linked&&state.google_linking_available&&
      <div className="psl-google">
       {!googleStep?<button className="psl-outline" type="button" onClick={()=>setGoogleStep(true)}>Connect Google account</button>:
        <form className="psl-fields" onSubmit={linkGoogle}>
         <label htmlFor="google-auth-code">Confirm with current Authenticator code</label>
         <input id="google-auth-code" autoComplete="one-time-code" inputMode="numeric" value={googleCode} onChange={e=>setGoogleCode(e.target.value.replace(/\D/g,"").slice(0,6))} maxLength={6} required placeholder="6-digit code"/>
         <button className="psl-primary" disabled={busy||googleCode.length!==6}>Continue to Google <span>→</span></button>
         <button className="psl-link" type="button" onClick={()=>{setGoogleStep(false);setGoogleCode("")}}>Cancel</button>
        </form>}
      </div>}
     {mode&&!state.authenticator_active&&user?.is_original_system_administrator&&!pending&&!codes.length&&
      <button className="psl-primary" disabled={busy} type="button" onClick={startAdmin}>{busy?"Preparing…":"Set up administrator Authenticator"}<span>→</span></button>}
     {pending&&<form className="psl-fields" onSubmit={confirm}>
       <div className="psl-qr"><img src={pending.qr_data_url} alt="Admin Authenticator QR code" width="210" height="210"/></div>
       <label htmlFor="admin-secret">Manual setup key</label><div className="psl-key"><code id="admin-secret">{pending.secret}</code><button type="button" onClick={()=>navigator.clipboard?.writeText(pending.secret)}>Copy</button></div>
       <label htmlFor="admin-mfa-code">Current Authenticator code</label><input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} required placeholder="6-digit code"/>
       <button className="psl-primary" disabled={busy||code.length!==6}>{busy?"Verifying…":"Activate my Authenticator"}<span>→</span></button>
      </form>}
     {codes.length>0&&<div className="psl-backup"><p className="psl-sub">These codes are displayed once. Download them and store them securely.</p>
      <div className="psl-backup__grid">{codes.map(c=><code key={c}>{c}</code>)}</div>
      <button type="button" className="psl-outline" onClick={()=>{try{exportCodes(codes)}catch(e){setError(e.message)}}}>Download codes as PNG image</button>
      <label className="psl-confirm"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I have stored these codes privately.</label>
      <button className="psl-primary" type="button" disabled={!saved} onClick={()=>{setCodes([]);setMessage("Your Authenticator is ready.")}}>Finish setup <span>→</span></button>
     </div>}
     {message&&<div role="status" className="psl-note">{message}</div>}
     {error&&<div role="alert" className="psl-error">{error}</div>}
     <a className="psl-back" href={back}>Back to workspace</a>
     <footer className="psl-panel__footer">Your sign-in methods do not change the permissions assigned to you.</footer>
    </section>
   </div>
  </main>;
}
