import {useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";

const money = value => new Intl.NumberFormat("en-GH", {
  style:"currency", currency:"GHS", maximumFractionDigits:2
}).format(value);

export default function CustomerCreditProfile({profile,onChanged}) {
  if (!profile || !Number.isInteger(profile.score) || profile.score < 0 || profile.score > 100) return null;
  const utilization = profile.utilization_percent;
  const status = profile.over_limit ? "Above credit limit" : profile.at_limit ? "At credit limit" : "Within credit limit";
  return <section className="ccp" aria-label="Customer credit intelligence preview">
    <div className="ccp-heading"><div><small>CHALIN03 · CREDIT INTELLIGENCE</small><h3>Customer credit profile</h3></div><span className="ccp-preview">{profile.enforcement_active?"Active":profile.initial_estimate?"Initial estimate":"Preview"}</span></div>
    <div className="ccp-main">
      <div className="ccp-score">
        <svg viewBox="0 0 240 140" role="img" aria-label={`Credit score ${profile.score} out of 100`}>
          <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="#dbe4ef" strokeWidth="14" strokeLinecap="round"/>
          <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke={profile.at_limit?"#b45309":"#087c72"} strokeWidth="14" strokeLinecap="round" pathLength="100" strokeDasharray={`${profile.score} 100`}/>
          <text x="120" y="94" textAnchor="middle" className="ccp-score-number">{profile.score}</text>
          <text x="120" y="115" textAnchor="middle" className="ccp-score-label">OUT OF 100</text>
        </svg>
      </div>
      <div className="ccp-metrics">
        <div><span>{profile.initial_estimate?"Proposed credit limit":"Credit limit"}</span><strong>{money(profile.limit)}</strong></div>
        <div><span>Outstanding debt</span><strong>{money(profile.outstanding)}</strong></div>
        <div><span>Approved reservations</span><strong>{money(profile.reserved??0)}</strong></div>
        <div><span>{profile.initial_estimate?"Estimated available credit":"Available credit"}</span><strong>{money(profile.available)}</strong></div>
        <div><span>Default term</span><strong>{profile.term_months} {profile.term_months===1?"month":"months"}</strong></div>
      </div>
    </div>
    <div className="ccp-util-label"><span>Credit utilization</span><strong>{utilization===null?"Not applicable":utilization+"%"}</strong></div>
    <div className="ccp-track" role="meter" aria-label="Credit utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,utilization??0)}><div style={{width:`${Math.min(100,utilization??0)}%`,background:profile.at_limit?"#b45309":"#087c72"}}/></div>
    <p className="ccp-status">{status}. {profile.enforcement_active?"Credit approval policy active.":profile.initial_estimate?"Initial score and limit calculated from the existing debt balance; credit approvals and saved score changes are not active.":"Credit approval enforcement is not active."}</p>
    {profile.can_adjust_score&&<ScoreAdjustment key={profile.customer_id+":"+profile.version} profile={profile} onChanged={onChanged}/>}
  </section>;
}
function ScoreAdjustment({profile,onChanged}){
  const [score,setScore]=useState(String(profile.score)),[reason,setReason]=useState(""),[code,setCode]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  async function save(e){
    e.preventDefault();if(busy||reason.trim().length<5||!/^\d{6}$/.test(code)||!/^\d{1,3}$/.test(score)||Number(score)>100)return;
    setBusy(true);setError("");
    try{
      await axiosClient.patch("/settings/customer-credit/customers/"+profile.customer_id,{score:Number(score),version:profile.version,reason:reason.trim(),authenticator_code:code});
      setOpen(false);await onChanged?.();
    }catch(e){setError(e.response?.data?.message||"Could not update score. Reload the profile before retrying.");}
    finally{setCode("");setBusy(false);}
  }
  return <div style={{marginTop:16}}>
    <button type="button" onClick={()=>{setOpen(v=>!v);setCode("");setError("");}}>Review credit score</button>
    {open&&<form className="ccp-settings-form" onSubmit={save}>
      <label>Reviewed score (0–100)<input type="number" min={0} max={100} step={1} value={score} onChange={e=>setScore(e.target.value)} required disabled={busy}/></label>
      <label>Evidence-based reason<input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required disabled={busy}/></label>
      <label>Authenticator code<input inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} required disabled={busy}/></label>
      <div><button type="submit" disabled={busy||Number(score)===profile.score||reason.trim().length<5||code.length!==6}>Verify and update</button></div>
      {error&&<p role="alert">{error}</p>}
    </form>}
  </div>;
}
