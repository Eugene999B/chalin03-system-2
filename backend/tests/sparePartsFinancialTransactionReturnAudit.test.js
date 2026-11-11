"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {Writable}=require("node:stream");
const ExcelJS=require("../services/excelJsCompat");
const {sendAuditExport}=require("../services/sparePartsAuditExportService");
const {allocate,buildSales,buildReturns,groupRows,summaryOf}=require("../services/sparePartsFinancialAuditMath");
const root=path.join(__dirname,"..");
const file=p=>fs.readFileSync(path.join(root,p),"utf8");
const sale=(overrides={})=>({
 sale_id:101,created_at:"2026-11-11T08:00:00Z",receipt_number:"SP-101",
 customer_name:"Test Customer",payment_type:"mixed",sale_status:"completed",
 is_voided:0,subtotal:100,discount_amount:0.01,tax_amount:0.01,
 total:100,amount_paid:45,balance:55,staff_name:"Quality Tester",
 source_line:1,product_id:4,product_name:"Oil Filter",quantity:1,
 unit_price:33.33,line_total:33.33,cost_price_at_sale:20,
 ...overrides
});
const ret=(overrides={})=>({
 return_id:9,returned_at:"2026-11-11T09:00:00Z",branch_id:1,
 sale_id:101,product_id:4,quantity:2,reason:"Customer brought item back",
 return_type:"refund",refund_amount:15,refund_method:"cash",
 refund_reference:"",receipt_number:"SP-101",
 sale_created_at:"2026-10-02T08:00:00Z",sale_status:"completed",is_voided:0,
 customer_name:"Test Customer",sold_quantity:4,
 historical_sale_cost:60,historical_sale_gross:120,
 historical_product_name:"Oil Filter",returned_by_name:"Manager",approved_by_name:"Owner",
 ...overrides
});
test("Pesewa allocations cannot create phantom discount/tax differences",()=>{
 assert.deepEqual(allocate(1,[1,1,1]),[1,0,0]);
 assert.deepEqual(allocate(1,[3333,6667]),[0,1]);
 assert.deepEqual(allocate(101,[1,1,1]),[34,34,33]);
 assert.equal(allocate(101,[1,1,1]).reduce((a,b)=>a+b,0),101);
});
test("Each historical receipt line reconciles exactly to source tax and discount",()=>{
 const data=buildSales([
  sale(),
  sale({source_line:2,product_id:5,product_name:"Hydraulic Hose",line_total:66.67,unit_price:66.67,
    cost_price_at_sale:40})
 ]);
 assert.equal(data.lines.length,2);
 assert.equal(data.lines.reduce((s,x)=>s+x.discount,0),0.01);
 assert.equal(data.lines.reduce((s,x)=>s+x.tax,0),0.01);
 assert.equal(data.lines.reduce((s,x)=>s+x.receipt_amount,0),100);
 assert.equal(data.receipts[0].total_difference,0);
 assert.equal(data.receipts[0].subtotal_difference,0);
 assert.equal(data.receipts[0].review_status,"Reconciled");
});
test("Different recorded header totals remain an audit exception, never silently made to match",()=>{
 const data=buildSales([
  sale({total:99.99}),
  sale({total:99.99,source_line:2,product_id:5,product_name:"Hydraulic Hose",
    line_total:66.67,unit_price:66.67,cost_price_at_sale:40})
 ]);
 assert.equal(data.receipts[0].total_difference,0.01);
 assert.match(data.receipts[0].review_status,/Receipt header fails/);
 assert.ok(data.exceptions.some(x=>x.type==="Sale"));
});
test("Canceled or voided sales are excluded from realised sales and payment maths",()=>{
 const data=buildSales([
  sale({sale_id:1,receipt_number:"SP-001",subtotal:33.33,discount_amount:0,tax_amount:0,total:33.33}),
  sale({sale_id:2,receipt_number:"SP-002",sale_status:"cancelled",subtotal:99,discount_amount:0,tax_amount:0,total:99,source_line:2})
 ]);
 assert.equal(data.receipts.filter(x=>x.active).length,1);
 assert.equal(data.lines.find(x=>x.sale_id===2).net,0);
 assert.ok(data.exceptions.some(x=>/Excluded/.test(x.issue)));
});
test("A stock-only return is never cash paid out or a financial refund",()=>{
 const one=buildReturns([ret({return_type:"stock_only",refund_amount:0,refund_method:"none"})]);
 assert.equal(one.lines[0].cash_involved,"NO");
 assert.equal(one.lines[0].refund_amount,0);
 assert.equal(one.lines[0].cash_movement,"No money paid out");
 assert.equal(one.lines[0].recovered_stock_cost_estimate,30);
});
test("Real cash, MoMo, Bank and Other refunds reconcile by payment channel",()=>{
 const returns=buildReturns([
  ret({return_id:1,refund_amount:5,refund_method:"cash"}),
  ret({return_id:2,refund_amount:7,refund_method:"momo"}),
  ret({return_id:3,refund_amount:11,refund_method:"bank"}),
  ret({return_id:4,refund_amount:13,refund_method:"other"}),
  ret({return_id:5,return_type:"stock_only",refund_amount:0,refund_method:"none"})
 ]);
 const empty=buildSales([]);
 const result=summaryOf(empty,returns,[],[],[]);
 assert.equal(result.summary.return_count,5);
 assert.equal(result.summary.financial_return_count,4);
 assert.equal(result.summary.stock_only_return_count,1);
 assert.equal(result.summary.total_refunded,36);
 assert.equal(result.summary.cash_refunded,5);
 assert.equal(result.summary.momo_refunded,7);
 assert.equal(result.summary.bank_refunded,11);
 assert.equal(result.summary.other_refunded,13);
 assert.equal(result.summary.recovered_refund_stock_cost_estimate,120);
 assert.equal(returns.lines[0].original_sale_date,"2026-10-02");
 assert.equal(returns.lines[0].date,"2026-11-11");
});
test("Historical return cost uses original quantity-weighted cost, not MAX unit price",()=>{
 const one=buildReturns([ret({quantity:2,sold_quantity:4,historical_sale_cost:100})]);
 assert.equal(one.lines[0].historical_unit_cost_estimate,25);
 assert.equal(one.lines[0].recovered_stock_cost_estimate,50);
});
test("Refund review shows historical discount-and-tax-adjusted item value",()=>{
 const refund=buildReturns([ret({
   quantity:1,sold_quantity:2,historical_sale_gross:100,
   sale_subtotal:100,sale_discount:20,sale_tax:8,refund_amount:50
 })]);
 const line=refund.lines[0];
 assert.equal(line.original_item_gross_estimate,50);
 assert.equal(line.estimated_net_refundable,44);
 assert.equal(line.refund_vs_estimated_value,6);
 assert.match(line.review_status,/exceeds pro-rata historical item amount/);
});

