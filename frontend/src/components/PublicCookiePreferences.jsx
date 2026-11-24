import {useEffect,useState} from "react";
import {useLocation} from "react-router";
import {PATH_ON_PREVIEW,siteForHostname,siteHref} from "../config/officialSites";
import "../styles/publicEditorial2026.css";
const CONSENT="chalin03_cookie_choice_v1",LAST="chalin03_recent_business_v1";
const labels={parts:"Spare Parts Shop",excavators:"Excavators",machines:"Heavy-duty machinery",automobiles:"Automobiles",motorcycles:"Motorcycles",gold:"Gold buying & refining",transport:"Machine transport",hire:"Equipment hire"};
const getCookie=(key)=>document.cookie.split(";").map(s=>s.trim()).find(s=>s.startsWith(key+"="))?.slice(key.length+1)||"";
function writeCookie(name,value,age){
 const host=window.location.hostname;
 const domain=host==="chalin03.com"||host.endsWith(".chalin03.com")?"; Domain=chalin03.com":"";
 document.cookie=name+"="+value+"; Path=/; Max-Age="+age+"; SameSite=Lax"+domain+(window.location.protocol==="https:"?"; Secure":"");
}
function readChoice(){const v=getCookie(CONSENT);return ["accepted","rejected"].includes(v)?v:"";}
export default function PublicCookiePreferences(){
 const location=useLocation();
 const host=window.location.hostname.toLowerCase();
 const site=siteForHostname(host);
 const publicPaths=Object.values(PATH_ON_PREVIEW).filter(p=>p!=="/login");
 const visible=site!=="work"&&(location.pathname==="/"||publicPaths.includes(location.pathname)||location.pathname==="/enquire")&&(site||host==="localhost"||host==="127.0.0.1"||host.endsWith(".pages.dev"));
 const [choice,setChoice]=useState(readChoice),[open,setOpen]=useState(false),[details,setDetails]=useState(false),[recent,setRecent]=useState(()=>getCookie(LAST));
 useEffect(()=>{
  if(!visible||choice!=="accepted")return;
  const key=labels[site]?site:Object.keys(labels).find(k=>PATH_ON_PREVIEW[k]===location.pathname&&location.pathname!=="/");
  if(key){writeCookie(LAST,key,60*60*24*90);setRecent(key);}
 },[choice,location.pathname,site,visible]);
 if(!visible)return null;
 const remember=(value)=>{writeCookie(CONSENT,value,60*60*24*180);if(value==="rejected"){writeCookie(LAST,"",0);setRecent("");}setChoice(value);setOpen(false);setDetails(false);};
 return <>
  {choice==="accepted"&&labels[recent]&&(site==="company"||(!site&&location.pathname==="/"))&&<a className="ce-recent-link" href={siteHref(recent)}>Continue exploring: {labels[recent]} ↗</a>}
  <button type="button" className="ce-cookie-settings" onClick={()=>{setOpen(true);setDetails(true);}}>Cookie settings</button>
  {(!choice||open)&&<section className="ce-cookie-banner" role="region" aria-label="Cookie preferences">
    <div><span className="ce-cookie-kicker">YOUR PRIVACY</span><h2>Your choice matters.</h2><p>We use essential storage to keep the website working. With your permission, we can also remember the business you last visited. Accept or reject optional cookies at any time.</p>
      {details&&<div className="ce-cookie-details"><h3>How we use cookies</h3><p><strong>Essential:</strong> remembers your cookie choice for 180 days. The staff portal separately uses security and session storage for sign-in and service operation.</p><p><strong>Optional preferences:</strong> remembers the last business division you visited for up to 90 days. Rejecting optional cookies clears this preference. The choice applies across CHALIN03 public domains.</p><p>We do not enable advertising or optional analytics through this preference. External sites, including WhatsApp, operate their own policies. For questions, call <a href="tel:+233249469080">+233 24 946 9080</a>.</p></div>}
    </div><div className="ce-cookie-actions"><button type="button" onClick={()=>remember("accepted")}>Accept all</button><button type="button" onClick={()=>remember("rejected")}>Reject optional</button><button type="button" onClick={()=>setDetails(!details)} aria-expanded={details}>{details?"Hide cookie details":"Read about cookies"}</button>{choice&&<button type="button" onClick={()=>setOpen(false)}>Close</button>}</div>
  </section>}
 </>;
}
