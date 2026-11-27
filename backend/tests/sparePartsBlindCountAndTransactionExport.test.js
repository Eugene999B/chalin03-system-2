"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {analyzeLine,analyzeLines,validInt}=require("../services/sparePartsBlindCountAnalysis");
const file=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const sample={product_id:41,product_name:"Excavator Filter",expected_qty:10,counted_qty:7,unit_cost:250,unit_price:320,system_qty_at_submit:10,remarks:"Shelf A"};
test("Blind count identifies missing units and values exposure at snapshot cost",()=>{
 const x=analyzeLine(sample);
 assert.equal(x.variance,-3);assert.equal(x.shortage_qty,3);
 assert.equal(x.excess_qty,0);assert.equal(x.shortage_cost,750);
 assert.equal(x.shortage_retail,960);assert.equal(x.risk,"Review");
});
test("Blind count flags operational movement as evidence, not proof of theft",()=>{
 const x=analyzeLine({...sample,system_qty_at_submit:14});
 assert.equal(x.stock_movement_during_count,4);assert.equal(x.movement_flag,true);
 assert.equal(x.risk,"Reconcile movements");assert.match(x.notes,/not proof of theft/);
});
test("Overages, balanced items and zero expected are handled correctly",()=>{
 const p=analyzeLines([sample,{...sample,product_id:2,expected_qty:0,counted_qty:3},{...sample,product_id:3,expected_qty:5,counted_qty:5}]);
 assert.equal(p.summary.products,3);assert.equal(p.summary.discrepancies,2);
 assert.equal(p.summary.shortage_units,3);assert.equal(p.summary.excess_units,3);
 assert.equal(p.summary.balanced,1);
});
test("Unentered quantity stays Not Counted and cannot create a phantom shortage",()=>{
 const x=analyzeLine({...sample,counted_qty:null});
 assert.equal(x.counted,false);
 assert.equal(x.status,"Not Counted");
 assert.equal(x.actual,null);
 assert.equal(x.variance,null);
 assert.equal(x.shortage_qty,null);
 assert.equal(x.shortage_cost,null);
 assert.equal(x.risk,"Not Counted");
});
test("Blank and explicit zero are financially different evidence",()=>{
 const countedZero=analyzeLine({...sample,counted_qty:0});
 const blank=analyzeLine({...sample,counted_qty:null});
 assert.equal(countedZero.status,"Shortage");
 assert.equal(countedZero.shortage_qty,10);
 assert.equal(countedZero.shortage_cost,2500);
 assert.equal(blank.status,"Not Counted");
 assert.equal(blank.shortage_qty,null);
});
test("Only entered counts contribute to shortages, overages and matching",()=>{
 const result=analyzeLines([
  {...sample,product_id:1,counted_qty:null},
  {...sample,product_id:2,counted_qty:7},
  {...sample,product_id:3,counted_qty:10},
  {...sample,product_id:4,counted_qty:12}
 ]);
 assert.equal(result.summary.products,4);
 assert.equal(result.summary.counted,3);
 assert.equal(result.summary.uncounted,1);
 assert.equal(result.summary.balanced,1);
 assert.equal(result.summary.discrepancies,2);
 assert.equal(result.summary.shortage_units,3);
 assert.equal(result.summary.excess_units,2);
 assert.equal(result.summary.shortage_cost,750);
 assert.equal(result.summary.excess_cost,500);
});
test("Count entry and submission routes accept blank quantities without user notes",()=>{
 const route=file("routes/sparePartsBlindCountRoutes.js");
 const analysis=file("services/sparePartsBlindCountAnalysis.js");
 const page=fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/SparePartsBlindCountPage.jsx"),"utf8");
 assert.match(route,/counted_qty===null\|\|validInt/);
 assert.doesNotMatch(route,/products have not been counted/);
 assert.match(route,/counted_qty=\?,counted_by=\?,counted_at=NOW\(\)/);
 assert.doesNotMatch(route,/text\(row\.remarks/);
 assert.match(analysis,/\{name:"Not Counted"/);
 assert.match(analysis,/\{key:"status",label:"Count Status"/);
 assert.doesNotMatch(analysis,/label:"Count Notes"/);
 assert.doesNotMatch(analysis,/label:"Counted By"/);
 assert.match(page,/Finish Count & View Results/);
 assert.doesNotMatch(page,/Count notes|type="text" maxLength=\{600\}/);
});
test("Quantities reject fractions, negatives and empty values",()=>{
 assert.equal(validInt(0),true);assert.equal(validInt("12"),true);
 assert.equal(validInt(-1),false);assert.equal(validInt(""),false);
 assert.equal(validInt(1.5),false);assert.equal(validInt(null),false);
});
test("Draft responses strip expected system quantities",()=>{
 const source=file("routes/sparePartsBlindCountRoutes.js");
 assert.match(source,/if\(!reveal\)return common/);
 assert.match(source,/if\(s.status==="draft"\)return res.status\(409\)/);
 assert.match(source,/status!=="draft"/);
 assert.match(source,/WHERE c.id=\? AND c.branch_id=\?/);
 assert.match(source,/No product stock was changed|Inventory quantities remain unchanged|No inventory was changed/);
 assert.match(source,/s.created_by\)===actor\(req\)/);
});
test("Historical transaction export uses recorded source-line prices and branch scoped dates",()=>{
 const source=file("routes/sparePartsTransactionExportRoutes.js");
 assert.match(source,/si.cost_price_at_sale/);
 assert.match(source,/si.id AS source_line/);
 assert.match(source,/s.branch_id = \?/);
 assert.match(source,/dateFilter\("s","created_at",from,to,salesParams\)/);
 assert.match(source,/EXCEPTIONS|Review Exceptions/);
 assert.match(source,/LIMIT 20001/);
});
test("Spare Parts auditor permissions cannot grant user security or backup restore",()=>{
 const middleware=file("middleware/roleMiddleware.js");
 const start=middleware.indexOf("AUDITOR_SPARE_PARTS_OPERATION_PREFIXES");
 const end=middleware.indexOf("function canAuditorOperateSpareParts",start);
 const snippet=middleware.slice(start,end);
 assert.match(snippet,/\/api\/products/);
 assert.doesNotMatch(snippet,/\/api\/users|\/api\/backups|\/api\/maintenance|\/api\/audit-unlock-requests/);
 assert.match(middleware,/!req.sparePartsBranch/);
});
