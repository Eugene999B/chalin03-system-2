import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import axiosClient from "../api/axiosClient";
import "./SparePartsBlindCountPage.css";

const API="/spare-parts/stock-counts";
const money=value=>"GH₵ "+Number(value||0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const int=value=>Number(value||0).toLocaleString("en-GH",{maximumFractionDigits:0});
const fileName=(id,format)=>"chalin03-blind-count-"+id+"."+(format==="word"?"doc":format);
function downloadFile(blob,name) {
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement("a");
 anchor.href=url;anchor.download=name;
 document.body.appendChild(anchor);anchor.click();anchor.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function errorText(err){
 const data=err?.response?.data;
 if(data instanceof Blob){try{return JSON.parse(await data.text()).message||"Request failed."}catch{return "Request failed."}}
 return data?.message||err?.message||"Request failed.";
}
const statusLabel={draft:"Counting in progress",submitted:"Submitted • analysis ready",reviewed:"Independently reviewed"};
const filterOptions=[
 {key:"all",label:"All items"},
 {key:"uncounted",label:"Uncounted"},
 {key:"shortage",label:"Shortages"},
 {key:"overage",label:"Overages"},
 {key:"movement",label:"Stock changed"},
 {key:"matching",label:"Matching"},
];
function Stat({label,value,tone,note}){
 return <div className={"blind-stat "+(tone||"")}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;
}

export default function SparePartsBlindCountPage(){
 const {user,branchId,branchName,branchCode}=useAuth();
 const [sessions,setSessions]=useState([]);
 const [activeId,setActiveId]=useState(null);
 const [detail,setDetail]=useState(null);
 const [draft,setDraft]=useState({});
 const [title,setTitle]=useState("");
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState("all");
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [reviewNotes,setReviewNotes]=useState("");
 const [loading,setLoading]=useState(true);
 const role=String(user?.role||"").toLowerCase();
 const canReview=role==="admin"||role==="manager";
 const loadSessions=useCallback(async()=>{
  try{
   const data=(await axiosClient.get(API)).data;
   setSessions(data.sessions||[]);
   setError("");
  }catch(e){setError(await errorText(e))}
  finally{setLoading(false)}
 },[]);
 const openCount=useCallback(async(id)=>{
  if(!id)return;
  setBusy("open");setError("");
  try{
   const result=(await axiosClient.get(API+"/"+id)).data;
   setActiveId(Number(id));setDetail(result);setDraft({});setFilter("all");setQuery("");
  }catch(e){setError(await errorText(e))}
  finally{setBusy("")}
 },[]);
 useEffect(()=>{setActiveId(null);setDetail(null);setSessions([]);setLoading(true);loadSessions()},[branchId,loadSessions]);
 const list=detail?.items||[];
 const revealed=detail?.session?.status!=="draft"&&Boolean(detail?.session);
 const changes=useMemo(()=>Object.entries(draft).filter(([id,v])=>{
  const current=list.find(x=>String(x.product_id)===String(id));
  return current&&(
   String(v.quantity??"")!==String(current.counted_qty??"")||
   String(v.remarks??"")!==String(current.remarks||"")
  );
 }),[draft,list]);
 const resultLines=detail?.analysis?.lines||[];
 const resultMap=useMemo(()=>new Map(resultLines.map(x=>[String(x.product_id),x])),[resultLines]);
 const visible=useMemo(()=>{
  const term=query.trim().toLowerCase();
  return list.filter(x=>{
   if(term&&![x.name,x.barcode,x.category,x.product_id,x.size].some(v=>String(v||"").toLowerCase().includes(term)))return false;
   const analyzed=resultMap.get(String(x.product_id));
   if(filter==="uncounted")return x.counted_qty===null;
   if(filter==="shortage")return analyzed?.shortage_qty>0;
   if(filter==="overage")return analyzed?.excess_qty>0;
   if(filter==="movement")return analyzed?.movement_flag;
   if(filter==="matching")return analyzed?.variance===0;
   return true;
  });
 },[list,query,filter,resultMap]);
 const summary=detail?.analysis?.summary;
 async function createCount(event){
  event.preventDefault();if(title.trim().length<4)return;
  setBusy("create");setError("");setNotice("");
  try{
   const response=(await axiosClient.post(API,{title:title.trim()})).data;
   setTitle("");await loadSessions();await openCount(response.count_id);
   setNotice("Blind count created. Expected stock remains hidden until submission.");
  }catch(e){setError(await errorText(e))}
  finally{setBusy("")}
 }
 function changeEntry(id,field,value) {
  const key=String(id);const row=list.find(x=>String(x.product_id)===key);
  setDraft(prev=>({...prev,[key]:{quantity:prev[key]?.quantity??(row?.counted_qty??""),remarks:prev[key]?.remarks??(row?.remarks||""),[field]:value}}));
 }
 async function saveEntries(){
  if(!changes.length)return true;
  const entries=[];
  for(const [id,v] of changes){
   const raw=String(v.quantity??"").trim();
   const valid=raw===""||( /^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)<=1000000000);
   if(!valid){setError("Count quantities must be whole numbers of zero or more.");return false}
   entries.push({product_id:Number(id),counted_qty:raw===""?null:Number(raw),remarks:v.remarks||""});
  }
  setBusy("save");setError("");
  try{
   for(let i=0;i<entries.length;i+=250){
    await axiosClient.put(API+"/"+activeId+"/entries",{entries:entries.slice(i,i+250)});
   }
   await openCount(activeId);setNotice(entries.length+" count entries saved.");return true;
  }catch(e){setError(await errorText(e));return false}
  finally{setBusy("")}
 }
 async function submitCount(){
  if(changes.length){setError("Save all edited quantities before submitting the count.");return}
  if(detail?.progress?.counted!==detail?.progress?.total){setError("Enter a physical quantity for every product. Use zero when the item is absent.");return}
  if(!window.confirm("Submit this stock count? Recorded quantities will become immutable and system differences will be revealed. This does not update inventory."))return;
  setBusy("submit");setError("");
  try{
   const r=(await axiosClient.post(API+"/"+activeId+"/submit")).data;
   await openCount(activeId);await loadSessions();setNotice(r.message);
  }catch(e){setError(await errorText(e))}
  finally{setBusy("")}
 }
 async function reviewCount(){
  if(reviewNotes.trim().length<8){setError("Enter your review evidence or action plan.");return}
  setBusy("review");setError("");
  try{
   const r=(await axiosClient.post(API+"/"+activeId+"/review",{notes:reviewNotes.trim()})).data;
   setReviewNotes("");await openCount(activeId);await loadSessions();setNotice(r.message);
  }catch(e){setError(await errorText(e))}
  finally{setBusy("")}
 }
 async function download(format){
  setBusy(format);setError("");
  try{
   const r=await axiosClient.get(API+"/"+activeId+"/export",{params:{format},responseType:"blob"});
   downloadFile(r.data,fileName(activeId,format));
   setNotice("Downloaded "+format.toUpperCase()+" variance evidence.");
  }catch(e){setError(await errorText(e))}
  finally{setBusy("")}
 }
 return <main className="blind-page">
  <header className="blind-hero">
   <div><span className="blind-eyebrow">SPARE PARTS · INDEPENDENT STOCK ASSURANCE</span>
    <h1>Blind Stock Count</h1>
    <p>Count what is physically on the shelf without seeing the system quantity. Submit once to reveal shortages, overages, monetary exposure and movement risk.</p>
    <div className="blind-tags"><span>Evidence preserved</span><span>Two-store isolation</span><span>No automatic stock adjustment</span></div>
   </div>
   <div className="blind-store"><small>Active store</small><strong>{branchCode||"Store"} · {branchName||"Selected branch"}</strong><small>{role==="auditor"?"Auditor counting access":"Authorised audit access"}</small></div>
  </header>
  {error&&<div className="blind-alert error" role="alert">{error}</div>}
  {notice&&<div className="blind-alert success" role="status">{notice}</div>}
  <section className="blind-workspace">
   <aside className="blind-aside">
    <div className="blind-pane-title"><div><span className="blind-eyebrow">COUNT SESSIONS</span><h2>Start or continue</h2></div></div>
    <form className="blind-start" onSubmit={createCount}>
     <label htmlFor="blind-count-name">Name this physical count</label>
     <input id="blind-count-name" value={title} maxLength={150} onChange={e=>setTitle(e.target.value)} placeholder="e.g. November main-store shelf count" required minLength={4}/>
     <button type="submit" disabled={Boolean(busy)||title.trim().length<4}>+ Start blind count</button>
    </form>
    <div className="blind-sessions">
     {loading&&<p>Loading count sessions…</p>}
     {!loading&&sessions.length===0&&<p className="blind-empty">No counts for this store yet. Create one to start recording physical quantities.</p>}
     {sessions.map(s=><button type="button" key={s.id} className={"blind-session "+(Number(activeId)===Number(s.id)?"active":"")} onClick={()=>openCount(s.id)} disabled={Boolean(busy)}>
       <strong>{s.title}</strong><small>{new Date(s.created_at).toLocaleDateString("en-GH")} · {statusLabel[s.status]||s.status}</small>
       <span>{s.completed_items} / {s.total_items} recorded</span>
      </button>)}
    </div>
   </aside>
   <section className="blind-content">
    {!detail?<div className="blind-welcome"><span>◎</span><h2>Your next stock inspection begins here</h2><p>Select an existing session or start a fresh count. The system stock levels remain hidden until every product is counted and the results are submitted.</p></div>:
    <>
     <div className="blind-section-head">
      <div><span className="blind-eyebrow">COUNT #{detail.session.id} · {(statusLabel[detail.session.status]||"").toUpperCase()}</span>
       <h2>{detail.session.title}</h2>
       <p>{revealed?"Variance analysis is compared with the original system snapshot.":"Only product identity and your physical counts are visible. Enter zero for an item you verified is missing."}</p></div>
      <span className={"blind-stage "+(revealed?"done":"")}>{revealed?"Analysis unlocked":"Blind mode"}</span>
     </div>
     {!revealed?<div className="blind-progress"><div className="blind-progress-head"><strong>{int(detail.progress.counted)} of {int(detail.progress.total)} counted</strong><span>{detail.progress.total?Math.round(100*detail.progress.counted/detail.progress.total):0}% complete</span></div><div className="blind-progress-bar"><span style={{width:(detail.progress.total?100*detail.progress.counted/detail.progress.total:0)+"%"}}/></div></div>:
      <div className="blind-stats">
       <Stat label="Items reconciled" value={int(summary?.products)}/>
       <Stat label="Discrepancies" value={int(summary?.discrepancies)} tone="warn"/>
       <Stat label="Shortage exposure" value={money(summary?.shortage_cost)} tone="negative" note="At historical snapshot cost"/>
       <Stat label="Excess stock value" value={money(summary?.excess_cost)} tone="positive"/>
       <Stat label="Net cost variance" value={money(summary?.net_variance_cost)}/>
       <Stat label="Stock movement warnings" value={int(summary?.changed_during_count)} tone="warn"/>
      </div>
     }
     {revealed&&<div className="blind-insights"><strong>Audit interpretation</strong><p>{summary?.reconciliation_note}</p><p><strong>{int(summary?.shortage_units)} units short</strong> · {int(summary?.excess_units)} units extra · {int(summary?.high_priority)} high-value shortages. Counts are not proof of theft; investigate transfers, receipts, returns and movements before correcting stock.</p></div>}
     <div className="blind-toolbar">
      <label className="blind-search"><span>Search products</span><input type="search" placeholder="Name, barcode, category, product ID…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="blind-filter"><span>Show</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{filterOptions.filter(x=>revealed||["all","uncounted"].includes(x.key)).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
      <span className="blind-results">{visible.length} displayed</span>
     </div>
     <div className="blind-table-wrap">
      <table className="blind-table"><thead><tr><th>Product / barcode</th>{revealed?<><th>System start</th><th>Physical</th><th>Difference</th><th>Exposure at cost</th><th>Risk & notes</th></>:<><th>Physical quantity</th><th>Count notes</th><th>Progress</th></>}</tr></thead>
       <tbody>{visible.map(x=>{
        const state=draft[String(x.product_id)];
        const y=resultMap.get(String(x.product_id));
        const countValue=state?.quantity??(x.counted_qty??"");
        const remarkValue=state?.remarks??x.remarks??"";
        return <tr key={x.product_id} className={revealed&&y?.shortage_qty>0?"is-shortage":revealed&&y?.excess_qty>0?"is-excess":""}>
         <td data-label="Product"><strong>{x.name}</strong><small>{x.barcode||"No barcode"} · {x.category||"General"}{x.size?" · "+x.size:""}</small></td>
         {revealed?<><td data-label="System start">{int(y?.expected)}</td><td data-label="Physical">{int(y?.actual)}</td>
          <td data-label="Difference"><strong className={y?.variance<0?"blind-loss":y?.variance>0?"blind-gain":""}>{y?.variance>0?"+":""}{int(y?.variance)}</strong><small>{y?.difference_pct}%</small></td>
          <td data-label="Cost variance"><strong>{money(y?.net_variance_cost)}</strong><small>{y?.shortage_qty>0?"Shortage":y?.excess_qty>0?"Overage":"Balanced"}</small></td>
          <td data-label="Investigation"><span className="blind-risk">{y?.risk}</span><small>{y?.movement_flag?"Stock changed by "+int(y?.stock_movement_during_count)+" during count. ":""}{y?.remarks||y?.notes}</small></td>
         </>:<><td data-label="Physical quantity"><input type="number" min="0" max="1000000000" step="1" inputMode="numeric" aria-label={"Count for "+x.name} value={countValue} onChange={e=>changeEntry(x.product_id,"quantity",e.target.value)} placeholder="Not counted"/></td>
          <td data-label="Count notes"><input type="text" maxLength={600} aria-label={"Notes for "+x.name} value={remarkValue} onChange={e=>changeEntry(x.product_id,"remarks",e.target.value)} placeholder="Shelf / box / damage / witness…"/></td>
          <td data-label="Progress"><span className={x.counted_qty===null?"blind-pill":"blind-pill counted"}>{x.counted_qty===null?"Pending":"Saved"}</span></td></>}
         </tr>;
       })}</tbody></table>
      {visible.length===0&&<div className="blind-empty" style={{padding:24}}>No products match this filter.</div>}
     </div>
     {!revealed?<div className="blind-actions">
      <p><strong>Remember:</strong> an empty count is not zero. Enter 0 for a verified absence. All products must be saved before submitting.</p>
      <button type="button" onClick={saveEntries} disabled={Boolean(busy)||!changes.length}>Save {changes.length?changes.length+" changes":"entries"}</button>
      <button type="button" className="primary" onClick={submitCount} disabled={Boolean(busy)||changes.length>0||detail.progress.counted<detail.progress.total}>Submit & reveal analysis</button>
     </div>:
     <>
      <div className="blind-download"><div><span className="blind-eyebrow">CONTROLLED EVIDENCE</span><h3>Download variance report</h3><p>Executive summary, all items, shortages, overages, movement flags and evidence IDs.</p></div><div className="blind-download-buttons">{[["xlsx","Excel"],["pdf","PDF"],["word","Word"],["csv","CSV"]].map(([format,label])=><button type="button" key={format} disabled={Boolean(busy)} onClick={()=>download(format)}>{busy===format?"Preparing…":label}</button>)}</div></div>
      {detail.session.status==="submitted"&&canReview&&<div className="blind-review"><h3>Independent review</h3><p>A manager other than the count creator/submitter can record the investigation decision. This does not change inventory.</p><textarea value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Evidence checked, next steps, owner, reference numbers…" aria-label="Review findings"/><button type="button" disabled={Boolean(busy)||reviewNotes.trim().length<8} onClick={reviewCount}>Record independent review</button></div>}
      {detail.session.review_notes&&<div className="blind-reviewed"><strong>Reviewer findings</strong><p>{detail.session.review_notes}</p></div>}
     </>
     }
    </>}
   </section>
  </section>
 </main>;
}
