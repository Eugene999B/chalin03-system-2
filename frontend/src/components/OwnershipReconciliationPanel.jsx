import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import OwnershipEvidencePanel from "./OwnershipEvidencePanel";
import OwnershipFinancialPreview from "./OwnershipFinancialPreview";
import "../styles/customerCreditProfile.css";

export default function OwnershipReconciliationPanel({branchId,showUnavailable=false}){
 const [data,setData]=useState(null),[error,setError]=useState(""),[reload,setReload]=useState(0);
 useEffect(()=>{
   let active=true;setData(null);setError("");
   axiosClient.get("/settings/ownership-reconciliation").then(({data:result})=>{if(active)setData(result);}).catch(e=>{if(active&&(showUnavailable||![403,404].includes(e.response?.status)))setError(e.response?.status===404?"Business ownership reporting is not activated.":e.response?.status===403?"This account is not authorized to view business ownership controls.":e.response?.data?.message||"Reconciliation could not be loaded.");});
   return ()=>{active=false;};
 },[branchId,reload,showUnavailable]);
 if(!data&&!error)return null;
 const rows=data?[["CHALIN03",data.groups.chalin03],["Business partner",data.groups.partner],["Ownership not yet verified",data.groups.unclassified]]:[];
 return <section className="ccp">
   <div className="ccp-heading"><div><small>CHALIN03 · BUSINESS INTELLIGENCE</small><h3>Ownership reconciliation</h3></div><span className="ccp-preview">Preview</span></div>
   <p>Completed, non-void sale lines in the selected store. This is classification coverage, not a financial statement.</p>
   {error&&<p role="alert">{error}</p>}
   {data&&<><div className="ccp-metrics">{rows.map(([label,n])=><div key={label}><span>{label}</span><strong>{Number(n).toLocaleString()}</strong></div>)}<div><span>All sale lines</span><strong>{Number(data.total).toLocaleString()}</strong></div></div><p>Financial reporting remains unavailable until ownership evidence, returns, discounts, costs, receivables and collections are reconciled.</p></>}
   <button type="button" onClick={()=>setReload(v=>v+1)}>Refresh reconciliation</button>
   {data&&<OwnershipFinancialPreview branchId={branchId} refreshKey={JSON.stringify(data.groups)} />}
   {data&&<OwnershipEvidencePanel branchId={branchId} onSaved={()=>{axiosClient.get("/settings/ownership-reconciliation").then(({data:result})=>setData(result)).catch(()=>setError("Ownership saved. Refresh reconciliation to see updated counts."));}} />}
 </section>;
}
