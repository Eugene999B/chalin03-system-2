"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readPlanningPeriods,planningPeriodsCsv}=require("../services/managementPlanningService");
test("period estimates reconcile to actual invoices and stay read-only",async()=>{
 const db={query:async(sql,p)=>{assert.match(sql,/^SELECT/);assert.match(sql,/branch_id=\?/);assert.deepEqual(p,[3]);return [[{as_of:"2026-11-25",today:"22470.00",last_seven_days:"158478.00",month_to_date:"200000.00"}]];}};
 const r=await readPlanningPeriods(db,3);assert.equal(r.scenario_only,true);assert.equal(r.periods[0].estimated_company_amount,1348200);assert.equal(r.periods[1].estimated_company_amount,9508680);
 for(const row of r.periods)assert.equal(row.estimated_company_amount+row.assumed_partner_amount,row.actual_invoice_total);
 assert.match(planningPeriodsCsv(r),/PLANNING ESTIMATE ONLY/);
});
