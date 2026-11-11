"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {calculateReturnLimit}=require("../services/sparePartsReturnLimitService");
const {deriveAccount}=require("../services/equipmentInstallmentReadModelService");
const file=(name)=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const receipt={saleSubtotal:"100.00",saleDiscount:"10.00",saleTax:"5.00",
  saleTotal:"95.00",historicalItemGross:"60.00",soldQuantity:2,returnQuantity:1};
test("historical item refund cap includes discount AND tax, not catalogue/highest price",()=>{
 const c=calculateReturnLimit(receipt);
 assert.equal(c.original_item_customer_value,57);
 assert.equal(c.unit_value_estimate,28.5);
 assert.equal(c.estimated_return_amount,28.5);
 assert.equal(c.maximum_refund,28.5);
});
test("prior item refunds reduce available value so split refunds cannot overpay",()=>{
 const c=calculateReturnLimit({...receipt,previouslyRefundedForItem:"55.00"});
 assert.equal(c.maximum_refund,2);
 assert.equal(c.remaining_item_refund_value,2);
});
test("pesewas and proportion allocation remain exact across uneven splits",()=>{
 const c=calculateReturnLimit({
  saleSubtotal:"100.00",saleDiscount:"0.01",saleTax:"0.00",
  saleTotal:"99.99",historicalItemGross:"33.33",
  soldQuantity:3,returnQuantity:1,
 });
 assert.equal(c.original_item_customer_value,33.33);
 assert.equal(c.maximum_refund,11.11);
});
test("invalid recorded amounts never get rounded silently",()=>{
 assert.throws(()=>calculateReturnLimit({...receipt,saleDiscount:"1.005"}),/2-decimal/);
 assert.throws(()=>calculateReturnLimit({...receipt,saleTotal:"105.00"}),/reconciliation/);
 assert.throws(()=>calculateReturnLimit({...receipt,returnQuantity:3}),/quantity/);
 assert.throws(()=>calculateReturnLimit({...receipt,historicalItemGross:"120.00"}),/reconciliation/);
});
test("financial refund limits are checked in the transaction with prior refunds",()=>{
 const source=file("routes/returnRoutes.js");
 assert.match(source,/calculateReturnLimit/);
 assert.match(source,/SUM\(si\.line_total\) AS historical_item_gross/);
 assert.match(source,/previously_refunded/);
 assert.match(source,/maximum_refund/);
 assert.match(source,/ORIGINAL_RECEIPT_RECONCILIATION_REQUIRED/);
 assert.match(source,/FOR UPDATE/);
 assert.match(source,/if \(cleanReturnType === "refund" &&/);
 assert.doesNotMatch(source,/const estimatedReturnAmount = Number\(saleItem\.unit_price/);
});
test("Finance portfolio derives overdue from active schedules, never stale stored caches",()=>{
 const base={id:1,total_amount:2000,outstanding_balance:1000,
   agreement_status:"active",next_schedule_due_date:"2026-11-25",
   oldest_overdue_date:"2026-11-01",overdue_amount:500,
   calculated_overdue_amount:40};
 const actual=deriveAccount(base,"2026-11-11");
 assert.equal(actual.overdue_amount,40);
 assert.equal(actual.agreement_status,"overdue");
 const capped=deriveAccount({...base,outstanding_balance:25,calculated_overdue_amount:500});
 assert.equal(capped.overdue_amount,25);
 const noOverdue=deriveAccount({...base,oldest_overdue_date:null,overdue_amount:150,calculated_overdue_amount:0});
 assert.equal(noOverdue.overdue_amount,0);
});
test("executive accounting summary uses pre-tax revenue, real cost, refunds and active expenses",()=>{
 const source=file("services/executiveIntelligenceService.js");
 assert.match(source,/total - tax_amount ELSE 0 END\),0\) AS pretax_sales/);
 assert.match(source,/COALESCE\(is_voided,0\)=0 AND COALESCE\(is_reversal,0\)=0/);
 assert.match(source,/SUM\(si\.quantity \* si\.cost_price_at_sale\)/);
 assert.match(source,/r\.return_type='refund'/);
 assert.match(source,/estimatedContribution/);
 assert.match(source,/salesInvoiceTotal > 0 \? \(payments \/ salesInvoiceTotal\)/);
 assert.match(source,/not all cash received in this reporting period/);
});
