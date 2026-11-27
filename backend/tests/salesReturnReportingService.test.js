"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {receiptWithReturns,periodNet,dashboardNetFromDays}=require("../services/salesReturnReportingService");
const sale={id:1,total:100,total_items_sold:4,total_items_value:100,sale_status:"completed"};
const ret={sale_id:1,product_id:1,returned_quantity:2,sold_quantity:4,item_gross:100,subtotal:100,total:100,recorded_refunds:50,stock_only_quantity:0};
test("partial refund leaves original invoice intact and reverses sold units",()=>{const r=receiptWithReturns(sale,[ret]);assert.equal(r.total,100);assert.equal(r.net_items_sold,2);assert.equal(r.net_sales_after_refunds,50);assert.equal(r.net_merchandise_sales,50);});
test("full refund and return net to zero",()=>{const r=receiptWithReturns(sale,[{...ret,returned_quantity:4,recorded_refunds:100}]);assert.equal(r.net_items_sold,0);assert.equal(r.net_sales_after_refunds,0);assert.equal(r.net_merchandise_sales,0);});
test("stock-only return does not fabricate refund or credit",()=>{const r=receiptWithReturns(sale,[{...ret,recorded_refunds:0,stock_only_quantity:2}]);assert.equal(r.net_items_sold,2);assert.equal(r.net_merchandise_sales,50);assert.equal(r.net_sales_after_refunds,100);});
test("prior-sale refund is recognized on the return reporting date",()=>{const r=periodNet(0,[ret]);assert.equal(r.net_sales_after_refunds,-50);assert.equal(r.net_merchandise_sales,-50);});
test("unvalued return flags missing historical evidence",()=>{const r=receiptWithReturns(sale,[{...ret,sold_quantity:null}]);assert.equal(r.net_merchandise_sales,null);assert.equal(r.net_sales_after_refunds,50);});

test("dashboard attributes refunds to actual return dates and permits negative daily sales",()=>{const out=dashboardNetFromDays([{day:"2026-11-01",gross:100,refunds:0},{day:"2026-11-27",gross:0,refunds:40}],new Date("2026-11-27T12:00:00Z"));assert.equal(out.today,-40);assert.equal(out.week,-40);assert.equal(out.month,60);assert.equal(out.all,60);});
