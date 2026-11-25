"use strict";
// Start with new credit receipts after the management grace reset. Pre-reset
// receipts have changed contractual dates and cannot establish fair historical
// punctuality without individually verified original terms.
const {toPesewas}=require("./customerCreditProfileService");
const {recommendScore}=require("./customerCreditScoreRecommendation");
const {creditLimit}=require("./customerCreditPolicy");
const START_DATE="2026-11-26";
function dateOnly(v){
 const s=v instanceof Date?(Number.isFinite(v.getTime())?v.toISOString().slice(0,10):""):typeof v==="string"?v.slice(0,10):"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
 const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
}
function buildRepaymentRecommendation(debts,{asOf=new Date()}={}){
 const today=dateOnly(asOf);if(!today||!Array.isArray(debts))throw Error("Valid credit evidence required");
 const evidence=[];let pending=0,excludedBeforeReset=0,excludedUnverified=0;
 const seen=new Set();
 for(const debt of debts){
  const id=String(debt.id??"");if(!id||seen.has(id))throw Error("Duplicate debt evidence");seen.add(id);
  const saleDate=dateOnly(debt.sale_date),dueDate=dateOnly(debt.due_date);
  if(saleDate&&saleDate<START_DATE){excludedBeforeReset++;continue;}
  if(!saleDate||saleDate>today||!dueDate||dueDate<saleDate||debt.sale_status!=="completed"||Number(debt.is_voided)!==0||Number(debt.has_return)!==0||!["credit","mixed"].includes(debt.payment_type)){excludedUnverified++;continue;}
  let owed,paid,balance;try{owed=toPesewas(debt.amount_owed);paid=toPesewas(debt.amount_paid);balance=toPesewas(debt.balance);}catch{excludedUnverified++;continue;}
  if(balance>0){pending++;continue;}
  if(debt.status!=="paid"||owed<=0||paid!==owed||!Array.isArray(debt.payments)||!debt.payments.length){excludedUnverified++;continue;}
  let sum=0,last=null,valid=true;const paymentIds=new Set();
  for(const payment of debt.payments){
   const pId=String(payment.id??""),pDate=dateOnly(payment.paid_at);
   if(!pId||paymentIds.has(pId)||String(payment.debt_id)!==id||!pDate||pDate<saleDate||pDate>today){valid=false;break;}
   paymentIds.add(pId);
   try{const amount=toPesewas(payment.amount);if(amount<=0||!Number.isSafeInteger(sum+amount)){valid=false;break;}sum+=amount;}catch{valid=false;break;}
   if(last===null||pDate>last)last=pDate;
  }
  if(!valid||sum!==owed){excludedUnverified++;continue;}
  evidence.push({id,verified:true,settled:true,dueDate,settledDate:last});
 }
 const r=recommendScore(evidence);
 return {...r,tracking_start:START_DATE,pending,excluded_before_reset:excludedBeforeReset,excluded_unverified:excludedUnverified,eligible_settlements:evidence.length,recommended_limit:creditLimit(r.recommendedScore)/100,evidence_status:evidence.length?"available":"awaiting_eligible_settlements"};
}
module.exports={START_DATE,buildRepaymentRecommendation};
