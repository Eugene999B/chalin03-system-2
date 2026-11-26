export const STAFF_REDUCTION=40;
export function isStaffResearchHost(){return typeof window!=="undefined"&&window.location.hostname==="staff.chalin03.com";}
export function researchSplit(value,{units=false,profit=false}={}){
 if(value===null||value===undefined||value==="")return null;
 const n=Number(value),precision=units?1000000:100;
 if(!Number.isFinite(n))return null;
 const scaled=Math.round(Math.abs(n)*precision);
 if(!Number.isSafeInteger(scaled))return null;
 const actual=(n<0?-1:1)*scaled;
 const remaining=profit&&actual<0?actual:(actual<0?-1:1)*Number((BigInt(scaled)*60n+50n)/100n);
 return {actual:actual/precision,reduction:(actual-remaining)/precision,remaining:remaining/precision};
}
export function researchRows(metrics){return metrics.flatMap(m=>{const r=researchSplit(m.value,{units:m.units,profit:m.profit});return r?[{...m,...r}]:[];});}
export function receiptResearchRows(sales){
 return sales.filter(s=>!s.is_voided||String(s.is_voided)==="0").filter(s=>!["voided","cancelled","canceled","deleted"].includes(String(s.sale_status||"completed").toLowerCase())).map(s=>({id:String(s.receipt_number||s.id||""),date:String(s.created_at||""),sales:researchSplit(s.total),units:researchSplit(s.total_items_sold,{units:true})}));
}
export function csvField(value){let s=String(value??"");if(typeof value!=="number"&&/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function researchCsv(rows,scope){return [["CHALIN03 — INTERNAL RESEARCH ONLY — NOT AN INVOICE OR TAX RECORD"],["Scope",scope],["Fixed sales reduction (%)",40],["Profit assumption","40% of positive recorded net profit; no loss-sharing assumed"],["Metric","Unit","Recorded actual","40% reduction / allocated","Modeled / retained"],...rows.map(r=>[r.label,r.units?"Units":"GHS",r.actual,r.reduction,r.remaining])].map(row=>row.map(csvField).join(",")).join("\r\n")+"\r\n";}
