import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
const money=n=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(n/100);
export default function SalesPlanningScenario({branchId}){
 const [scenario,setScenario]=useState(null),[error,setError]=useState(""),[revision,setRevision]=useState(0);
 useEffect(()=>{
   let active=true;setScenario(null);setError("");
   axiosClient.get("/settings/ownership-reconciliation/planning-scenario").then(({data})=>{if(active)setScenario(data.scenario);}).catch(e=>{if(active)setError(e.response?.data?.message||"Planning scenario unavailable.");});
   return ()=>{active=false;};
 },[branchId,revision]);
 return <section className="ccp">
  <div className="ccp-heading"><div><small>CHALIN03 · MANAGEMENT PLANNING</small><h3>40% partner-share scenario</h3></div><span className="ccp-preview">Estimate only</span></div>
  <p>Fixed 40% planning assumption applied to actual completed, non-void invoice totals before return adjustments. This is not verified ownership, profit or a financial statement. No sales, debts, stock or payments are changed.</p>
  {error&&<p role="alert">{error}</p>}
  {scenario&&<div className="ccp-metrics"><div><span>Actual invoice total</span><strong>{money(scenario.actual_invoice_total)}</strong></div><div><span>Assumed partner share · 40%</span><strong>{money(scenario.assumed_partner_amount)}</strong></div><div><span>Estimated company share · 60%</span><strong>{money(scenario.estimated_company_amount)}</strong></div></div>}
  {!scenario&&!error&&<p role="status">Loading scenario…</p>}
  <button type="button" onClick={()=>setRevision(v=>v+1)}>Recalculate from recorded sales</button>
 </section>;
}
