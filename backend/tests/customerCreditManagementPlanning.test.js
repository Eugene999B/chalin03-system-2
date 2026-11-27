const test=require("node:test"),assert=require("node:assert/strict");
const {salesPlanningScenario}=require("../services/ownershipReceiptPreviewService");
const {readScenario}=require("../services/managementPlanningService");
test("adjustable percentages preserve actual totals and round exactly",()=>{for(const percent of [0,1,35,40,75,100]){const s=salesPlanningScenario(101,percent);assert.equal(s.assumed_partner_amount+s.estimated_company_amount,101);}assert.throws(()=>salesPlanningScenario(100,101));});
test("planning reads stored percentage and selected-store actual amount without writes",async()=>{const calls=[];const result=await readScenario({query:async(sql,params)=>{calls.push({sql,params});return [calls.length===1?[{assumed_partner_percent:25,version:3}]:[{actual:"1000.00"}]];}},7);assert.equal(result.estimated_company_amount,75000);assert.equal(result.version,"3");assert.deepEqual(calls[1].params,[7]);assert.ok(calls.every(c=>c.sql.startsWith("SELECT")));});