test("Source-of-truth cash receipts include debt collections separately; lifetime sale paid is not re-counted",()=>{
 const sales=buildSales([sale({subtotal:33.33,discount_amount:0,tax_amount:0,total:33.33,amount_paid:33.33,balance:0,debt_payments_lifetime:20})]);
 const returned=buildReturns([ret({return_type:"stock_only",refund_amount:0,refund_method:"none"})]);
 const summary=summaryOf(sales,returned,[{sale_id:101,payment:"cash",amount:13.33}],
   [{date:"2026-11-11",payment:"bank",amount:20}],
   [{id:1,amount:5,is_voided:0,is_reversal:0},{id:2,amount:7,is_voided:1,is_reversal:0},
    {id:3,amount:-7,is_voided:0,is_reversal:1}]).summary;
 assert.equal(summary.original_sale_collections_in_period,13.33);
 assert.equal(summary.debt_collections_in_period,20);
 assert.equal(summary.customer_money_in_less_refunds,33.33);
 assert.equal(summary.active_operating_expenses,5);
});
test("Legacy paid receipts without original payment channel evidence are highlighted, not assumed cash",()=>{
 const sales=buildSales([sale({
   subtotal:33.33,discount_amount:0,tax_amount:0,total:33.33,amount_paid:33.33,balance:0
 })]);
 const result=summaryOf(sales,buildReturns([]),[],[],[]);
 assert.equal(result.summary.receipts_missing_original_payment_allocations,1);
 assert.equal(result.summary.lifetime_paid_on_unallocated_receipts,33.33);
 assert.equal(result.summary.original_sale_collections_in_period,0);
 assert.equal(result.summary.receipts_with_unknown_initial_channel,1);
 assert.equal(result.summary.unknown_original_channel_amount,33.33);
 assert.ok(result.financialExceptions.some(x=>/UNKNOWN channel/.test(x.issue)));
});

