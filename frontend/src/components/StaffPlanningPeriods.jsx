import {useState,useEffect} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";
const api="/settings/ownership-reconciliation/planning-periods";
const labels={today:"Today",last_seven_days:"Last 7 days",month_to_date:"Month to date"};
const money=v=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(v/100);
export default function StaffPlanningPeriods({user,branchKey,refreshKey}){
 const visible=typeof window!=="undefined"&&window.location.hostname==="staff.chalin03.com"&&user?.is_original_system_administrator===true;
 const [report,setReport]=useState(null),[error,setError]=useState(""),[percent,setPercent]=useState(40),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!visible)return;
  let active=true;setReport(null);setError("");
  axiosClient.get(api).then(({data})=>{if(active){setReport(data.report);setPercent(data.report.assumed_partner_percent);}}).catch(e=>{if(active)setError(e.response?.data?.message||"Planning totals unavailable.");});
  return()=>{active=false;};
 },[visible,branchKey,refreshKey,revision]);
 async function download(){
  if(busy)return;setBusy(true);setError("");
  try{
   const {data}=await axiosClient.get(api+".csv",{responseType:"blob"});
   const url=URL.createObjectURL(data);
   const a=document.createElement("a");a.href=url;a.download="company-share-planning-estimates.csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }catch{setError("Planning export could not be downloaded.");}finally{setBusy(false);}
 }
 if(!visible)return null;
 return <section className="ccp" style={{margin:"16px 0"}}>
  <div className="ccp-heading"><div><small>MANAGEMENT PLANNING · SELECTED STORE</small><h3>Company-share sales estimates</h3></div><span className="ccp-preview">Estimate only</span></div>
  <p>Based on completed, non-void invoice totals in Ghana business time, before returns. Hypothetical ownership allocation, not verified company revenue or profit. Actual receipts, sales, debts and exports remain unchanged.</p>
  {error&&<p role="alert">{error}</p>}
  {report&&<><label className="ccp-simulation-label">What-if partner share <strong>{percent}%</strong><input type="range" min="0" max="100" step="1" value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>
  <div className="ccp-risk">{report.periods.map(r=>{
   const actual=r.actual_invoice_total;if(!Number.isSafeInteger(actual)||actual<0)return null;
   const partner=Number((BigInt(actual)*BigInt(percent)+50n)/100n);
   return <article key={r.period} style={{marginBottom:16}}><h4>{labels[r.period]||r.period}</h4><div className="ccp-metrics"><div><span>Actual recorded invoices</span><strong>{money(actual)}</strong></div><div><span>Assumed partner share</span><strong>{money(partner)}</strong></div><div><span>Estimated company share</span><strong>{money(actual-partner)}</strong></div></div><div className="ccp-split" role="img" aria-label={"Hypothetical company share "+(100-percent)+" percent"}><div style={{width:(100-percent)+"%"}}/><div style={{width:percent+"%"}}/></div></article>;
  })}</div>
  <p className="ccp-status">As of {report.as_of}. The slider is an unsaved simulation. The separate planning CSV uses the configured assumption ({report.assumed_partner_percent}%).</p>
  <button type="button" disabled={busy} onClick={download}>Download labeled planning CSV</button> </>}
  <button type="button" disabled={busy} onClick={()=>setRevision(x=>x+1)}>Refresh planning data</button>
 </section>;
}
