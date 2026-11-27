import {useEffect,useRef,useState} from "react";
import "../styles/staffTurnstile.css";
let scriptPromise;
function loadTurnstile(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(scriptPromise)return scriptPromise;
 scriptPromise=new Promise((resolve,reject)=>{
  const script=document.createElement("script");
  script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async=true;script.defer=true;
  script.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error("Security widget not ready"));
  script.onerror=()=>{script.remove();reject(new Error("Security widget unavailable"));};
  document.head.appendChild(script);
 }).catch(err=>{scriptPromise=null;throw err;});
 return scriptPromise;
}
export default function StaffTurnstile({siteKey,onToken}){
 const container=useRef(null);
 const [status,setStatus]=useState("loading"),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,widget,api;
  onToken("");
  loadTurnstile().then(turnstile=>{
   if(!active||!container.current)return;
   api=turnstile;
   widget=api.render(container.current,{
    sitekey:siteKey,action:"staff_login",theme:"light",size:"flexible",appearance:"always",
    callback:token=>{if(active){onToken(token);setStatus("verified");}},
    "expired-callback":()=>{if(active){onToken("");setStatus("loading");api.reset(widget);}},
    "error-callback":()=>{if(active){onToken("");setStatus("error");}}
   });
  }).catch(()=>{if(active){onToken("");setStatus("error");}});
  return ()=>{active=false;if(api&&widget!==undefined)api.remove(widget);};
 },[siteKey,onToken,attempt]);
 return <div className="staff-turnstile">
  <div className="staff-turnstile__widget" ref={container}/>
  <div className="staff-turnstile__status" role="status">{status==="verified"?"Security check complete":status==="error"?"Security verification could not load.":"Checking your connection…"}</div>
  {status==="error"&&<button type="button" onClick={()=>{setStatus("loading");setAttempt(n=>n+1);}}>Retry security check</button>}
 </div>;
}
