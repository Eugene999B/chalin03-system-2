"use strict";
const {sendAuditExport}=require("./sparePartsAuditExportService");
const n=v=>Number(v||0);
const money=v=>Math.round((Number(v)||0)*100)/100;
const validInt=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0&&Number(v)<=1000000000&&v!==""&&v!==null&&v!==undefined;
function analyzeLine(row){
  const expected=n(row.expected_qty),actual=n(row.counted_qty),atSubmit=row.system_qty_at_submit==null?null:n(row.system_qty_at_submit);
  const variance=actual-expected,shortage=Math.max(-variance,0),excess=Math.max(variance,0);
  const cost=n(row.unit_cost),retail=n(row.unit_price);
  const movement=atSubmit==null?null:atSubmit-expected;
  const movementFlag=movement!==null&&movement!==0;
  const differencePct=expected>0?money(100*variance/expected):(actual>0?100:0);
  const priority=shortage>0&&money(shortage*cost)>=1000?"High":shortage>0?"Review":excess>0?"Check overage":"Balanced";
  return {
    product_id:Number(row.product_id),name:row.product_name,barcode:row.barcode||"",
    size:row.product_size||"",category:row.category||"",
    expected,actual,variance,difference_pct:differencePct,
    shortage_qty:shortage,excess_qty:excess,
    unit_cost:cost,unit_price:retail,shortage_cost:money(shortage*cost),shortage_retail:money(shortage*retail),
    excess_cost:money(excess*cost),net_variance_cost:money(variance*cost),
    net_variance_retail:money(variance*retail),
    system_at_submit:atSubmit,stock_movement_during_count:movement,movement_flag:movementFlag,
    risk:movementFlag?"Reconcile movements":priority,
    remarks:row.remarks||"",counted_by:row.counted_by_name||"",counted_at:row.counted_at||"",
    notes:shortage>0?"Investigate shortage; not proof of theft":excess>0?"Investigate unrecorded receipts, returns or transfers":"No difference",
  };
}
function analyzeLines(raw){
  const lines=raw.map(analyzeLine);
  const total=(key)=>money(lines.reduce((s,x)=>s+n(x[key]),0));
  const mismatch=lines.filter(x=>x.variance!==0);
  const movement=lines.filter(x=>x.movement_flag);
  return {lines,summary:{
    products:lines.length,balanced:lines.length-mismatch.length,
    discrepancies:mismatch.length,shortage_items:lines.filter(x=>x.shortage_qty>0).length,
    excess_items:lines.filter(x=>x.excess_qty>0).length,
    shortage_units:total("shortage_qty"),excess_units:total("excess_qty"),
    shortage_cost:total("shortage_cost"),shortage_retail:total("shortage_retail"),
    excess_cost:total("excess_cost"),net_variance_cost:total("net_variance_cost"),
    net_variance_retail:total("net_variance_retail"),
    changed_during_count:movement.length,
    high_priority:lines.filter(x=>x.risk==="High").length,
    reconciliation_note:"Physical differences are indicators requiring verification, not proof of theft. Check movement records, returns, transfers, receipt adjustments and counting errors."
  }};
}
function reportColumns(){
  return [
    {key:"product_id",label:"Product ID"},{key:"name",label:"Item",weight:3},
    {key:"barcode",label:"Barcode",weight:1.4},{key:"category",label:"Category",weight:1.5},
    {key:"expected",label:"System @ Start"},{key:"actual",label:"Physical Count"},
    {key:"variance",label:"Difference"},{key:"difference_pct",label:"Variance %"},
    {key:"shortage_qty",label:"Missing Units"},{key:"excess_qty",label:"Extra Units"},
    {key:"unit_cost",label:"Unit Cost"},{key:"unit_price",label:"Unit Price"},
    {key:"shortage_cost",label:"Shortage Cost"},{key:"shortage_retail",label:"Shortage Retail"},
    {key:"excess_cost",label:"Excess Cost"},{key:"net_variance_cost",label:"Net Cost Variance"},
    {key:"system_at_submit",label:"Stock @ Submit"},{key:"stock_movement_during_count",label:"Movement During Count"},
    {key:"risk",label:"Review Priority"},{key:"remarks",label:"Count Notes"},{key:"counted_by",label:"Counted By"},{key:"notes",label:"Interpretation",weight:2},
  ];
}
async function exportCount(res,session,raw,format,who){
  const {lines,summary}=analyzeLines(raw);
  const metrics=Object.entries(summary).filter(([k])=>k!=="reconciliation_note").map(([k,v])=>[k.replace(/_/g," ").toUpperCase(),v]);
  return sendAuditExport(res,{
    format,title:"Blind Stock Count | Variance Investigation",
    description:summary.reconciliation_note,
    branch:session.branch_code+" - "+session.branch_name,
    period:"Snapshot "+new Date(session.created_at).toISOString().slice(0,16)+" UTC / Submitted "+new Date(session.submitted_at).toISOString().slice(0,16)+" UTC",
    generatedBy:who,filename:"chalin03-blind-count-"+session.branch_id+"-"+session.id,
    columns:reportColumns(),rows:lines,metrics,
    sections:[
      {name:"Shortages",columns:reportColumns(),rows:lines.filter(x=>x.shortage_qty>0)},
      {name:"Overages",columns:reportColumns(),rows:lines.filter(x=>x.excess_qty>0)},
      {name:"Count Drift Review",columns:reportColumns(),rows:lines.filter(x=>x.movement_flag)},
      {name:"Matching Stock",columns:reportColumns(),rows:lines.filter(x=>x.variance===0)}
    ]
  });
}
module.exports={analyzeLine,analyzeLines,exportCount,validInt};
