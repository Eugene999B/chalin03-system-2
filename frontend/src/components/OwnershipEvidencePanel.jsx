import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";

export default function OwnershipEvidencePanel({branchId,onSaved}){
 const [receipt,setReceipt]=useState(""),[rows,setRows]=useState([]),[selected,setSelected]=useState(null);
 const [owner,setOwner]=useState("unclassified"),[evidence,setEvidence]=useState(""),[code,setCode]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 useEffect(()=>{setRows([]);setSelected(null);setReceipt("");setCode("");setEvidence("");setError("");setMessage("");},[branchId]);
 async function search(event){
  event.preventDefault();if(busy||!receipt.trim())return;
  setBusy(true);setError("");setMessage("");setSelected(null);setRows([]);setCode("");
  try{const {data}=await axiosClient.get("/settings/ownership-reconciliation/receipt",{params:{receipt:receipt.trim()}});setRows(data.items||[]);}
  catch(e){setError(e.response?.data?.message||"Could not retrieve the receipt.");}finally{setBusy(false);}
 }
 async function save(event){
  event.preventDefault();if(busy||!selected||evidence.trim().length<3||!/^\d{6}$/.test(code))return;
  setBusy(true);setError("");setMessage("");
  try{
    const {data}=await axiosClient.patch("/settings/ownership-reconciliation/items/"+selected.id,{owner_code:owner,evidence_reference:evidence.trim(),version:selected.version,authenticator_code:code});
    setRows(current=>current.map(row=>row.id===selected.id?{...row,owner_code:owner,evidence_reference:evidence.trim(),version:data.version}:row));
    setSelected(null);setEvidence("");setMessage(data.message);onSaved?.();
  }catch(e){setError(e.response?.data?.message||"Could not save ownership evidence.");}finally{setCode("");setBusy(false);}
 }
 return <div style={{marginTop:20}}>
   <h4>Receipt ownership evidence</h4><p>Classify only goods supported by an actual inventory or consignment record. Original sales, payments and receivables remain unchanged.</p>
   <form className="ccp-settings-form" onSubmit={search}><label>Exact receipt number<input value={receipt} onChange={e=>setReceipt(e.target.value)} maxLength={50} disabled={busy} required/></label><div><button type="submit" disabled={busy||!receipt.trim()}>Find receipt</button></div></form>
   {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
   {rows.length>0&&<div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",marginTop:12}}><thead><tr><th>Item</th><th>Quantity</th><th>Owner</th><th>Evidence</th><th>Action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.product_name}</td><td>{row.quantity}</td><td>{row.owner_code}</td><td>{row.evidence_reference||"Not verified"}</td><td><button type="button" disabled={busy} onClick={()=>{setSelected(row);setOwner(row.owner_code);setEvidence(row.evidence_reference||"");setCode("");}}>Classify</button></td></tr>)}</tbody></table></div>}
   {selected&&<form className="ccp-settings-form" onSubmit={save}>
     <label>Ownership for {selected.product_name}<select value={owner} onChange={e=>setOwner(e.target.value)} disabled={busy}><option value="unclassified">Unclassified</option><option value="chalin03">CHALIN03</option><option value="partner">Business partner</option></select></label>
     <label>Verified evidence reference<input value={evidence} onChange={e=>setEvidence(e.target.value)} minLength={3} maxLength={255} disabled={busy} required/></label>
     <label>Authenticator code<input inputMode="numeric" autoComplete="off" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} maxLength={6} disabled={busy} required/></label>
     <div><button type="submit" disabled={busy||evidence.trim().length<3||code.length!==6}>Verify and save ownership</button><button type="button" disabled={busy} onClick={()=>{setSelected(null);setCode("");}}>Cancel</button></div>
   </form>}
 </div>;
}
