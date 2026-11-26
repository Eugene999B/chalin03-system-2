import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
const money=n=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(n/100);
const units=n=>new Intl.NumberFormat("en-GH",{maximumFractionDigits:6}).format(n);
const labels={units:"Units sold",invoice_total:"Invoice total",tax:"Invoice tax",cost:"Item cost",outstanding:"Receivables",debt_collections:"Debt collections",margin:"Invoice margin before returns and expenses"};
const periods={today:"Today",last_seven_days:"Last 7 days",month_to_date:"Month to date",all_time:"All recorded periods"};
const fmt=(k,n)=>k==="units"?units(n):money(n);
function csvCell(v){let s=String(v);if(/^[=+@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function download(report,detail){
 const p=report.reduction_percent,fields=Object.keys(labels);
 const rows=[["CHALIN03 SALES RESEARCH SCENARIO — NOT ACTUAL FINANCIAL RECORDS"],["Fixed reduction percentage",p],["Store",report.branch_id],["As of UTC",report.as_of],["Scope","Completed non-void receipts before returns; fractional modeled quantities; unchanged actual unit prices; modeled debt and tax are not obligations"]];
 if(detail){
 rows.push(["Sale ID","Sale date","Scenario reduction %",...fields.flatMap(k=>["Actual "+labels[k]+(k==="units"?"":" (GHS)"),"Reduction amount "+labels[k]+(k==="units"?"":" (GHS)"),"Modeled remaining "+labels[k]+(k==="units"?"":" (GHS)")])]);
 for(const r of report.receipts)rows.push([r.sale_id,r.date,p,...fields.flatMap(k=>[r.actual[k],r.reduction[k],r.modeled[k]].map(n=>k==="units"?n:(n/100).toFixed(2)))]);
 }else{
 rows.push(["Period","Actual receipts (unchanged)","Scenario reduction %","Metric","Actual","Reduction amount","Modeled remaining","Unit"]);
 for(const [period,r] of Object.entries(report.periods))for(const k of fields)rows.push([period,r.receipts,p,labels[k],k==="units"?r.actual[k]:(r.actual[k]/100).toFixed(2),k==="units"?r.reduction[k]:(r.reduction[k]/100).toFixed(2),k==="units"?r.modeled[k]:(r.modeled[k]/100).toFixed(2),k==="units"?"units":"GHS"]);
 }
 const blob=new Blob(["\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n"],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="staff-research-scenario-"+p+"pct-"+(detail?"receipts":"summary")+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Metrics({row,fields}){
 return <div className="ccp-metrics">{fields.map(k=><div key={k}><span>Modeled {labels[k]}</span><strong>{fmt(k,row.modeled[k])}</strong><small>40% reduction: {fmt(k,row.reduction[k])}</small><small>Actual: {fmt(k,row.actual[k])}</small></div>)}</div>;
}
export default function StaffSalesResearch({branchId,page}){
 const [report,setReport]=useState(null),[error,setError]=useState(""),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0);
 useEffect(()=>{let active=true;setReport(null);setError("");setOffset(0);
 axiosClient.get("/settings/staff-sales-research").then(({data})=>{if(active)setReport(data.report);}).catch(e=>{if(active)setError(e.response?.data?.message||"Research report unavailable.");});return()=>{active=false;};
 },[branchId,revision]);
 const fields=page==="/debts"?["outstanding","debt_collections"]:page==="/reports"?Object.keys(labels):["units","invoice_total","margin"];
 return <section className="ccp"><div className="ccp-heading"><div><small>CHALIN03 · SALES VOLUME RESEARCH</small><h3>Fixed 40% reduction scenario</h3></div><span className="ccp-preview">Modeled · not actual</span></div>
 <p>Each completed receipt is modeled at 60% of its recorded sales volume and related values. Actual prices, receipt count, inventory, payments, tax obligations and debts are unchanged. Fractional modeled units are intentional; these are estimates before returns.</p>
 {page==="/users-settings"&&<p className="ccp-status">The research reduction is fixed at 40% on the server. It cannot be changed through browser settings or request parameters.</p>}
 {error&&<p role="alert">{error}</p>}
 {!report&&!error&&<p role="status">Loading research calculations…</p>}
 {report&&<><p className="ccp-status">As of {report.as_of} · Actual completed receipts: {report.periods.all_time.receipts}</p>
 {page==="/exports"?<><p>Exports identify modeled and actual figures separately and include the applied reduction.</p><button type="button" onClick={()=>download(report,false)}>Download research summary CSV</button> <button type="button" onClick={()=>download(report,true)}>Download receipt-level research CSV</button></>:page==="/sales-history"?<><Metrics row={report.periods.all_time} fields={["units","invoice_total"]}/><div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left"}}><thead><tr><th>Sale ID</th><th>Date</th><th>Actual units</th><th>40% reduction (units)</th><th>Remaining units (60%)</th><th>Actual invoice</th><th>40% reduction (GHS)</th><th>Modeled invoice (60%)</th></tr></thead><tbody>{report.receipts.slice(offset,offset+100).map(r=><tr key={r.sale_id}><td>{r.sale_id}</td><td>{r.date}</td><td>{units(r.actual.units)}</td><td>{units(r.reduction.units)}</td><td>{units(r.modeled.units)}</td><td>{money(r.actual.invoice_total)}</td><td>{money(r.reduction.invoice_total)}</td><td>{money(r.modeled.invoice_total)}</td></tr>)}</tbody></table></div><p>{report.receipts.length?offset+1:0}–{Math.min(offset+100,report.receipts.length)} of {report.receipts.length}</p><button disabled={offset===0} onClick={()=>setOffset(o=>Math.max(0,o-100))}>Previous</button> <button disabled={offset+100>=report.receipts.length} onClick={()=>setOffset(o=>o+100)}>Next</button></>:Object.entries(report.periods).map(([k,r])=><article key={k} className="ccp-risk"><h4>{periods[k]}</h4><Metrics row={r} fields={fields}/></article>)}
 </>}
 <button type="button" onClick={()=>setRevision(v=>v+1)}>Refresh calculations</button></section>;
}
