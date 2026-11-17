"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ExcelJS=require("../services/excelJsCompat");
const {PassThrough}=require("node:stream");
const {once}=require("node:events");
const {
  reportDates,selectedBranch,buildVisualModel
}=require("../services/sparePartsBusinessIntelligenceService");
const {sendAuditExport}=require("../services/sparePartsAuditExportService");

const branch={id:1,code:"SP-T",name:"Synthetic Store"};
const period=reportDates("2026-11-01","2026-11-10");
function syntheticSource(options={}){
  const missingCost=Boolean(options.missingCost);
  return {
    branch,
    sales:[{
      sale_id:11,created_at:"2026-11-04 12:00:00",receipt_number:"TEST-RECEIPT",
      customer_name:"Synthetic Client",payment_type:"mixed",sale_status:"completed",
      is_voided:0,subtotal:200,discount_amount:20,tax_amount:10,total:190,
      amount_paid:150,balance:40,debt_payments_lifetime:50,staff_name:"Test Operator",
      source_line:55,product_id:88,product_name:"Synthetic Engine Filter",
      quantity:2,unit_price:100,line_total:200,cost_price_at_sale:missingCost?null:50,
    }],
    allocations:[{created_at:"2026-11-04",payment_channel:"cash",amount:100}],
    debtPaid:[{paid_at:"2026-11-08",payment_method:"momo",amount:50,customer_name:"Synthetic Client"}],
    refunds:[
      {id:1,returned_at:"2026-11-09",return_type:"refund",refund_amount:10,refund_method:"bank",quantity:1},
      {id:2,returned_at:"2026-11-09",return_type:"stock_only",refund_amount:0,refund_method:null,quantity:1},
    ],
    expenses:[
      {id:1,category:"Transport",amount:30,is_voided:0,is_reversal:0,expense_date:"2026-11-06"},
      {id:2,category:"Transport",amount:5,is_voided:1,is_reversal:0,expense_date:"2026-11-07"},
    ],
    openDebts:[
      {id:17,customer_id:1,customer_name:"Synthetic Client",balance:40,due_date:"2026-10-20",created_at:"2026-09-20"},
      {id:18,customer_id:2,customer_name:"Undated Client",balance:15,due_date:null,created_at:"2026-11-01"},
    ],
    products:[
      {id:88,name:"Synthetic Engine Filter",quantity:2,low_stock_threshold:5,cost_price:50},
      {id:89,name:"Synthetic Hydraulic Seal",quantity:7,low_stock_threshold:3,cost_price:10},
    ],
    previous:{value:100,receipts:1},
  };
}
test("date filters are strict, bounded and inclusive",()=>{
  assert.deepEqual(reportDates("2026-11-01","2026-11-10"),{
    from:"2026-11-01",to:"2026-11-10",days:10,
    previousFrom:"2026-10-22",previousTo:"2026-10-31"
  });
  assert.throws(()=>reportDates("2026-11-31","2026-12-01"),/valid From and To/);
  assert.throws(()=>reportDates("2026-11-15","2026-11-01"),/valid From and To/);
  assert.throws(()=>reportDates("2025-01-01","2026-11-01"),/366 days/);
  assert.throws(()=>selectedBranch({role:"admin"}),/authorised Spare Parts store/);
  assert.equal(selectedBranch({branch_id:9}),9);
});
test("receipts, tax, original tenders, later collections and stock-only returns never conflate",()=>{
  const r=buildVisualModel(syntheticSource(),period,"2026-11-17T07:00:00Z");
  assert.equal(r.summary.invoiceTotal,190);
  assert.equal(r.summary.pretax,180);
  assert.equal(r.summary.collectedAtSale,100);
  assert.equal(r.summary.debtCollected,50);
  assert.equal(r.summary.refundTotal,10);
  assert.equal(r.summary.collectedNet,140);
  assert.equal(r.summary.openDebtTotal,55);
  assert.equal(r.summary.overdueTotal,40);
  assert.equal(r.summary.expenseTotal,30);
  assert.equal(r.summary.margin,80);
  assert.equal(r.summary.lowStock,1);
  assert.equal(r.originalEvents.returns,2);
  assert.equal(r.sections.find(s=>s.name==="Daily Sales and Cash").rows
    .reduce((a,x)=>a+x.refunds,0),10);
  assert.ok(r.sections.find(s=>s.name==="Debt Aging").rows.some(x=>x.bucket==="No due date"&&x.balance===15));
  assert.ok(r.narrative.some(x=>x.explanation.includes("not the same as money actually collected")));
});
test("missing historical item costs prevent a misleading profit declaration",()=>{
  const r=buildVisualModel(syntheticSource({missingCost:true}),period,"2026-11-17T07:00:00Z");
  assert.equal(r.summary.margin,null);
  assert.equal(r.summary.missingHistoricalCosts,1);
  assert.ok(r.metrics.some(([title,val])=>title.includes("gross margin")&&String(val).includes("Withheld")));
  assert.ok(r.sections.find(s=>s.name==="Actions and Warnings").rows
    .some(x=>x.area==="Margin quality"&&x.priority==="HIGH"));
});
function writableResponse(){
  const chunks=[];
  const res=new PassThrough();
  res.headers={};
  res.statusCode=200;
  res.on("data",chunk=>chunks.push(Buffer.from(chunk)));
  res.setHeader=(key,value)=>{res.headers[key.toLowerCase()]=value};
  res.status=code=>{res.statusCode=code;return res};
  res.send=value=>{res.end(value);return res};
  return {res,chunks};
}
function config(format){
  const r=buildVisualModel(syntheticSource(),period,"2026-11-17T07:00:00Z");
  return {
    format, title:"CHALIN03 Synthetic Spare Parts Intelligence",
    description:"TEST DATA ONLY — NOT REAL FINANCIAL RECORDS",
    period:"2026-11-01 to 2026-11-10",fromDate:"2026-11-01",toDate:"2026-11-10",
    branch:"SP-T — Synthetic Store",generatedBy:"Test Operator",
    filename:"synthetic-report",rows:r.narrative,
    primarySectionName:"Business Narrative",
    columns:[{key:"topic",label:"Topic"},{key:"explanation",label:"Interpretation"}],
    metrics:r.metrics,sections:r.sections,
    charts:r.charts,dashboardCards:r.cards,
  };
}
test("Excel exports visual worksheet, actual financial numbers and evidence metadata",async()=>{
  const {res,chunks}=writableResponse();
  await sendAuditExport(res,config("xlsx"));
  if(!res.writableEnded)res.end();
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks));
  assert.ok(wb.getWorksheet("Executive Summary"));
  const visual=wb.getWorksheet("Visual Analysis");
  assert.ok(visual,"Charts worksheet");
  assert.ok(wb.getWorksheet("Debt Aging"));
  assert.ok(wb.getWorksheet("Daily Sales and Cash"));
  assert.match(String(visual.getCell("A1").value),/VISUALISATION/);
  const cells=[];
  visual.eachRow(row=>row.eachCell(cell=>cells.push(cell.value)));
  assert.ok(cells.includes("Daily completed invoice value"));
  assert.ok(cells.includes(190));
  assert.match(String(wb.getWorksheet("Executive Summary").getCell("A1").value),/EXECUTIVE REPORT/);
});
test("Word file includes editable chart bars, source basis and audit limitations",async()=>{
  const {res,chunks}=writableResponse();
  await sendAuditExport(res,config("doc"));
  const data=Buffer.concat(chunks).toString("utf8");
  assert.match(data,/Charts and visual analysis/);
  assert.match(data,/background:#087f75/);
  assert.match(data,/Accounting.*?Limitations|Calculation Notes/);
  assert.match(data,/Debt Aging/);
  assert.equal(res.headers["content-type"].startsWith("application/msword"),true);
});
test("PDF export draws charts rather than only plain numbers",async()=>{
  const {res,chunks}=writableResponse();
  const finished=once(res,"finish");
  await sendAuditExport(res,config("pdf"));
  await finished;
  const buffer=Buffer.concat(chunks);
  assert.equal(buffer.subarray(0,4).toString(),"%PDF");
  assert.ok(buffer.length>8000);
  assert.equal(res.headers["content-type"],"application/pdf");
});
test("source reads are scoped to one selected store and a read-only snapshot",async()=>{
  const Module=require("node:module");
  const absolute=path.resolve(__dirname,"../services/sparePartsBusinessIntelligenceService.js");
  const original=Module._load;
  const statements=[],state={commits:0,rollbacks:0,releases:0};
  const connection={
    query:async(sql,params=[])=>{
      statements.push({sql:String(sql),params});
      if(/FROM branches WHERE/.test(sql))
        return [[{id:7,name:"Synthetic Store",code:"T-7"}]];
      if(/SELECT COUNT\(\*\) AS receipts/.test(sql))
        return [[{receipts:0,value:0}]];
      return [[]];
    },
    commit:async()=>{state.commits++},
    rollback:async()=>{state.rollbacks++},
    release:()=>{state.releases++},
  };
  let service;
  try{
    Module._load=function(request,parent,isMain){
      if(parent?.filename===absolute && request==="../config/db")
        return {pool:{getConnection:async()=>connection}};
      return original.apply(this,arguments);
    };
    delete require.cache[absolute];
    service=require(absolute);
  }finally{
    Module._load=original;
    delete require.cache[absolute];
  }
  const result=await service.loadEvidence(7,period);
  assert.equal(result.branch.code,"T-7");
  assert.equal(state.commits,1);
  assert.equal(state.rollbacks,0);
  assert.equal(state.releases,1);
  assert.ok(statements.some(x=>x.sql==="START TRANSACTION READ ONLY"));
  const reads=statements.filter(x=>x.sql.trim().startsWith("SELECT"));
  assert.ok(reads.length>=8);
  assert.ok(reads.every(x=>x.params[0]===7),"Every query must use the selected store ID");
  assert.ok(statements.every(x=>!/^(UPDATE|DELETE|INSERT|ALTER|DROP)/.test(x.sql.trim())));
});

test("source route explicitly protects store and management access",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../routes/sparePartsTransactionExportRoutes.js"),"utf8");
  assert.match(source,/business-intelligence/);
  assert.match(source,/collections-intelligence/);
  assert.match(source,/audit-intelligence/);
  assert.match(source,/stock-intelligence/);
  assert.match(source,/requireRole\("admin","manager","auditor"\)/);
  assert.match(source,/buildBusinessIntelligence\(req\)/);
});
