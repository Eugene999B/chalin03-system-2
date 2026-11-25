import {useEffect,useRef,useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";

const money=pesewas=>new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS"}).format(Number(pesewas)/100);
export default function CreditRequestRecoveryPanel({branchId,userId,onPosted,refreshKey}){
  const [rows,setRows]=useState([]),[visible,setVisible]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const locked=useRef(false);
  useEffect(()=>{
    let active=true;setRows([]);setVisible(false);setError("");setMessage("");
    axiosClient.get("/sales/credit-approvals").then(({data})=>{
      if(active){setRows((data.requests||[]).filter(r=>Number(r.requested_by)===Number(userId)));setVisible(true);}
    }).catch(e=>{if(active&&e.response?.status!==404){setError(e.response?.data?.message||"Could not load your credit requests.");setVisible(true);}});
    return ()=>{active=false;};
  },[branchId,userId,reload,refreshKey]);
  async function act(row,action){
    if(locked.current)return;
    if(action==="post"&&!window.confirm("Post this exact approved purchase now? Confirm the customer and payment are ready. Do not record a second payment."))return;
    if(action==="cancel"&&!window.confirm("Cancel this request and release any credit reservation?"))return;
    locked.current=true;setBusy(true);setError("");setMessage("");
    try{
      if(action==="cancel"){
        const {data}=await axiosClient.post("/sales/credit-approvals/"+row.id+"/cancel");
        setMessage(data.message);
      }else{
        const {data}=await axiosClient.get("/sales/credit-approvals/"+row.id+"/recovery");
        const posted=await axiosClient.post("/sales",data.sale,{headers:{"x-chalin-credit-request-key":data.request_key,"x-chalin-credit-recovery-id":String(row.id)}});
        if(posted.status!==201||!posted.data.receipt?.sale_id)throw new Error("No final sale confirmation. Check request status before retrying.");
        setMessage("Approved purchase posted as sale #"+posted.data.receipt.sale_id+". Do not collect payment again.");
        onPosted?.(row.id,posted.data.receipt);
      }
      const {data}=await axiosClient.get("/sales/credit-approvals");
      setRows((data.requests||[]).filter(r=>Number(r.requested_by)===Number(userId)));
    }catch(e){setError(e.response?.data?.message||e.message||"Action could not be completed. Refresh the request status before retrying.");}
    finally{locked.current=false;setBusy(false);}
  }
  if(!visible)return null;
  return <section className="ccp">
    <div className="ccp-heading"><div><small>CHALIN03 · CREDIT INTELLIGENCE</small><h3>My credit requests</h3></div><span className="ccp-preview">Staging preview</span></div>
    <p>Resume approved purchases after a browser reload. The original request and exact server-priced sale are recovered securely from the server.</p>
    <button type="button" disabled={busy} onClick={()=>setReload(v=>v+1)}>Refresh requests</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!rows.length?<p>No submitted credit requests in this store.</p>:<div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",marginTop:12}}><thead><tr><th>Request</th><th>Customer</th><th>Credit</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(row=>{
      const active=Number(row.active)===1&&["pending","approved"].includes(row.status);
      const status=!active&&["pending","approved"].includes(row.status)?"expired":row.status;
      return <tr key={row.id}><td>#{row.id}</td><td>{row.customer_name}</td><td>{money(row.new_debt_pesewas)}</td><td>{status}{row.executed_sale_id?" · Sale #"+row.executed_sale_id:""}</td><td>{active&&row.status==="approved"&&<button type="button" disabled={busy} onClick={()=>act(row,"post")}>Post approved sale</button>} {active&&<button type="button" disabled={busy} onClick={()=>act(row,"cancel")}>Cancel</button>}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
