"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {loadDebtListCreditProfiles}=require("../services/customerCreditProfileService");
test("uses complete customer balance not truncated receipts, and includes legacy profiles",async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/SUM\(CASE WHEN d.balance>0/);assert.match(sql,/d.branch_id=\?/);assert.deepEqual(params,[2,5,2]);return [[{customer_id:5,canonical_id:5,outstanding:"194775.00"}]];}};
 const r=await loadDebtListCreditProfiles(db,{branchId:2,debts:[{id:1,customer_id:5,balance:820},{id:2,customer_id:5,balance:20},{id:3,customer_id:null,balance:100}]});
 assert.equal(r["customer-5"].score,30);assert.equal(r["customer-5"].outstanding,194775);assert.equal(r["customer-5"].available,0);assert.equal(r["customer-5"].initial_estimate,true);assert.equal(r["legacy-3"].available,24900);
});
test("activated list includes saved score and approved reservations",async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/customer_credit_approval_requests/);assert.deepEqual(params,[2,5,2,2]);return [[{customer_id:5,canonical_id:5,outstanding:"25000.00",score:40,term_months:2,reserved:"5000.00"}]];}};
 const r=await loadDebtListCreditProfiles(db,{branchId:2,debts:[{id:1,customer_id:5,balance:820}],enabled:true,enforcementActive:true});
 assert.equal(r["customer-5"].limit,50000);assert.equal(r["customer-5"].available,20000);assert.equal(r["customer-5"].term_months,2);assert.equal(r["customer-5"].enforcement_active,true);
});
