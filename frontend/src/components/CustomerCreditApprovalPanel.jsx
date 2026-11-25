import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";

const currency=value=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(Number(value)/100);
function payloadOf(row){try{return typeof row.sale_payload==="string"?JSON.parse(row.sale_payload):row.sale_payload||{};}catch{return {};}}
export default function CustomerCreditApprovalPanel({branchId,userId}){
  const [requests,setRequests]=useState([]),[allowed,setAllowed]=useState(false),[visible,setVisible]=useState(false);
  const [selected,setSelected]=useState(null),[reason,setReason]=useState(""),[code,setCode]=useState("");
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  useEffect(()=>{
    let live=true;
    setVisible(false);setSelected(null);setReason("");setCode("");setError("");setRequests([]);setMessage("");
    axiosClient.get("/sales/credit-approvals").then(({data})=>{
      if(live){setRequests(data.requests||[]);setAllowed(Boolean(data.can_review));setVisible(true);}
    }).catch(e=>{if(live&&e.response?.status!==404){setError(e.response?.data?.message||"Credit approval queue could not be loaded.");setVisible(true);}});
    return ()=>{live=false;};
  },[branchId,userId,reload]);
  async function review(action){
    if(!selected||busy||!allowed||Number(selected.requested_by)===Number(userId)||reason.trim().length<3||!/^\d{6}$/.test(code))return;
    setBusy(true);setError("");setMessage("");
    try{
      const {data}=await axiosClient.post("/sales/credit-approvals/"+selected.id+"/review",{action,reason:reason.trim(),authenticator_code:code});
      setSelected(null);setReason("");setMessage(data.message);
      const fresh=await axiosClient.get("/sales/credit-approvals");
      setRequests(fresh.data.requests||[]);
    }catch(e){setError(e.response?.data?.message||"Review could not be completed. Refresh to check the request status.");}
    finally{setCode("");setBusy(false);}
  }
  if(!visible)return null;
  const payload=selected?payloadOf(selected):null;
  return <section className="ccp">
    <div className="ccp-heading"><div><small>CHALIN03 · CREDIT INTELLIGENCE</small><h3>Credit Approval Centre</h3></div><span className="ccp-preview">Staging preview</span></div>
    <p>Review over-limit credit purchases before a sale is posted. Approval is not a payment or receipt.</p>
    <button type="button" disabled={busy} onClick={()=>setReload(v=>v+1)}>Refresh requests</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!requests.length?<p>No credit requests in this store.</p>:<div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",marginTop:12}}><thead><tr><th>Request</th><th>Customer</th><th>New credit</th><th>Status</th><th>Review</th></tr></thead><tbody>{requests.map(row=><tr key={row.id}><td>#{row.id}</td><td>{row.customer_name}</td><td>{currency(row.new_debt_pesewas)}</td><td>{!Number(row.active)&&["pending","approved"].includes(row.status)?"expired":row.status}</td><td><button type="button" disabled={busy} onClick={()=>{setSelected(row);setCode("");setReason("");setError("");}}>Details</button></td></tr>)}</tbody></table></div>}
    {selected&&<div className="ccp-metrics" style={{marginTop:16}}>
      <div><span>Score at request</span><strong>{selected.score_at_request}/100</strong></div>
      <div><span>Credit limit</span><strong>{currency(selected.limit_at_request_pesewas)}</strong></div>
      <div><span>Exposure at request</span><strong>{currency(selected.exposure_at_request_pesewas)}</strong></div>
      <div><span>Requested additional credit</span><strong>{currency(selected.new_debt_pesewas)}</strong></div>
      <div style={{gridColumn:"1/-1"}}><strong>Sale details</strong><p>Total: GH₵{payload?.total} · Paid amount proposed: GH₵{payload?.paid}</p>{Array.isArray(payload?.items)&&payload.items.map(item=><p key={item.product_id}>Product #{item.product_id} · Qty {item.quantity} · GH₵{item.line_total}</p>)}{selected.review_reason&&<p>Review reason: {selected.review_reason}</p>}</div>
      {allowed&&selected.status==="pending"&&Number(selected.active)===1&&Number(selected.requested_by)!==Number(userId)&&<form className="ccp-settings-form" style={{gridColumn:"1/-1"}} onSubmit={e=>e.preventDefault()}>
        <label>Review reason<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>
        <label>Authenticator code<input inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} disabled={busy}/></label>
        <div><button type="button" disabled={busy||reason.trim().length<3||code.length!==6} onClick={()=>review("approve")}>Approve request</button><button type="button" disabled={busy||reason.trim().length<3||code.length!==6} onClick={()=>review("reject")}>Reject request</button></div>
      </form>}
      <button type="button" disabled={busy} onClick={()=>{setSelected(null);setCode("");setReason("");}}>Close details</button>
    </div>}
  </section>;
}
