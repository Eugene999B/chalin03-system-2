"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readComparison,csv,REPORTS}=require("../services/shareholderExportComparison");
test("sales comparison is scoped, date filtered, read-only, and reconciles exactly",async()=>{
 const db={query:async(sql,p)=>{assert.match(sql,/^SELECT/);assert.match(sql,/s.is_voided=0/);assert.deepEqual(p,[2,"2026-11-01","2026-11-25"]);return [[{invoices:"22470.00",tax:"100.00",discounts:"25.00",paid:"15000.00"}]];}};
 const r=await readComparison(db,2,{report:"sales",from:"2026-11-01",to:"2026-11-25",percent:"40"});assert.equal(r.rows[0].company,1348200);for(const row of r.rows)assert.equal(row.partner+row.company,row.actual);assert.match(csv(r),/PLANNING ESTIMATE ONLY/);
});
test("debt comparison is a current snapshot; unsupported exports and invalid dates fail",async()=>{
 const db={query:async(sql,p)=>{assert.deepEqual(p,[2]);assert.doesNotMatch(sql,/DATE_ADD/);return [[{outstanding:"25000.00"}]];}};
 const r=await readComparison(db,2,{report:"debts",from:"2026-11-01",percent:"40"});assert.equal(r.rows[0].company,1500000);assert.match(r.rows[0].basis,/all dates/);
 for(const report of ["products","expenses","audit-intelligence","__proto__"])await assert.rejects(readComparison(db,2,{report}));await assert.rejects(readComparison(db,2,{report:"sales",from:"2026-02-30"}));assert.equal(Object.keys(REPORTS).length,10);
});
