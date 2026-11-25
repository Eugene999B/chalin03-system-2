"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {initialCreditPreview}=require("../services/customerCreditProfileService");
const {readInitialScenario}=require("../services/managementPlanningService");
test("existing debtor initial preview preserves balance and does not claim authorization",()=>{
 const p=initialCreditPreview(27650.25);
 assert.equal(p.score,30);assert.equal(p.limit,25000);assert.equal(p.outstanding,27650.25);assert.equal(p.available,0);assert.equal(p.term_months,1);assert.equal(p.enforcement_active,false);assert.equal(p.can_adjust_score,false);assert.equal(p.initial_estimate,true);
});
test("read-only partner scenario uses only existing completed invoice totals",async()=>{
 const db={query:async(sql,args)=>{assert.match(sql,/^SELECT /);assert.match(sql,/is_voided=0/);assert.deepEqual(args,[2]);return [[{actual:"25000.00"}]];}};
 const p=await readInitialScenario(db,2);assert.equal(p.assumed_partner_percent,40);assert.equal(p.actual_invoice_total,2500000);assert.equal(p.estimated_company_amount,1500000);assert.equal(p.settings_available,false);
});
