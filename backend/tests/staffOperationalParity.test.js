"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=p=>fs.readFileSync(path.resolve(__dirname,"../../",p),"utf8");
test("Staff and Work share original routes and permission gates",()=>{
 const app=read("frontend/src/App.jsx");assert.doesNotMatch(app,/StaffBusinessPortal/);assert.match(app,/\["work\.chalin03\.com", "staff\.chalin03\.com"\]\.includes\(hostname\)/);assert.match(app,/<AuthProvider>/);
 for(const route of ["new-sale","debts","sales-history","exports","users-settings"])assert.ok(app.includes('path="'+route+'"'));
 assert.match(read("frontend/src/components/Layout.jsx"),/<PageAccessProtectedOutlet \/>/);
});
test("research arithmetic reconciles with actual amounts and remains labeled",async()=>{
 const m=await import("data:text/javascript;base64,"+Buffer.from(read("frontend/src/utils/staffResearch.js")).toString("base64"));
 assert.deepEqual(m.researchSplit(1500),{actual:1500,reduction:600,remaining:900});
 assert.deepEqual(m.researchSplit(15,{units:true}),{actual:15,reduction:6,remaining:9});
 assert.deepEqual(m.researchSplit(101.01),{actual:101.01,reduction:40.4,remaining:60.61});
 assert.deepEqual(m.researchSplit(-100,{profit:true}),{actual:-100,reduction:0,remaining:-100});
 assert.equal(m.receiptResearchRows([{total:10,is_voided:1},{total:20,is_voided:"0",sale_status:"completed"}]).length,1);
 assert.match(m.researchCsv(m.researchRows([{label:"Sales",value:100}]),"test"),/NOT AN INVOICE OR TAX RECORD/);
});
