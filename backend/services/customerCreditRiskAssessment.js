"use strict";
// Explainable review prioritization, not an automatic credit score or decline.
// Debt balances and dates come from the authorized selected-store debt desk.
const {toPesewas}=require("./customerCreditProfileService");
function day(value){
 const s=value instanceof Date?(Number.isFinite(value.getTime())?value.toISOString().slice(0,10):""):typeof value==="string"?value.slice(0,10):"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
 const d=new Date(s+"T00:00:00Z");
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?d.getTime():null;
}
function assessCreditRisk({profile,debts,identityMissing=false,asOf=new Date()}){
 if(!profile||!Array.isArray(debts))throw new TypeError("Credit evidence required");
 const today=day(asOf);if(today===null)throw new RangeError("Invalid assessment date");
 const limit=toPesewas(profile.limit),exposure=toPesewas(profile.exposure??profile.outstanding);
 let open=0,overdue=0,undated=0,overdueBalance=0,oldestDays=0,openBalance=0;
 const ids=new Set();
 for(const debt of debts){
  const id=String(debt.id??"");if(!id||ids.has(id))throw new Error("Invalid or duplicate debt evidence");ids.add(id);
  const amount=toPesewas(debt.balance);
  if(!amount)continue;
  open++;openBalance+=amount;if(!Number.isSafeInteger(openBalance))throw new RangeError("Debt total out of range");
  const due=day(debt.due_date);if(due===null){undated++;continue;}
  const days=Math.floor((today-due)/86400000);
  if(days>0){overdue++;overdueBalance+=amount;oldestDays=Math.max(oldestDays,days);}
 }
 const utilization=limit?Math.round(exposure/limit*100):null;
 const overdueShare=openBalance?Math.round(overdueBalance/openBalance*100):0;
 const factors=[];
 let points=0;
 if(exposure>0&&(!limit||exposure>=limit)){points+=45;factors.push("Credit limit reached or exceeded");}
 else if(utilization!==null&&utilization>=80){points+=20;factors.push("At least 80% of proposed credit limit used");}
 else if(utilization!==null&&utilization>=50){points+=8;factors.push("At least half of proposed credit limit used");}
 if(overdue){points+=Math.min(30,10+Math.floor(overdueShare/5));factors.push("Outstanding overdue debt");}
 if(oldestDays>=60){points+=20;factors.push("Oldest overdue item is at least 60 days late");}
 else if(oldestDays>=30){points+=12;factors.push("Oldest overdue item is at least 30 days late");}
 if(identityMissing){points+=15;factors.push("Customer identity requires verification");}
 if(undated){points+=10;factors.push("One or more open debts lack a usable due date");}
 const priority=Math.min(100,points);
 const level=priority>=60?"urgent":priority>=30?"elevated":priority>0?"monitor":"routine";
 return {policy:"review-priority-v1",advisory_only:true,review_priority:priority,level,factors,open_count:open,overdue_count:overdue,undated_count:undated,overdue_balance:overdueBalance/100,oldest_overdue_days:oldestDays,overdue_share_percent:overdueShare,identity_missing:Boolean(identityMissing),as_of:new Date(today).toISOString().slice(0,10),action:identityMissing?"Verify customer identity before credit review.":level==="urgent"?"Review repayment and credit exposure before extending additional credit.":level==="elevated"?"Review outstanding balances and repayment arrangements.":level==="monitor"?"Monitor credit utilization and upcoming payments.":"Continue normal credit review procedures."};
}
module.exports={assessCreditRisk};
