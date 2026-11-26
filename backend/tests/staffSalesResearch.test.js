"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseReduction,scaleMoney,calculateReceipt,summarize}=require("../services/staffSalesResearchService");
test("40% reduces each modeled receipt without changing source quantity or monetary records",()=>{
 const row={id:1,sale_date:"2026-11-25",units:15,invoice_total:"1500.00",tax:"0.00",cost:"900.00",outstanding:"500.00",debt_collections:"100.00"};
 const result=calculateReceipt(row);
 assert.equal(result.actual.units,15);assert.equal(result.modeled.units,9);
 assert.equal(result.actual.invoice_total,150000);assert.equal(result.modeled.invoice_total,90000);
 assert.equal(result.reduction.units,6);assert.equal(result.reduction.invoice_total,60000);
 assert.equal(result.modeled.cost,54000);assert.equal(result.modeled.outstanding,30000);
 assert.equal(row.units,15);assert.equal(row.invoice_total,"1500.00");
 assert.equal(summarize([result,result]).modeled.invoice_total,180000);
 assert.equal(summarize([result,result]).receipts,2);
});
test("percentage validation and rounding",()=>{
 assert.equal(parseReduction(),40);assert.equal(parseReduction("40"),40);assert.throws(()=>parseReduction("0"));assert.throws(()=>parseReduction("100"));
 assert.throws(()=>parseReduction("101"));assert.throws(()=>parseReduction("40.5"));
 assert.equal(scaleMoney(101),61);assert.equal(scaleMoney(0),0);
 assert.equal(scaleMoney(-101),-61);
});
test("all period totals reconcile to actual with fixed 40% removed",()=>{
 const result=calculateReceipt({id:1,sale_date:"2026-11-25",units:3,invoice_total:"101.01",tax:"5.00",cost:"50.00",outstanding:"10.00",debt_collections:"20.00"});
 const total=summarize([result,result]);
 for(const k of Object.keys(total.actual))assert.ok(Math.abs(total.actual[k]-total.modeled[k]-total.reduction[k])<1e-8);
 assert.equal(total.modeled.invoice_total,12122);
 assert.equal(total.reduction.invoice_total,8080);
});
