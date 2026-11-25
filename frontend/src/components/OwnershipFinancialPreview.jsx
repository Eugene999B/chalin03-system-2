import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
const money=n=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(n/100);
export default function OwnershipFinancialPreview({branchId,refreshKey}){
 const [report,setReport]=useState(null),[error,setError]=useState("");
 useEffect(()=>{
  let active=true;setReport(null);setError("");
  axiosClient.get("/settings/ownership-reconciliation/financial-preview").then(({data})=>{if(active)setReport(data.preview);}).catch(e=>{if(active)setError(e.response?.data?.message||"Financial reconciliation preview unavailable.");});
  return ()=>{active=false;};
 },[branchId,refreshKey]);
 const labels={chalin03:"CHALIN03",partner:"Business partner",unresolved:"Mixed or unresolved"};
 if(error)return <p role="alert">{error}</p>;
 if(!report)return <p>Loading receipt reconciliation…</p>;
 const rows=[...Object.entries(report.groups).map(([k,v])=>[labels[k],v]),["All included receipts",report.total]];
 return <div style={{marginTop:20}}>
  <h4>Receipt reconciliation · selected store</h4>
  <p>Completed, non-void receipts before return adjustments. Mixed and unverified receipts are shown in full in the unresolved group. This preview is not a net-profit or statutory report. Collections below are recorded debt payments only.</p>
  <div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left"}}><thead><tr><th>Ownership</th><th>Receipts</th><th>Invoice total</th><th>Tax</th><th>Recorded cost</th><th>Outstanding</th><th>Debt collections</th></tr></thead><tbody>{rows.map(([label,r])=><tr key={label}><th scope="row">{label}</th><td>{r.receipt_count}</td><td>{money(r.invoice_total)}</td><td>{money(r.tax)}</td><td>{money(r.cost)}</td><td>{money(r.outstanding)}</td><td>{money(r.debt_collections)}</td></tr>)}</tbody></table></div>
 </div>;
}
