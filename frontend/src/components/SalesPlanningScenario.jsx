import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";
const money=n=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(n/100);
export default function SalesPlanningScenario({branchId,editable=false}){
 const [scenario,setScenario]=useState(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[revision,setRevision]=useState(0),[percent,setPercent]=useState("40"),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[hidden,setHidden]=useState(false);
 useEffect(()=>{
   let active=true;setScenario(null);setError("");setHidden(false);
   axiosClient.get("/settings/ownership-reconciliation/planning-scenario").then(({data})=>{if(active){setScenario(data.scenario);setPercent(String(data.scenario.assumed_partner_percent));}}).catch(e=>{if(active){if(editable&&[403,404].includes(e.response?.status))setHidden(true);else setError(e.response?.data?.message||"Planning scenario unavailable.");}});
   return ()=>{active=false;};
 },[branchId,revision,editable]);
 async function save(e){
  e.preventDefault();if(busy||!scenario||!/^\d{1,3}$/.test(percent)||Number(percent)>100||!/^\d{6}$/.test(code))return;
  setBusy(true);setError("");setMessage("");
  try{
    const {data}=await axiosClient.patch("/settings/ownership-reconciliation/planning-settings",{assumed_partner_percent:Number(percent),version:scenario.version,authenticator_code:code});
    setMessage(data.message);setRevision(v=>v+1);
  }catch(e){setError(e.response?.data?.message||"Could not save planning assumption.");}
  finally{setBusy(false);setCode("");}
 }
 if(hidden)return null;
 return <section className="ccp">
  <div className="ccp-heading"><div><small>CHALIN03 · MANAGEMENT PLANNING</small><h3>{editable?"Planning algorithm settings":"Partner-share planning scenario"}</h3></div><span className="ccp-preview">Estimate only</span></div>
  <p>Adjustable planning assumption applied to completed, non-void invoice totals before return adjustments. This is not verified ownership, profit or a financial statement. No sales, debts, stock or payments are changed.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {scenario&&<><div className="ccp-metrics"><div><span>Actual invoice total</span><strong>{money(scenario.actual_invoice_total)}</strong></div><div><span>Assumed partner share · {scenario.assumed_partner_percent}%</span><strong>{money(scenario.assumed_partner_amount)}</strong></div><div><span>Estimated company share · {100-scenario.assumed_partner_percent}%</span><strong>{money(scenario.estimated_company_amount)}</strong></div></div>
  {editable&&scenario.settings_available===false&&<p role="status">The initial 40% planning calculation is read-only. Saving a new percentage requires activation of the protected settings.</p>}
  {editable&&scenario.settings_available!==false&&<form className="ccp-settings-form" onSubmit={save}><label>Assumed partner percentage (all stores)<input type="number" min="0" max="100" step="1" value={percent} onChange={e=>setPercent(e.target.value)} required disabled={busy}/></label><label>Authenticator code<input inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} required disabled={busy}/></label><div><button type="submit" disabled={busy||code.length!==6||Number(percent)===scenario.assumed_partner_percent}>Verify and save</button></div></form>}</>}
  <button type="button" disabled={busy} onClick={()=>{setCode("");setRevision(v=>v+1);}}>Refresh calculation</button>
 </section>;
}
