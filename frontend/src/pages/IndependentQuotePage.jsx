import {useState} from "react";
import {useSearchParams} from "react-router";
import axiosClient from "../api/axiosClient";
import PublicPageMeta from "../components/PublicPageMeta";
import RealPhoto from "../components/RealPhoto";
import {PHOTO_LIBRARY} from "../data/verifiedPublicPhotos";
import {SECTOR_TO_SITE,getOfficialSite,siteHref} from "../config/officialSites";
import "../styles/independentQuotePage.css";

const entries=[
 {id:"excavators",label:"Excavators",photo:PHOTO_LIBRARY.excavators},
 {id:"heavy-machines",label:"Heavy-duty machines",photo:PHOTO_LIBRARY.machines},
 {id:"automobiles",label:"Automobiles",photo:PHOTO_LIBRARY.automobiles},
 {id:"motorcycles",label:"Motorcycles",photo:PHOTO_LIBRARY.motorcycles},
 {id:"gold",label:"Gold buying & refining",photo:PHOTO_LIBRARY.gold},
 {id:"machine-transport",label:"Heavy machinery transport",photo:PHOTO_LIBRARY.transport},
 {id:"equipment-hire",label:"Equipment hire",photo:PHOTO_LIBRARY.hire},
 {id:"spare-parts",label:"Spare-parts shop",photo:PHOTO_LIBRARY.parts},
 {id:"general",label:"General customer enquiry",photo:PHOTO_LIBRARY.excavators},
];
const keygen=()=>globalThis.crypto?.randomUUID?.()||"e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);
function getSector(params){
 const direct=params.get("sector");
 if(entries.some(item=>item.id===direct))return direct;
 const current=getOfficialSite();
 return Object.keys(SECTOR_TO_SITE).find(k=>SECTOR_TO_SITE[k]===current)||"general";
}
export default function IndependentQuotePage(){
 const [params]=useSearchParams();
 const [sector,setSector]=useState(()=>getSector(params));
 const [model,setModel]=useState(params.get("model")||"");
 const [name,setName]=useState(""),[phone,setPhone]=useState(""),[location,setLocation]=useState(""),[email,setEmail]=useState("");
 const [message,setMessage]=useState(""),[key,setKey]=useState(keygen);
 const [sending,setSending]=useState(false),[error,setError]=useState(""),[reference,setReference]=useState("");
 const active=entries.find(x=>x.id===sector)||entries[entries.length-1];
 const divisionSite=SECTOR_TO_SITE[sector]||"help";
 const requestType=sector==="general"?"message":["gold","machine-transport","equipment-hire"].includes(sector)?"service_enquiry":"equipment_enquiry";
 async function submit(event){
  event.preventDefault();if(sending)return;
  setSending(true);setError("");
  try{
   const subject=active.label+" enquiry"+(model?" — "+model:"");
   const text=[model?"Requested model/type: "+model:"",message].filter(Boolean).join("\n");
   const {data}=await axiosClient.post("/public-commerce/requests",{
    request_type:requestType,client_key:key,subject,
    customer_name:name,customer_phone:phone,customer_location:location,customer_email:email,message:text
   },{timeout:20000});
   setReference(data.reference||"Received");
   setKey(keygen());setMessage("");setModel("");
  }catch(e){setError(e.response?.data?.message||"Your enquiry was not saved. Please retry or WhatsApp us.");}
  finally{setSending(false)}
 }
 return <main className="iq-site">
  <PublicPageMeta title={"Contact CHALIN03 · "+active.label} description="Send a verified quotation or customer enquiry to the CHALIN03 team. No online payments or instant availability claims." canonicalPath="/enquire"/>
  <div className="iq-top"><span>CHALIN03 COMPANY LIMITED · CUSTOMER ENQUIRIES</span><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WHATSAPP US</a></div>
  <header className="iq-header"><a className="iq-logo" href={siteHref("company")}><img src="/chalin03-logo.png" width="44" height="44" alt=""/><strong>CHALIN<span>03</span></strong></a>
   <nav><a href={siteHref(divisionSite)}>Back to {active.label}</a><a href={siteHref("parts")}>Spare-parts shop</a><a href={siteHref("help")}>Customer help</a></nav></header>
  <section className="iq-layout"><div className="iq-intro"><span>DIRECT TO OUR TEAM</span><h1>Tell us what<br/><em>you need.</em></h1>
    <p>Send the model, part, vehicle, service or project details. A CHALIN03 staff member will review the request and follow up using your contact information.</p>
    <RealPhoto photo={active.photo}/>
    <div className="iq-intro__contacts"><h2>Prefer to speak directly?</h2><a href="tel:+233540713654">Call 054 071 3654 ↗</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us ↗</a></div>
   </div>
   <div className="iq-form-area">
    {reference?<div className="iq-success" role="status"><span>THANK YOU</span><h2>Your enquiry is in.</h2><p>Reference: <strong>{reference}</strong>. Please keep the number for follow-up. Nothing has been charged online.</p><button type="button" onClick={()=>{setReference("");setName("");setPhone("");setLocation("");setEmail("");setMessage("");}}>Send another enquiry</button></div>:
    <form onSubmit={submit}><div className="iq-form-heading"><span>STEP 01 · YOUR REQUEST</span><h2>Enquiry details</h2><p>Fields marked * are required.</p></div>
     <label>Business division *<select value={sector} onChange={e=>{setSector(e.target.value);setModel("")}}>
      {entries.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
     <label>Machine / product / model (optional)<input value={model} onChange={e=>setModel(e.target.value)} maxLength={180} placeholder="E.g. Komatsu PC200, CAT 320, Toyota Hilux"/></label>
     <div className="iq-form-heading"><span>STEP 02 · CONTACT INFORMATION</span></div>
     <div className="iq-fields"><label>Full name *<input required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Phone / WhatsApp *<input required type="tel" maxLength={32} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label></div>
     <div className="iq-fields"><label>Town / location *<input required minLength={2} maxLength={255} autoComplete="address-level2" value={location} onChange={e=>setLocation(e.target.value)}/></label>
      <label>Email (optional)<input type="email" maxLength={190} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label></div>
     <div className="iq-form-heading"><span>STEP 03 · REQUIREMENTS</span></div>
     <label>What exactly do you need? *<textarea required minLength={5} maxLength={3400} rows={6} placeholder="Description, make, model, age, budget, site or destination — the more details the better." value={message} onChange={e=>setMessage(e.target.value)}/></label>
     {error?<p role="alert" className="iq-error">{error}</p>:null}
     <button className="iq-send" disabled={sending} type="submit">{sending?"Sending securely…":"Send my enquiry →"}</button>
     <p className="iq-legal">Our team confirms availability and pricing directly. This is not an online payment page. Gold-related requests are subject to applicable licensing and identity verification.</p>
    </form>}
   </div>
  </section>
  <footer className="iq-footer"><a href={siteHref("company")}>CHALIN03 Company home</a><a href={siteHref("help")}>Help centre</a><a href={siteHref("work")}>Staff sign-in</a><small>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</small></footer>
 </main>;
}
