"use strict";
const {toPesewas}=require("./customerCreditProfileService");
const {salesPlanningScenario}=require("./ownershipReceiptPreviewService");
const {parseScenarioPercent,readSettings}=require("./managementPlanningService");
const REPORTS=Object.freeze({
 "business-intelligence":["sales","debts","collections","returns"],
 "collections-intelligence":["debts","collections"],
 "stock-intelligence":["sales"],
 "daily-closings":["sales","collections","returns"],
 "discount-audit":["sales"],
 "transaction-history":["sales","debts","collections","returns"],
 "sales":["sales"],"debts":["debts"],"debt-payments":["collections"],"returns":["returns"]
});
function date(v){
 if(v===undefined||v==="")return null;
 if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error("Invalid reporting date");
 const d=new Date(v+"T00:00:00Z");
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw Error("Invalid reporting date");
 return v;
}
function dateFilter(column,from,to,params){
 let sql="";
 if(from){sql+=" AND "+column+">=?";params.push(from);}
 if(to){sql+=" AND "+column+"<DATE_ADD(?, INTERVAL 1 DAY)";params.push(to);}
 return sql;
}
async function readComparison(db,branchId,{report,from,to,percent,settingsEnabled=false}){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw Error("Invalid branch");
 if(typeof report!=="string"||!Object.hasOwn(REPORTS,report))throw Object.assign(Error("This report has no supported shareholder allocation basis"),{statusCode:400});
 let start,end,share;
 try{start=date(from);end=date(to);if(start&&end&&start>end)throw Error("Invalid date range");share=parseScenarioPercent(percent);}catch(e){throw Object.assign(e,{statusCode:400});}
 if(share===undefined)share=settingsEnabled?(await readSettings(db)).assumed_partner_percent:40;
 const rows=[];
 function add(label,value,basis){
  const actual=toPesewas(value),a=salesPlanningScenario(actual,share);
  rows.push({label,basis,actual,partner:a.assumed_partner_amount,company:a.estimated_company_amount});
 }
 for(const group of REPORTS[report]){
  if(group==="sales"){
   const params=[branchId],filter=dateFilter("s.created_at",start,end,params);
   const [[r]]=await db.query("SELECT COALESCE(SUM(s.total),0) AS invoices,COALESCE(SUM(s.tax_amount),0) AS tax,COALESCE(SUM(s.discount_amount),0) AS discounts,COALESCE(SUM(s.amount_paid),0) AS paid FROM sales s WHERE s.branch_id=? AND s.sale_status='completed' AND s.is_voided=0"+filter,params);
   const basis="Completed non-void invoices by sale date; before return adjustments";
   add("Recorded invoice value",r.invoices,basis);add("Invoice tax",r.tax,basis);add("Recorded discounts",r.discounts,basis);add("Amount paid at sale",r.paid,basis);
  }
  if(group==="debts"){
   const [[r]]=await db.query("SELECT COALESCE(SUM(d.balance),0) AS outstanding FROM debts d WHERE d.branch_id=? AND d.balance>0",[branchId]);
   add("Current outstanding receivables",r.outstanding,"Current snapshot, all dates; customer obligations unchanged");
  }
  if(group==="collections"){
   const params=[branchId],filter=dateFilter("p.paid_at",start,end,params);
   const [[r]]=await db.query("SELECT COALESCE(SUM(p.amount),0) AS collections FROM debt_payments p WHERE p.branch_id=?"+filter,params);
   add("Recorded debt collections",r.collections,"Debt payment event date");
  }
  if(group==="returns"){
   const params=[branchId],filter=dateFilter("r.returned_at",start,end,params);
   const [[r]]=await db.query("SELECT COALESCE(SUM(r.refund_amount),0) AS refunds FROM returns r WHERE r.branch_id=? AND r.return_type='refund'"+filter,params);
   add("Recorded return refund amounts",r.refunds,"Return event date; not a net sales or cash reconciliation");
  }
 }
 return {report,branch_id:branchId,from:start,to:end,percent:share,scenario_only:true,generated_at:new Date().toISOString(),rows};
}
function csv(report){
 const money=n=>(n/100).toFixed(2);
 const data=[["SHAREHOLDER COMPARISON - PLANNING ESTIMATE ONLY"],["Source report",report.report],["Store ID",report.branch_id],["From",report.from||"All earlier dates"],["To",report.to||"Latest available"],["Assumed partner share (%)",report.percent],["Generated (UTC)",report.generated_at],["Basis","Hypothetical allocation, not verified ownership, customer obligations or financial statements. Metrics overlap and must not be added together."],["Metric","Actual GHS","Assumed partner GHS","Estimated company GHS","Scope"]];
 for(const r of report.rows)data.push([r.label,money(r.actual),money(r.partner),money(r.company),r.basis]);
 return data.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";
}
function workbook(report){
 const ExcelJS=require("./excelJsCompat"),w=new ExcelJS.Workbook(),s=w.addWorksheet("Planning comparison");
 w.creator="CHALIN03 Management Planning";
 s.columns=[{width:34},{width:22},{width:22},{width:22},{width:66}];
 const header=s.addRow(["SHAREHOLDER COMPARISON - PLANNING ESTIMATE ONLY"]);s.mergeCells("A1:E1");header.font={bold:true,color:{argb:"FFFFFFFF"},size:15};header.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF16365D"}};header.height=30;
 for(const row of [["Source report",report.report],["Store ID",report.branch_id],["From",report.from||"All earlier dates"],["To",report.to||"Latest available"],["Assumed partner share (%)",report.percent],["Generated UTC",report.generated_at]])s.addRow(row);
 s.addRow(["Hypothetical allocation only. Not verified ownership or financial statements."]);s.mergeCells("A8:E8");
 s.addRow(["Metrics overlap; do not sum rows. Original records and customer obligations unchanged."]);s.mergeCells("A9:E9");
 const headings=s.addRow(["Metric","Actual GHS","Assumed partner GHS","Estimated company GHS","Scope"]);headings.font={bold:true,color:{argb:"FFFFFFFF"}};headings.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF16365D"}};
 for(const r of report.rows){const row=s.addRow([r.label,r.actual/100,r.partner/100,r.company/100,r.basis]);for(let i=2;i<=4;i++)row.getCell(i).numFmt='#,##0.00;[Red](#,##0.00)';row.alignment={vertical:"middle",wrapText:true};row.height=32;}
 s.views=[{state:"frozen",ySplit:10}];return w;
}
module.exports={REPORTS,readComparison,csv,workbook};
