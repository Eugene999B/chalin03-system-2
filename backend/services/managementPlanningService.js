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
module.exports={readSettings,readScenario,readInitialScenario,readPlanningPeriods,planningPeriodsCsv};
