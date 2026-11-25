import {useState,useEffect} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";
const api="/settings/ownership-reconciliation/shareholder-allocation";
const labels={today:"Today",last_seven_days:"Last 7 days",month_to_date:"Month to date",invoice_total:"Recorded invoices",tax:"Invoice tax",cost:"Recorded item costs",outstanding:"Outstanding receivables",debt_collections:"Recorded debt collections",invoice_margin_before_returns_and_expenses:"Invoice margin before returns & expenses"};
const money=v=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(v/100);
export default function StaffPlanningPeriods({user,branchKey,refreshKey}){
 const visible=typeof window!=="undefined"&&window.location.hostname==="staff.chalin03.com"&&user?.is_original_system_administrator===true;
 const storageKey="chalin03:shareholder-preview:"+String(user?.id||"");
 const [report,setReport]=useState(null),[error,setError]=useState(""),[percent,setPercent]=useState("40"),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!visible)return;
  let active=true;setReport(null);setError("");
  let stored;try{stored=sessionStorage.getItem(storageKey);}catch{/* optional browser preference */}
  const params=stored!==null&&stored!==undefined&&/^(0|[1-9][0-9]?|100)$/.test(stored)?{percent:stored}:{};
  axiosClient.get(api,{params}).then(({data})=>{if(active){setReport(data.report);setPercent(String(data.report.assumed_partner_percent));}}).catch(e=>{if(active)setError(e.response?.data?.message||"Allocation unavailable.");});
  return()=>{active=false;};
 },[visible,branchKey,refreshKey,revision,storageKey]);
 function apply(){
  if(!/^(0|[1-9][0-9]?|100)$/.test(percent))return;
  try{sessionStorage.setItem(storageKey,percent);}catch{/* still request current preview below */}
  setBusy(true);setError("");
  axiosClient.get(api,{params:{percent}}).then(({data})=>setReport(data.report)).catch(e=>setError(e.response?.data?.message||"Allocation unavailable.")).finally(()=>setBusy(false));
 }
 async function download(){
  if(busy||!report)return;setBusy(true);setError("");
  try{
   const {data}=await axiosClient.get(api+".csv",{params:{percent:report.assumed_partner_percent},responseType:"blob"});
   const url=URL.createObjectURL(data);
   const a=document.createElement("a");a.href=url;a.download="shareholder-planning-allocation.csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }catch{setError("Planning export could not be downloaded.");}finally{setBusy(false);}
 }
 if(!visible)return null;
 return <section className="ccp" style={{margin:"16px 0"}}>
  <div className="ccp-heading"><div><small>MANAGEMENT PLANNING · SELECTED STORE</small><h3>Shareholder allocation</h3></div><span className="ccp-preview">Estimate only</span></div>
  <p>Live recorded amounts split using a hypothetical partner percentage. This does not identify actual merchandise ownership, change customer obligations or establish distributable profit.</p>
  {error&&<p role="alert">{error}</p>}
  {report&&<>
  <form className="ccp-settings-form" onSubmit={e=>{e.preventDefault();apply();}}><label>Scenario partner share (%)<input type="number" min="0" max="100" step="1" value={percent} disabled={busy} onChange={e=>setPercent(e.target.value)} required/></label><button type="submit" disabled={busy||!/^(0|[1-9][0-9]?|100)$/.test(percent)}>Apply calculation</button></form>
  <p className="ccp-status">Applied: {report.assumed_partner_percent}% partner / {100-report.assumed_partner_percent}% company. This preview is shared across staff pages in this browser tab, not saved as company policy.</p>
  <div className="ccp-risk">{report.periods.map(r=><article key={r.period} style={{marginBottom:16}}><h4>{labels[r.period]||r.period}</h4><div className="ccp-metrics"><div><span>Actual invoices</span><strong>{money(r.actual_invoice_total)}</strong></div><div><span>Assumed partner</span><strong>{money(r.assumed_partner_amount)}</strong></div><div><span>Estimated company</span><strong>{money(r.estimated_company_amount)}</strong></div></div></article>)}</div>
  <details><summary>All recorded periods · financial allocation</summary>
   <div className="ccp-risk">{report.metrics.map(r=><article key={r.metric} style={{marginBottom:12}}><h4>{labels[r.metric]||r.metric}</h4><div className="ccp-metrics"><div><span>Actual</span><strong>{money(r.actual)}</strong></div><div><span>Assumed partner</span><strong>{money(r.partner)}</strong></div><div><span>Estimated company</span><strong>{money(r.company)}</strong></div></div></article>)}</div>
  </details>
  <p className="ccp-status">As of {report.as_of}. Before return adjustments; invoice margin excludes expenses. CSV uses the applied percentage and fresh recorded totals. Ordinary receipts and exports remain unchanged.</p>
  <button type="button" disabled={busy} onClick={download}>Download labeled shareholder calculation</button> </>}
  <button type="button" disabled={busy} onClick={()=>setRevision(x=>x+1)}>Refresh calculation</button>
 </section>;
}