test("Fully credit sale later paid has no missing original tender or false cash exception",()=>{
 const saleEvidence=buildSales([sale({
   subtotal:33.33,discount_amount:0,tax_amount:0,total:33.33,amount_paid:33.33,
   debt_payments_lifetime:33.33,balance:0
 })]);
 assert.equal(saleEvidence.receipts[0].initial_paid_reconstructed,0);
 const outcome=summaryOf(saleEvidence,buildReturns([]),[],[{amount:33.33}],[]);
 assert.equal(outcome.summary.receipts_missing_original_payment_allocations,1);
 assert.equal(outcome.summary.receipts_with_unknown_initial_channel,0);
 assert.equal(outcome.summary.customer_money_in_less_refunds,33.33);
 assert.equal(outcome.financialExceptions.length,0);
});
test("Report service uses quantity-weighted historical cost and excludes voided/reversal expenses",()=>{
 const report=file("routes/reportRoutes.js");
 assert.match(report,/SUM\(si\.cost_price_at_sale \* si\.quantity\) \/ NULLIF\(SUM\(si\.quantity\), 0\)/);
 assert.doesNotMatch(report,/SELECT MAX\(si\.cost_price_at_sale\)/);
 assert.match(report,/COALESCE\(e\.is_voided, 0\) = 0/);
 assert.match(report,/COALESCE\(e\.is_reversal, 0\) = 0/);
 assert.match(report,/THEN si\.line_total \* \(s\.subtotal - s\.discount_amount\) \/ s\.subtotal/);
});
test("Daily closing gross before discount excludes recorded tax",()=>{
 const source=file("routes/dailyClosingRoutes.js");
 assert.match(source,/const grossBeforeDiscount = toMoney\(sale\.subtotal\)/);
 assert.match(source,/const grossBeforeDiscount = salesSubtotal/);
 assert.doesNotMatch(source,/salesTotal \+ discountTotal/);
});
test("Transaction report selects original sale price and independent dated return, debt and expense evidence",()=>{
 const source=file("routes/sparePartsTransactionExportRoutes.js");
 for(const expected of [
  /si\.cost_price_at_sale/,/si\.id AS source_line/,/s\.branch_id = \?/,
  /dateFilter\("r","returned_at"/,/LEFT JOIN sales s ON s\.id=r\.sale_id/,
  /GROUP BY si\.sale_id,si\.product_id/,/dateFilter\("dp","paid_at"/,
  /sale_payment_allocations/,/debt_paid_lifetime/,/expense_date >= \?/,/START TRANSACTION READ ONLY/,
  /Returns Detail/,/Refund Channels/,/Debt Collections/,/Receipt Reconciliation/,
  /Review Exceptions/,/LIMIT 20001/
 ])assert.match(source,expected);
});
function mockRes(){
 return {code:0,body:null,headers:{},
 setHeader(k,v){this.headers[k.toLowerCase()]=v},
 status(code){this.code=code;return this},
 send(body){this.body=body;return this}};
}
const fixture={
 format:"xlsx",title:"Financial Reconciliation",
 description:"Synthetic evidence",branch:"SP1",period:"2026-11-01 to 2026-11-11",
 fromDate:"2026-11-01",toDate:"2026-11-11",filename:"test-returns",
 columns:[{key:"receipt",label:"Receipt"},{key:"net",label:"Net"}],
 rows:[{receipt:"ABC",net:24}],
 metrics:[["Total cash refunded",7]],
 sections:[
  {name:"Returns Detail",columns:[{key:"item",label:"Item"},{key:"refund_amount",label:"Refunded"}],
   rows:[{item:"Filter",refund_amount:7}]},
  {name:"Refund Channels",columns:[{key:"name",label:"Channel"},{key:"amount",label:"Amount"}],
   rows:[{name:"cash",amount:7}]}
 ]
};
test("Excel includes independent Returns Detail and Refund Channels sheets",async()=>{
 const res=mockRes();await sendAuditExport(res,fixture);
 assert.equal(res.code,200);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(res.body);
 assert.equal(wb.getWorksheet("Returns Detail").getRow(6).getCell(1).value,"Filter");
 assert.equal(wb.getWorksheet("Refund Channels").getRow(6).getCell(1).value,"cash");
 assert.equal(wb.getWorksheet("Returns Detail").getRow(2).getCell(2).value,"2026-11-01");
});
test("CSV includes returns, cash refunds and date range, rather than only sales",async()=>{
 const res=mockRes();await sendAuditExport(res,{...fixture,format:"csv"});
 assert.equal(res.code,200);
 assert.match(res.body,/"From Date","2026-11-01"/);
 assert.match(res.body,/"SECTION: Returns Detail"/);
 assert.match(res.body,/"Filter","7"/);
 assert.match(res.body,/"SECTION: Refund Channels"/);
 assert.match(res.body,/"cash","7"/);
});
test("Word includes return detail and refund channel sections",async()=>{
 const res=mockRes();await sendAuditExport(res,{...fixture,format:"word"});
 assert.equal(res.code,200);
 assert.match(res.body,/Returns Detail \(1 records\)/);
 assert.match(res.body,/Refund Channels \(1 records\)/);
 assert.match(res.body,/Total cash refunded/);
});
test("CSV cell output cannot execute spreadsheet formula injection",async()=>{
 const res=mockRes();await sendAuditExport(res,{
  ...fixture,format:"csv",sections:[],rows:[{receipt:"=SUM(1,1)",net:24}]
 });
 assert.match(res.body,/"'=SUM\(1,1\)"/);
});
