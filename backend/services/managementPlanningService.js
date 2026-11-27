"use strict";
const {toPesewas}=require("./customerCreditProfileService");
const {salesPlanningScenario}=require("./ownershipReceiptPreviewService");
async function readSettings(db,lock=false){
 const [rows]=await db.query("SELECT assumed_partner_percent,version FROM management_planning_settings WHERE id=1"+(lock?" FOR UPDATE":""));
 if(!rows.length)throw new Error("Planning settings migration is required");
 return {assumed_partner_percent:Number(rows[0].assumed_partner_percent),version:String(rows[0].version)};
}
async function readScenario(db,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const settings=await readSettings(db);
 const [rows]=await db.query("SELECT COALESCE(SUM(total),0) AS actual FROM sales WHERE branch_id=? AND sale_status='completed' AND is_voided=0",[branchId]);
 return {...salesPlanningScenario(toPesewas(rows[0].actual),settings.assumed_partner_percent),version:settings.version};
}
async function readInitialScenario(db,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const [rows]=await db.query("SELECT COALESCE(SUM(total),0) AS actual FROM sales WHERE branch_id=? AND sale_status='completed' AND is_voided=0",[branchId]);
 return {...salesPlanningScenario(toPesewas(rows[0].actual),40),settings_available:false};
}
async function readPlanningPeriods(db,branchId,{settingsEnabled=false}={}){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const settings=settingsEnabled?await readSettings(db):{assumed_partner_percent:40};
 const [rows]=await db.query(`SELECT DATE_FORMAT(UTC_DATE(),'%Y-%m-%d') AS as_of,
 COALESCE(SUM(CASE WHEN created_at>=UTC_DATE() THEN total ELSE 0 END),0) AS today,
 COALESCE(SUM(CASE WHEN created_at>=DATE_SUB(UTC_DATE(),INTERVAL 6 DAY) THEN total ELSE 0 END),0) AS last_seven_days,
 COALESCE(SUM(CASE WHEN created_at>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01') THEN total ELSE 0 END),0) AS month_to_date
 FROM sales WHERE branch_id=? AND sale_status='completed' AND is_voided=0 AND created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)`,[branchId]);
 const row=rows[0],periods=["today","last_seven_days","month_to_date"].map(period=>({period,...salesPlanningScenario(toPesewas(row[period]),settings.assumed_partner_percent)}));
 return {scope:"selected_store_invoice_totals_before_return_adjustments",scenario_only:true,as_of:row.as_of,assumed_partner_percent:settings.assumed_partner_percent,settings_available:settingsEnabled,periods};
}
function planningPeriodsCsv(report){
 const head="Period,Actual recorded invoice total (GHS),Assumed partner percent,Estimated partner share (GHS),Estimated company share (GHS),Scope";
 const money=v=>(v/100).toFixed(2);
 const lines=report.periods.map(r=>[r.period,money(r.actual_invoice_total),r.assumed_partner_percent,money(r.assumed_partner_amount),money(r.estimated_company_amount),"PLANNING ESTIMATE ONLY - before returns"].join(","));
 return [head,...lines].join("\r\n")+"\r\n";
}
// Allocation is a planning scenario, not proof of inventory ownership or a
// change to the actual receivable, payment, tax liability or statutory profit.
const ALLOCATION_FIELDS=["invoice_total","tax","cost","outstanding","debt_collections"];
function allocateFinancialMetrics(total,percent){
 const rows=ALLOCATION_FIELDS.map(metric=>{
  const a=salesPlanningScenario(total[metric],percent);
  return {metric,actual:a.actual_invoice_total,partner:a.assumed_partner_amount,company:a.estimated_company_amount};
 });
 const by=Object.fromEntries(rows.map(r=>[r.metric,r]));
 const actual=by.invoice_total.actual-by.tax.actual-by.cost.actual;
 const partner=by.invoice_total.partner-by.tax.partner-by.cost.partner;
 const company=by.invoice_total.company-by.tax.company-by.cost.company;
 if(![actual,partner,company].every(Number.isSafeInteger)||partner+company!==actual)throw Error("Allocation reconciliation failed");
 rows.push({metric:"invoice_margin_before_returns_and_expenses",actual,partner,company});
 return rows;
}
function parseScenarioPercent(value){
 if(value===undefined)return undefined;
 if(typeof value!=="string"||!/^(0|[1-9][0-9]?|100)$/.test(value))throw Object.assign(Error("Choose a whole percentage from 0 to 100"),{statusCode:400});
 return Number(value);
}
async function readShareholderAllocation(db,branchId,{settingsEnabled=false,percent}={}){
 const periods=await readPlanningPeriods(db,branchId,{settingsEnabled});
 const chosen=percent===undefined?periods.assumed_partner_percent:percent;
 const {readOwnershipReceiptPreview}=require("./ownershipReceiptPreviewService");
 const totals=await readOwnershipReceiptPreview(db,branchId,{classificationEnabled:false});
 return {scenario_only:true,scope:"selected_store_completed_nonvoid_invoices_before_returns",as_of:periods.as_of,configured_percent:periods.assumed_partner_percent,assumed_partner_percent:chosen,settings_available:settingsEnabled,periods:periods.periods.map(r=>({period:r.period,...salesPlanningScenario(r.actual_invoice_total,chosen)})),metrics:allocateFinancialMetrics(totals.total,chosen)};
}
function shareholderAllocationCsv(report){
 const money=v=>(v/100).toFixed(2);
 const rows=[["Report","Shareholder planning allocation - estimate only"],["Scope","Selected store completed nonvoid invoices before returns; not statutory accounts"],["As of",report.as_of],["Assumed partner share percent",report.assumed_partner_percent],["Metric","Actual (GHS)","Assumed partner (GHS)","Estimated company (GHS)"]];
 for(const r of report.periods)rows.push([r.period+"_invoice_total",money(r.actual_invoice_total),money(r.assumed_partner_amount),money(r.estimated_company_amount)]);
 for(const r of report.metrics)rows.push([r.metric,money(r.actual),money(r.partner),money(r.company)]);
 return rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";
}
module.exports={readSettings,readScenario,readInitialScenario,readPlanningPeriods,planningPeriodsCsv,allocateFinancialMetrics,parseScenarioPercent,readShareholderAllocation,shareholderAllocationCsv};
