import {useState,useEffect} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/teamSmsCentre.css";
const api="/equipment-catalogue/sales/installment-command";
export default function FinanceReminderControls({canManage}){
 const [form,setForm]=useState(null),[reason,setReason]=useState(""),[preview,setPreview]=useState(null),[history,setHistory]=useState([]),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const report=e=>setError(e.response?.data?.message||"Finance reminder request failed.");
 function load(){return Promise.all([axiosClient.get(api+"/settings"),axiosClient.get(api+"/reminders/history",{params:{limit:20}})]).then(([s,h])=>{setForm({...s.data.settings,due_soon_days:(s.data.settings.due_soon_days||[]).join(",")});setHistory(h.data.history||[]);});}
 useEffect(()=>{if(canManage)load().catch(report);},[canManage]);
 function update(k,v){setForm(f=>({...f,[k]:v}));setPreview(null);setConfirm("");}
 async function act(kind){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{
   if(kind==="save"){const {data}=await axiosClient.put(api+"/settings",{settings:{...form,due_soon_days:String(form.due_soon_days).split(",").map(Number).filter(n=>Number.isInteger(n)&&n>0)},reason});setNotice(data.message);setReason("");await load();}
   if(kind==="preview"){const {data}=await axiosClient.get(api+"/reminders/preview");setPreview(data);setConfirm("");setNotice("Reminder eligibility preview loaded. No SMS sent.");}
   if(kind==="run"){const {data}=await axiosClient.post(api+"/reminders/run",{confirmation:confirm});setNotice(data.message);setPreview(null);setConfirm("");await load();}
  }catch(e){report(e);}finally{setBusy(false);}
 }
 if(!canManage)return null;
 return <section className="team-sms-centre"><header className="team-sms-hero"><div><small>INSTALLMENT FINANCE</small><h2>Payment Reminder Automation</h2><p>Company-wide reminder settings, eligibility preview and delivery history.</p></div></header>
 {error&&<p className="team-sms-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {form&&<div className="team-sms-body"><div className="team-sms-panel"><h3>Schedule &amp; safeguards</h3><label className="team-sms-check"><input type="checkbox" checked={Boolean(form.automatic_sms_enabled)} disabled={busy} onChange={e=>update("automatic_sms_enabled",e.target.checked)}/>Automatic SMS reminders</label><label>Reminder time (Ghana)<input type="time" value={form.reminder_time||"09:00"} disabled={busy} onChange={e=>update("reminder_time",e.target.value)}/></label><label>Days before payment due<input value={form.due_soon_days} disabled={busy} onChange={e=>update("due_soon_days",e.target.value)}/></label>
 {[[ "overdue_repeat_days","Repeat overdue reminders (days)"],["max_sms_7_days","Maximum messages in 7 days"],["max_sms_30_days","Maximum messages in 30 days"],["minimum_hours_between_sms","Minimum hours between messages"]].map(([k,l])=><label key={k}>{l}<input type="number" min="1" value={form[k]??1} disabled={busy} onChange={e=>update(k,Number(e.target.value))}/></label>)}
 <label className="team-sms-check"><input type="checkbox" checked={Boolean(form.skip_weekends)} disabled={busy} onChange={e=>update("skip_weekends",e.target.checked)}/>Skip weekends</label></div>
 <div className="team-sms-panel"><h3>Message template</h3><textarea rows={5} maxLength={480} value={form.message_template||""} disabled={busy} onChange={e=>update("message_template",e.target.value)}/><label>Change reason<input value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><button className="team-sms-primary" type="button" disabled={busy||reason.trim().length<5} onClick={()=>act("save")}>Save reminder policy</button><h3>Manual reminder run</h3><button type="button" disabled={busy} onClick={()=>act("preview")}>Preview eligible reminders</button>{preview&&<div className="team-sms-confirm"><p>{Array.isArray(preview.reminders)?preview.reminders.length:preview.count??"Review"} eligible reminders in preview.</p><p>Saved frequency limits and notification policy still apply.</p><label>Type RUN INSTALLMENT REMINDERS<input value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/></label><button type="button" className="team-sms-primary" disabled={busy||confirm!=="RUN INSTALLMENT REMINDERS"} onClick={()=>act("run")}>Run eligible reminders</button></div>}</div></div>}
 <div className="team-sms-panel"><h3>Recent installment reminder history</h3><div className="team-sms-history">{history.map((r,i)=><article key={r.id||i}><strong>{r.customer_name||r.customer||"Reminder"} · {r.delivery_status||r.status||"Recorded"}</strong><p>{r.message||r.sms_message||r.reminder_type||""}</p><small>{r.created_at?new Date(r.created_at).toLocaleString():""}</small></article>)}{!history.length&&<p>No reminder history returned.</p>}</div></div></section>;
}
