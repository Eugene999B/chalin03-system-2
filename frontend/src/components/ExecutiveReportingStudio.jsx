import { useCallback, useEffect, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "./ExecutiveReportingStudio.css";

const EDITIONS = [
  ["business-intelligence", "BOARD / 01", "Complete business review", "The whole Spare Parts business in one report."],
  ["collections-intelligence", "CREDIT / 02", "Collections & debtors", "Payments, overdue positions and recovery priorities."],
  ["audit-intelligence", "AUDIT / 03", "Control & audit review", "Return anomalies, receipt evidence and investigation actions."],
  ["stock-intelligence", "STOCK / 04", "Inventory performance", "Best sellers, reorder risks and stock quality."],
  ["supplier-intelligence", "SUPPLY / 05", "Purchases & liabilities", "Supplier invoices, payments and current exposure."]
];
const money = value => "GH₵ " + Number(value || 0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const whole = value => Number(value || 0).toLocaleString("en-GH",{maximumFractionDigits:0});
function ChartBars({chart, limit=9}) {
  const points = (chart?.points || []).slice(0,limit);
  const maximum = Math.max(1,...points.map(point=>Number(point.value)||0));
  return <section className="rpt-chart-card">
    <div className="rpt-chart-heading"><div><h3>{chart?.title||"Source breakdown"}</h3><p>{chart?.note||"The source contains no records for this view."}</p></div><span>GHS</span></div>
    {points.length ? points.map((point,index)=><div className="rpt-chart-bar" key={index}>
      <span title={point.label}>{point.label}</span>
      <div className="rpt-chart-track" role="img" aria-label={point.label + " " + money(point.value)}>
        <div style={{width:String(Math.max(0,Number(point.value)||0)/maximum*100)+"%"}}/>
      </div>
      <strong>{whole(point.value)}</strong>
    </div>) : <div className="rpt-no-records">No matching transactions.</div>}
  </section>;
}
function TrendGraph({chart}) {
  const points=(chart?.points||[]).slice(0,31);
  const width=720,height=210,max=Math.max(1,...points.map(x=>Number(x.value)||0));
  const vertices=points.map((point,index)=>{
    const x=18+(points.length===1?342:index*684/(points.length-1));
    const y=166-((Math.max(0,Number(point.value)||0)/max)*148);
    return {x,y};
  });
  const polyline=vertices.map(p=>String(p.x)+","+String(p.y)).join(" ");
  return <section className="rpt-chart-card rpt-trend-card">
    <div className="rpt-chart-heading"><div><h3>{chart?.title||"Daily sales"}</h3><p>{chart?.note||"Completed receipts by sale date"}</p></div><span>GHS</span></div>
    {points.length ? <><svg viewBox={"0 0 "+width+" "+height} role="img" aria-label={"Daily sale values. Peak "+money(max)}>
      {[0,1,2,3,4].map(i=><line key={i} x1="18" x2="702" y1={18+i*37} y2={18+i*37} stroke="#d9e8e7" strokeDasharray="3 7"/>)}
      <polyline points={polyline} fill="none" stroke="#078b80" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      {vertices.filter((_,i)=>i===0||i===vertices.length-1||i%Math.max(1,Math.ceil(points.length/9))===0).map((point,i)=><circle key={i} cx={point.x} cy={point.y} r="4" stroke="#087e78" strokeWidth="2" fill="#fff"/>)}
      <text x="18" y="198" fontSize="11" fill="#71858e">{points[0]?.label}</text>
      <text x="702" y="198" textAnchor="end" fontSize="11" fill="#71858e">{points[points.length-1]?.label}</text>
    </svg></> : <div className="rpt-no-records">No completed sales in this period.</div>}
  </section>;
}
const selected = (charts,title) => (charts||[]).find(x=>x.title===title);
function dateIso(date){return date.toISOString().slice(0,10);}
function dateFromToday(days){const date=new Date();date.setUTCDate(date.getUTCDate()+days);return dateIso(date);}
function getFilename(id,fmt,store){
  return ("CHALIN03_"+id+"_"+(store||"selected-store")+"."+(fmt==="word"?"docx":fmt))
    .replace(/[^a-zA-Z0-9._-]/g,"_");
}
export default function ExecutiveReportingStudio({context="reports",storeCode="",storeKey="",from="",to="",allStores=false}){
  const [range,setRange]=useState({from:from||"",to:to||""});
  const [model,setModel]=useState(null);
  const [busy,setBusy]=useState(false);
  const [downloading,setDownloading]=useState("");
  const [error,setError]=useState("");
  const [tab,setTab]=useState("performance");
  const [details,setDetails]=useState(false);
  const sequence=useRef(0);
  useEffect(()=>{setRange({from:from||"",to:to||""});setModel(null);},[from,to]);
  useEffect(()=>{sequence.current++;setModel(null);setError("");},[storeKey,storeCode,allStores]);
  const run=useCallback(async()=>{
    if(allStores){setError("Select one Spare Parts store to run this source-based report.");return;}
    if(range.from&&range.to&&range.from>range.to){setError("Check the date range: From cannot be after To.");return;}
    const token=++sequence.current;
    setError("");setModel(null);setBusy(true);
    try{
      const response=await axiosClient.get("/exports/business-intelligence/preview",{
        params:{...(range.from?{from:range.from}:{}),...(range.to?{to:range.to}:{})}
      });
      if(token===sequence.current)setModel(response.data);
    }catch(e){if(token===sequence.current)setError(e?.response?.data?.message||"The selected store analysis is unavailable.");}
    finally{if(token===sequence.current)setBusy(false);}
  },[range,allStores]);
  const preset=mode=>{
    const now=new Date(),end=dateIso(now);
    const start=mode==="month"?dateIso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))):
      mode==="quarter"?dateIso(new Date(Date.UTC(now.getUTCFullYear(),Math.floor(now.getUTCMonth()/3)*3,1))):dateFromToday(-29);
    setRange({from:start,to:end});setModel(null);
  };
  async function download(id,format){
    if(downloading||busy||allStores)return;
    setDownloading(id+"-"+format);setError("");
    try{
      const response=await axiosClient.get("/exports/"+id,{
        params:{format,...(range.from?{from:range.from}:{}),...(range.to?{to:range.to}:{})},
        responseType:"blob"
      });
      if((response.headers?.["content-type"]||"").includes("json")){
        const body=JSON.parse(await response.data.text());throw new Error(body.message||"Download failed.");
      }
      const blobUrl=URL.createObjectURL(response.data),anchor=document.createElement("a");
      anchor.href=blobUrl;anchor.download=getFilename(id,format,storeCode);
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(blobUrl),1500);
    }catch(error){
      if(error?.response?.data instanceof Blob){
        try{setError(JSON.parse(await error.response.data.text()).message||"Download unavailable.");}
        catch{setError("Download unavailable. Please select a shorter date range.");}
      }else setError(error?.message||"Download unavailable.");
    }finally{setDownloading("");}
  }
  const headings={reports:["Business reports","The full picture behind every figure."],
    audit:["Audit & control","See the findings. Follow the evidence."],
    accounting:["Accounting intelligence","Understand the movement of money."]};
  const [heading,subheading]=headings[context]||headings.reports;
  const charts=model?.charts||[],data=model?.summary||{},findings=model?.findings||[],narratives=model?.narrative||[];
  const kpis=[
    ["01","SALES BOOKED",money(data.invoiceTotal),"Completed invoices incl. tax"],
    ["02","PAID AT SALE",money(data.collectedAtSale),"Original payment allocations"],
    ["03","DEBT RECOVERED",money(data.debtCollected),"Payments actually dated in period"],
    ["04","OPEN CUSTOMER DEBT",money(data.openDebtTotal),"Current outstanding snapshot"],
    ["05","OVERDUE BALANCE",money(data.overdueTotal),"Due-date based snapshot"],
    ["06","SUPPLIER PAYABLES",money(data.supplierPayablesTotal),"Current purchase liabilities"]
  ];
  return <section className="rpt-studio" aria-label="Executive reporting and analysis studio">
    <div className="rpt-masthead">
      <div className="rpt-masthead-content">
        <div className="rpt-kicker">CHALIN03 <span>/</span> MANAGEMENT REPORTS <span>/</span> {storeCode||"SELECTED STORE"}</div>
        <h1>{heading}<span>.</span></h1>
        <p>{subheading}</p>
        <nav aria-label="Reporting workspace navigation" className="rpt-quick-links">
          <a href="/reports">Reports ↗</a><a href="/audit-accounting">Audit ↗</a>
          <a href="/advanced-accounting-intelligence">Accounting ↗</a><a href="/exports">Downloads ↗</a>
        </nav>
      </div>
      <div className="rpt-cover-diagram" aria-hidden="true">
        <span>CHALIN03 / EXECUTIVE VIEW</span><strong>05<em>/</em>01</strong>
        <div className="rpt-cover-rails"><i/><i/><i/><i/></div>
        <small>FINANCE / CREDIT / STOCK / AUDIT / SUPPLIERS</small>
      </div>
    </div>
    <div className="rpt-controls">
      <div className="rpt-period-title"><span>REPORTING WINDOW</span><strong>{model?model.scope.from+" – "+model.scope.to:"Choose your reporting period"}</strong></div>
      <div className="rpt-date-pair">
        <label>From<input type="date" value={range.from} onChange={e=>{setRange(v=>({...v,from:e.target.value}));setModel(null);}}/></label>
        <label>To<input type="date" value={range.to} onChange={e=>{setRange(v=>({...v,to:e.target.value}));setModel(null);}}/></label>
      </div>
      <div className="rpt-period-shortcuts"><button type="button" onClick={()=>preset("30")}>30 days</button><button type="button" onClick={()=>preset("month")}>This month</button><button type="button" onClick={()=>preset("quarter")}>Quarter</button></div>
      <button type="button" className="rpt-run" disabled={busy||allStores} onClick={run}>{busy?"Analysing…":"Analyse store"} <span>↗</span></button>
    </div>
    {allStores&&<div className="rpt-error">This detailed report is store-specific. Select one store to run it.</div>}
    {error&&<div className="rpt-error" role="alert">{error}</div>}
    {!model?<div className="rpt-intro">
      <div className="rpt-intro-count">05</div>
      <div><span>ONE BUSINESS / FIVE PERSPECTIVES</span><h2>From numbers to decisions.</h2>
        <p>View sales movement, actual recorded collections, overdue debts, stock risks and audit actions from original Spare Parts records.</p>
        <small>Financial figures are not generated or guessed. Missing evidence remains visible as a limitation.</small></div>
    </div>:<div className="rpt-analysis">
      <div className="rpt-panel-heading"><div><span>MANAGEMENT BRIEFING</span><h2>The operating position</h2></div>
        <small>STORE {model.scope.branch} · {model.scope.from} — {model.scope.to}</small></div>
      <div className="rpt-kpi-grid">{kpis.map(([n,label,value,note])=><article key={n}>
        <span>{n} / {label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
      <div className="rpt-tabs" role="tablist" aria-label="Business analysis views">
        {[["performance","Performance"],["collections","Collections"],["stock","Stock & supply"],
          ["audit","Audit actions"],["interpretation","What it means"]].map(([key,label])=>
          <button key={key} type="button" role="tab" aria-selected={tab===key}
            className={tab===key?"selected":""} onClick={()=>setTab(key)}>{label}</button>)}
      </div>
      <div className="rpt-visuals">
        {tab==="performance"&&<div className="rpt-chart-grid">
          <TrendGraph chart={selected(charts,"Daily completed invoice value")}/>
          <ChartBars chart={selected(charts,"Top selling parts")}/></div>}
        {tab==="collections"&&<div className="rpt-chart-grid">
          <ChartBars chart={selected(charts,"Recorded receipts and refunds")}/>
          <ChartBars chart={selected(charts,"Current debt by due-date age")}/></div>}
        {tab==="stock"&&<div className="rpt-chart-grid">
          <ChartBars chart={selected(charts,"Top selling parts")}/>
          <ChartBars chart={selected(charts,"Supplier invoices and recorded payments")}/></div>}
        {tab==="audit"&&<div className="rpt-action-grid">
          {findings.map((f,i)=><article key={i}><span>{String(i+1).padStart(2,"0")} / {f.priority} / {f.area}</span>
            <h3>{f.observation}</h3><p>{f.action}</p><small>SOURCE: {f.evidence}</small></article>)}</div>}
        {tab==="interpretation"&&<div className="rpt-story-list">{narratives.map((n,i)=>
          <article key={i}><span>{String(i+1).padStart(2,"0")}</span><div><h3>{n.topic}</h3><p>{n.explanation}</p></div></article>)}</div>}
      </div>
      <button type="button" className="rpt-basis-toggle" aria-expanded={details}
        onClick={()=>setDetails(v=>!v)}>{details?"Hide":"Read"} the accounting basis <span>{details?"−":"+"}</span></button>
      {details&&<div className="rpt-basis-note"><p>Completed sales are dated by invoice creation. At-sale receipts are recorded separately from later debt collections, which use payment dates. Only financial refunds count as money out. Supplier and customer balances and stock are current snapshots.</p>
        <p>Recorded receipts are not verified bank or MoMo settlements. Gross margin and statutory net profit require valid historical cost and accounting reconciliation.</p></div>}
    </div>}
    <div className="rpt-portfolio">
      <div className="rpt-portfolio-title"><div><span>PRESENTATION LIBRARY</span><h2>Reports built for the boardroom.</h2>
        <p>Download a complete review or a focused report. Charts, source notes and decisions stay together.</p></div>
        <a href="/exports">All downloads ↗</a></div>
      <div className="rpt-editions">{EDITIONS.map(([id,label,title,description],i)=>
        <article key={id}>
          <div className="rpt-edition-top"><span>{label}</span><strong>{String(i+1).padStart(2,"0")}</strong></div>
          <div><h3>{title}</h3><p>{description}</p></div>
          <div className="rpt-edition-buttons">{[["pdf","PDF"],["xlsx","Excel"],["word","Word"]].map(([format,text])=>
            <button key={format} type="button" disabled={!!downloading||busy||allStores}
              onClick={()=>download(id,format)} aria-label={"Download "+title+" as "+text}>
              {downloading===id+"-"+format?"Preparing":text} <span>↓</span></button>)}</div>
        </article>)}</div>
      <p className="rpt-portfolio-note">For internal decision-making. All statements need reconciliation and human review before external financial use.</p>
    </div>
  </section>;
}
