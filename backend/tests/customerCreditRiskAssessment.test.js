"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {assessCreditRisk}=require("../services/customerCreditRiskAssessment");
const asOf="2026-11-25";
test("new debtor has routine priority and no automatic credit decision",()=>{const r=assessCreditRisk({profile:{limit:25000,outstanding:0},debts:[],asOf});assert.equal(r.review_priority,0);assert.equal(r.level,"routine");assert.equal(r.advisory_only,true);});
test("over-limit overdue debtor with missing identity receives explainable urgent priority",()=>{const r=assessCreditRisk({profile:{limit:25000,outstanding:30000},debts:[{id:1,balance:30000,due_date:"2026-08-01"}],identityMissing:true,asOf});assert.equal(r.level,"urgent");assert.equal(r.review_priority,100);assert.equal(r.overdue_balance,30000);assert.equal(r.factors.length,4);});
test("missing and invalid dates are not invented and same-day due is not overdue",()=>{const r=assessCreditRisk({profile:{limit:25000,outstanding:200},debts:[{id:1,balance:100,due_date:"2026-11-25"},{id:2,balance:100,due_date:"2026-02-30"}],asOf});assert.equal(r.undated_count,1);assert.equal(r.overdue_count,0);assert.equal(r.oldest_overdue_days,0);});
test("duplicate evidence is rejected",()=>assert.throws(()=>assessCreditRisk({profile:{limit:25000,outstanding:100},debts:[{id:1,balance:50},{id:1,balance:50}],asOf}),/duplicate/));
