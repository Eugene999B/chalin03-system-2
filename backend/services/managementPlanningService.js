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
module.exports={readSettings,readScenario,readInitialScenario};
