import {isStaffResearchHost,researchRows,receiptResearchRows,researchCsv,csvField} from "../utils/staffResearch";
import "../styles/customerCreditProfile.css";
const money=new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"});
const units=new Intl.NumberFormat("en-GH",{maximumFractionDigits:6});
function display(n,isUnits){return n==null?"Unavailable":isUnits?units.format(n):money.format(n);}
function saveCsv(filename,content){const url=URL.createObjectURL(new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function StaffReceiptResearch({sale}){
 if(!isStaffResearchHost())return null;
 const r=receiptResearchRows([sale])[0];if(!r?.sales)return null;
 return <div className="ccp-status" style={{marginTop:8}}><strong>40% research reduction:</strong> {display(r.sales.reduction)} · <strong>60% modeled sales:</strong> {display(r.sales.remaining)}{r.units&&<> · Modeled units: {display(r.units.remaining,true)}</>}</div>;
}
export default function StaffPlanningPeriods({metrics=[],sales,scope="Current selected store and displayed data",onLoad,busy=false}){
 if(!isStaffResearchHost())return null;
 const rows=researchRows(metrics);
 const receipts=Array.isArray(sales)?receiptResearchRows(sales):null;
 function downloadReceipts(){
 const csv=[["CHALIN03 — INTERNAL SALES RESEARCH ONLY — NOT ACTUAL RECEIPTS"],["Scope",scope],["Fixed reduction (%)",40],["Receipt reference","Date","Actual sales (GHS)","40% reduction (GHS)","60% modeled sales (GHS)","Actual units","40% reduction (units)","60% modeled units"],...receipts.map(r=>[r.id,r.date,r.sales?.actual,r.sales?.reduction,r.sales?.remaining,r.units?.actual,r.units?.reduction,r.units?.remaining])].map(row=>row.map(csvField).join(",")).join("\r\n")+"\r\n";saveCsv("staff-research-receipts-40pct.csv",csv);
 }
 return <section className="ccp" style={{margin:"12px 0"}}><div className="ccp-heading"><div><small>CHALIN03 · INTERNAL BUSINESS RESEARCH</small><h3>Fixed 40% reduction · 60% remaining</h3></div><span className="ccp-preview">Research only</span></div>
 <p>Original sales, unit prices, debts, stock, receipts, payments and tax records remain actual. Research columns are a proportional scenario, not changes to customer obligations. Positive net profit retention is calculated separately; losses are not shared unless agreed.</p><small>{scope}</small>
 {onLoad&&<p><button type="button" disabled={busy} onClick={onLoad}>{busy?"Loading…":"Calculate selected export period"}</button></p>}
 {rows.length>0&&<><div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left"}}><thead><tr><th>Metric</th><th>Recorded actual</th><th>40% reduction / allocated</th><th>Modeled / retained</th></tr></thead><tbody>{rows.map(r=><tr key={r.label}><th scope="row">{r.label}</th><td>{display(r.actual,r.units)}</td><td>{display(r.reduction,r.units)}</td><td><strong>{display(r.remaining,r.units)}</strong></td></tr>)}</tbody></table></div><button type="button" onClick={()=>saveCsv("staff-research-summary-40pct.csv",researchCsv(rows,scope))}>Download labeled research summary CSV</button></>}
 {receipts?.length>0&&<button type="button" onClick={downloadReceipts}>Download labeled research receipt CSV</button>}</section>;
}
