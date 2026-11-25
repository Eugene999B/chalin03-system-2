"use strict";
// Advisory, prospective credit policy; never rewrites actual customer scores.
// Only verified, settled debt items with a reliable contractual due date and
// actual final payment date are eligible. Disputed/reversed items are excluded.
function recommendScore(items) {
  if (!Array.isArray(items)) throw new TypeError("Payment evidence required");
  const seen=new Set();let onTime=0,late=0,excluded=0;
  function date(v){if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}
  for(const item of items){
    if(!item||typeof item.id!=="string"||!item.id||seen.has(item.id))throw new Error("Invalid or duplicate payment evidence");
    seen.add(item.id);
    if(item.verified!==true||item.disputed===true||item.reversed===true||item.settled!==true||!date(item.dueDate)||!date(item.settledDate)){excluded++;continue;}
    if(item.settledDate<=item.dueDate)onTime++;else late++;
  }
  return {policy:"prospective-v1",baseline:30,recommendedScore:Math.max(0,Math.min(100,30+2*onTime-3*late)),onTime,late,excluded,advisoryOnly:true};
}
module.exports={recommendScore};
