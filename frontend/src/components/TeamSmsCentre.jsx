import {useEffect,useState,useMemo,useRef} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/teamSmsCentre.css";
const templates=[
 ["Staff notice","CHALIN03: Please take note of the following management announcement: "],
 ["Meeting","CHALIN03: Staff meeting reminder. Please attend at the agreed time and location. Thank you."],
 ["Customer follow-up","CHALIN03: Thank you for doing business with us. Please contact our office for assistance with your account."],
 ["Payment reminder","CHALIN03: Kindly review your payment schedule and contact our office if you need assistance. Thank you."]
];
const err=(e)=>e.response?.data?.message||"Request could not be verified. Check history before retrying.";
export default function TeamSmsCentre({scope="spare-parts",contextKey,canManage=true}){
 const api="/team-sms/"+scope;
 const [target,setTarget]=useState("staff"),[directory,setDirectory]=useState(null),[mode,setMode]=useState("selected"),[ids,setIds]=useState([]),[query,setQuery]=useState(""),[category,setCategory]=useState("all"),[message,setMessage]=useState(""),[preview,setPreview]=useState(null),[history,setHistory]=useState([]),[confirmation,setConfirmation]=useState(""),[eligible,setEligible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[outcome,setOutcome]=useState(null);
 const batchRef=useRef(null);
 useEffect(()=>{
  let active=true;setDirectory(null);setIds([]);setCategory("all");setPreview(null);setConfirmation("");setEligible(false);setError("");setOutcome(null);setNotice("");batchRef.current=null;
  if(canManage)Promise.all([axiosClient.get(api+"/recipients",{params:{target}}),axiosClient.get(api+"/history")]).then(([a,b])=>{if(active){setDirectory(a.data);setHistory(b.data.messages||[]);}}).catch(e=>{if(active)setError(err(e));});
  return()=>{active=false;};
 },[api,target,contextKey,canManage]);
 const rows=useMemo(()=>directory?.recipients||[],[directory]);
 const categories=useMemo(()=>[...new Set(rows.map(r=>r.category).filter(Boolean))],[rows]);
 const visible=useMemo(()=>rows.filter(r=>(category==="all"||r.category===category)&&[r.name,r.masked_phone,r.category].join(" ").toLowerCase().includes(query.toLowerCase())),[rows,query,category]);
 function resetPreview(){setPreview(null);setConfirmation("");setEligible(false);batchRef.current=null;}
 function changeSelection(next){setIds(next);resetPreview();}
 async function prepare(){
  if(busy)return;setBusy(true);setError("");setNotice("");setOutcome(null);
  try{const payload={target,mode,ids,message};const {data}=await axiosClient.post(api+"/preview",payload);setPreview(data);batchRef.current=crypto.randomUUID();}
  catch(e){setError(err(e));}finally{setBusy(false);}
 }
 async function send(){
  if(busy||!preview||!eligible||confirmation!=="SEND MESSAGES"||!batchRef.current)return;
  setBusy(true);setError("");setNotice("");
  try{
   const {data}=await axiosClient.post(api+"/send",{target,mode,ids,message,fingerprint:preview.fingerprint,batch_id:batchRef.current,confirmation,contact_eligible:eligible});
   setOutcome(data);setNotice(data.message);resetPreview();
   const h=await axiosClient.get(api+"/history");setHistory(h.data.messages||[]);
  }catch(e){setError(err(e));try{const h=await axiosClient.get(api+"/history");setHistory(h.data.messages||[]);}catch{/* retain last known history */}}
  finally{setBusy(false);}
 }
 if(!canManage)return null;
 const count=mode==="all"?rows.length:ids.length;
 return <section className="team-sms-centre">
  <header className="team-sms-hero"><div><small>CHALIN03 · COMMUNICATIONS</small><h2>Staff &amp; Customer SMS Centre</h2><p>Verified audiences · message preview · delivery tracking</p></div><span>{directory?.live_sending?"Provider ready":"Sending unavailable"}</span></header>
  {error&&<p role="alert" className="team-sms-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="team-sms-body">
   <div className="team-sms-panel"><h3>1 · Choose recipients</h3><div className="team-sms-actions">{["staff","customers"].map(t=><button key={t} type="button" aria-pressed={target===t} disabled={busy} onClick={()=>{setTarget(t);setMode("selected");setQuery("");}}>{t==="staff"?"Staff":"Customers"}</button>)}</div>
    <div className="team-sms-metrics"><div><small>Valid unique numbers</small><strong>{rows.length}</strong></div><div><small>Invalid / duplicate</small><strong>{(directory?.invalid||0)+(directory?.duplicates||0)}</strong></div><div><small>Selected</small><strong>{count}</strong></div></div>
    <label>Audience<select value={mode} disabled={busy} onChange={e=>{setMode(e.target.value);resetPreview();}}><option value="selected">Choose individual recipients</option><option value="all">All eligible recipients in this workspace</option></select></label>
    {directory?.truncated&&<p role="status">Directory is capped; select a verified subset.</p>}
    {mode==="selected"&&<><div className="team-sms-filters"><input aria-label="Search recipients" placeholder="Search name, role, status or phone" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter recipients" value={category} disabled={busy} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div><div className="team-sms-actions"><button type="button" disabled={busy} onClick={()=>changeSelection([...new Set([...ids,...visible.map(r=>r.id)])])}>Select filtered</button><button type="button" disabled={busy} onClick={()=>changeSelection([])}>Clear selection</button></div>
    <div className="team-sms-recipient-list">{visible.map(r=><label key={r.id}><input type="checkbox" disabled={busy} checked={ids.includes(r.id)} onChange={e=>changeSelection(e.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/><span><strong>{r.name}</strong><small>{r.category} · {r.masked_phone}</small></span></label>)}{directory&&!visible.length&&<p>No matching valid recipients.</p>}</div></>}
    <p className="team-sms-caption">Maximum {directory?.max_batch||100} unique recipients per confirmed submission. Staff are scoped to the selected workspace.</p>
   </div>
   <div className="team-sms-panel"><h3>2 · Compose message</h3><label>Template<select value="" disabled={busy} onChange={e=>{setMessage(e.target.value);resetPreview();}}><option value="">Choose a starting template</option>{templates.map(([label,value])=><option key={label} value={value}>{label}</option>)}</select></label>
   <label>SMS content<textarea rows={6} maxLength={480} value={message} disabled={busy} onChange={e=>{setMessage(e.target.value);resetPreview();}}/></label><small>{message.length}/480 characters. Do not include passwords, PINs or authenticator codes.</small>
   <button type="button" className="team-sms-primary" disabled={busy||!message.trim()||!count||count>(directory?.max_batch||100)||!directory} onClick={prepare}>Preview recipients &amp; SMS credits</button>
   {preview&&<div className="team-sms-confirm"><h3>3 · Review and send</h3><p>{preview.count} unique recipients · {preview.segments_per_recipient} segment(s) each · estimated {preview.estimated_credits} credits.</p><p className="team-sms-message-preview">{message}</p><div className="team-sms-review-list">{preview.recipients.map(r=><div key={r.id}>{r.name} · {r.masked_phone}</div>)}</div><label className="team-sms-check"><input type="checkbox" checked={eligible} disabled={busy} onChange={e=>setEligible(e.target.checked)}/>I confirm these recipients are eligible to receive this message.</label><label>Type SEND MESSAGES<input value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label><button type="button" className="team-sms-primary" disabled={busy||!directory?.live_sending||!eligible||confirmation!=="SEND MESSAGES"} onClick={send}>{busy?"Submitting…":"Confirm and send"}</button></div>}
   {outcome&&<div role="status">{Object.entries(outcome.counts||{}).map(([k,v])=><p key={k}>{k.replaceAll("_"," ")}: {v}</p>)}</div>}
   </div>
  </div>
  <div className="team-sms-panel"><h3>Delivery history</h3><p className="team-sms-caption">Accepted does not mean delivered. Pending or unknown messages must be checked before resending.</p><button type="button" disabled={busy} onClick={()=>axiosClient.get(api+"/history").then(r=>setHistory(r.data.messages||[])).catch(e=>setError(err(e)))}>Refresh history</button><div className="team-sms-history">{history.map(r=><article key={r.id}><strong>{r.recipient_phone} · {r.status.replaceAll("_"," ")}</strong><small>{new Date(r.created_at).toLocaleString()}</small><p>{r.message}</p><small>{r.status_reason}</small></article>)}{!history.length&&<p>No campaign history in this workspace.</p>}</div></div>
 </section>;
}
