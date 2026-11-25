import React from "react";
import "../styles/customerCreditProfile.css";

const money = value => new Intl.NumberFormat("en-GH", {
  style:"currency", currency:"GHS", maximumFractionDigits:2
}).format(value);

export default function CustomerCreditProfile({profile}) {
  if (!profile || !Number.isInteger(profile.score) || profile.score < 0 || profile.score > 100) return null;
  const utilization = profile.utilization_percent;
  const status = profile.at_limit ? "At credit limit" : "Within credit limit";
  return <section className="ccp" aria-label="Customer credit intelligence preview">
    <div className="ccp-heading"><div><small>CHALIN03 · CREDIT INTELLIGENCE</small><h3>Customer credit profile</h3></div><span className="ccp-preview">Preview</span></div>
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
        <div><span>Approved limit</span><strong>{money(profile.limit)}</strong></div>
        <div><span>Outstanding debt</span><strong>{money(profile.outstanding)}</strong></div>
        <div><span>Available credit</span><strong>{money(profile.available)}</strong></div>
        <div><span>Default term</span><strong>{profile.term_months} {profile.term_months===1?"month":"months"}</strong></div>
      </div>
    </div>
    <div className="ccp-util-label"><span>Credit utilization</span><strong>{utilization===null?"Not applicable":utilization+"%"}</strong></div>
    <div className="ccp-track" role="meter" aria-label="Credit utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,utilization??0)}><div style={{width:`${Math.min(100,utilization??0)}%`,background:profile.at_limit?"#b45309":"#087c72"}}/></div>
    <p className="ccp-status">{status}. Preview only: purchase enforcement and approval are not active.</p>
  </section>;
}
