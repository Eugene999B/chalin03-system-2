import {useEffect,useMemo,useState} from "react";
import axiosClient from "../api/axiosClient";
import "./ProductPriceRequestModal.css";

const money = value => "GHS "+Number(value||0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
function priceDelta(before,after){
  const previous=Number(before||0),next=Number(after||0);
  if(!Number.isFinite(next)||next<0)return "Invalid amount";
  if(previous===0)return next===0?"No change":"New price";
  const change=(next-previous)/previous*100;
  return (change>0?"+":"")+change.toFixed(1)+"%";
}

export default function ProductPriceRequestModal({product,onClose,onSubmitted}){
  const [cost,setCost]=useState("");
  const [selling,setSelling]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  useEffect(()=>{
    setCost(product?.cost_price===undefined?"":String(product.cost_price));
    setSelling(product?.selling_price===undefined?"":String(product.selling_price));
    setReason("");setError("");setSuccess("");
  },[product?.id,product?.cost_price,product?.selling_price]);
  const change=useMemo(()=>{
    if(!product)return false;
    return Number(cost)!==Number(product.cost_price)||Number(selling)!==Number(product.selling_price);
  },[cost,selling,product]);
  if(!product)return null;
  async function submit(event){
    event.preventDefault();
    setError("");setSuccess("");
    if(!change)return setError("Enter a different cost or selling price.");
    if(!Number.isFinite(Number(cost))||Number(cost)<0||!Number.isFinite(Number(selling))||Number(selling)<0)
      return setError("Enter valid, non-negative prices.");
    if(reason.trim().length<12)return setError("Explain the price change in at least 12 characters.");
    if(!window.confirm("Submit the proposed prices for independent approval? The current prices will not change yet."))return;
    setBusy(true);
    try{
      const response=await axiosClient.post("/products/"+product.id+"/price-change-request",{
        cost_price:cost,selling_price:selling,reason:reason.trim()
      });
      setSuccess((response.data.message||"Request submitted.")+
        (response.data.request?.request_code?" Reference: "+response.data.request.request_code:""));
      onSubmitted?.(response.data);
    }catch(e){setError(e.response?.data?.message||"Could not submit price change request.");}
    finally{setBusy(false);}
  }
  return <div className="ppr-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section className="ppr-dialog" role="dialog" aria-modal="true" aria-labelledby="ppr-title">
      <header className="ppr-header">
        <div>
          <span>CHALIN03 · CONTROLLED PRICING</span>
          <h2 id="ppr-title">Request Price Change</h2>
          <p>{product.name} · Store {product.branch_id}</p>
        </div>
        <button type="button" className="ppr-close" disabled={busy} onClick={onClose} aria-label="Close price change">×</button>
      </header>
      {success?<div className="ppr-success" role="status">
        <strong>Request awaiting approval</strong><p>{success}</p>
        <p>Boss, System Administrator or Auditor can review this in Approval Centre.</p>
        <button type="button" onClick={onClose}>Done</button>
      </div>:<form className="ppr-body" onSubmit={submit}>
        <p className="ppr-explainer">Your request will be reviewed before the product price changes. Current stock, completed receipts and customer balances are not altered.</p>
        <div className="ppr-prices">
          <label>Proposed cost price (GHS)
            <small>Current: {money(product.cost_price)}</small>
            <input type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" value={cost}
              onChange={e=>setCost(e.target.value)} required />
            <em>Change: {priceDelta(product.cost_price,cost)}</em>
          </label>
          <label>Proposed selling price (GHS)
            <small>Current: {money(product.selling_price)}</small>
            <input type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" value={selling}
              onChange={e=>setSelling(e.target.value)} required />
            <em>Change: {priceDelta(product.selling_price,selling)}</em>
          </label>
        </div>
        <label className="ppr-reason">Business reason (required)
          <textarea rows={3} maxLength={1000} minLength={12} value={reason}
            placeholder="Explain the reason, supplier cost change, margin or market evidence..."
            onChange={e=>setReason(e.target.value)} required />
        </label>
        {error?<p className="ppr-error" role="alert">{error}</p>:null}
        <div className="ppr-footer">
          <button type="button" className="ppr-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy||!change||reason.trim().length<12}>
            {busy?"Submitting...":"Send for Approval"}
          </button>
        </div>
      </form>}
    </section>
  </div>;
}
