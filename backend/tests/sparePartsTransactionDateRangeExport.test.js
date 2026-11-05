"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ExcelJS=require("../services/excelJsCompat");
const {sendAuditExport}=require("../services/sparePartsAuditExportService");

function response(){
  return {
    headers:{},code:0,body:null,
    setHeader(key,value){this.headers[key.toLowerCase()]=value},
    status(code){this.code=code;return this},
    send(body){this.body=body;return this}
  };
}
const report={
  title:"Spare Parts | Transaction History & Profit Investigation",
  description:"Recorded source transaction lines",branch:"SP01 - Main Spare Parts",
  period:"2026-10-01 to 2026-10-31",fromDate:"2026-10-01",toDate:"2026-10-31",
  filename:"chalin03-transaction-test",generatedBy:"Quality assurance",
  columns:[{key:"date",label:"Transaction Date"},{key:"item",label:"Item Name"},{key:"qty",label:"Qty"},{key:"net",label:"Net (GHS)"}],
  rows:[{date:"2026-10-04",item:"Filter",qty:2,net:450}],
  sections:[{name:"Daily Totals",columns:[{key:"date",label:"Date"},{key:"net",label:"Net (GHS)"}],rows:[{date:"2026-10-04",net:450}]}]
};
test("Transaction workbook prints From–To before filters on each worksheet",async()=>{
 const res=response();
 await sendAuditExport(res,{...report,format:"xlsx"});
 assert.equal(res.code,200);
 const wb=new ExcelJS.Workbook();
 await wb.xlsx.load(res.body);
 for(const name of ["Transaction Lines","Daily Totals"]){
  const sheet=wb.getWorksheet(name);
  assert.ok(sheet,name);
  assert.equal(sheet.getRow(2).getCell(1).value,"From Date");
  assert.equal(sheet.getRow(2).getCell(2).value,"2026-10-01");
  assert.equal(sheet.getRow(2).getCell(3).value,"To Date");
  assert.equal(sheet.getRow(2).getCell(4).value,"2026-10-31");
  assert.equal(sheet.getRow(5).getCell(1).value,name==="Transaction Lines"?"Transaction Date":"Date");
  assert.ok(sheet.autoFilter, "AutoFilter is preserved on each sheet");
 }
 const executive=wb.getWorksheet("Executive Summary");
 assert.ok(executive);
 const values=executive.getColumn(1).values;
 assert.ok(values.includes("From Date")&&values.includes("To Date"));
});
test("CSV starts with explicit transaction date range before item headers",async()=>{
 const res=response();await sendAuditExport(res,{...report,format:"csv"});
 assert.equal(res.code,200);
 assert.match(res.body,/^\uFEFF"Report","Spare Parts/);
 assert.match(res.body,/"From Date","2026-10-01"/);
 assert.match(res.body,/"To Date","2026-10-31"/);
 assert.ok(res.body.indexOf('"From Date"')<res.body.indexOf('"Transaction Date"'));
});
test("Word cover metadata names selected From and To dates",async()=>{
 const res=response();await sendAuditExport(res,{...report,format:"word"});
 assert.equal(res.code,200);
 assert.match(res.body,/<th>From Date<\/th><td>2026-10-01<\/td>/);
 assert.match(res.body,/<th>To Date<\/th><td>2026-10-31<\/td>/);
});
test("Frontend labels selected dates on the transaction report, not only in global controls",()=>{
 const ui=fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/ExportsPage.jsx"),"utf8");
 assert.match(ui,/report.key === "transaction-history"/);
 assert.match(ui,/TRANSACTION PERIOD IN DOWNLOAD/);
 assert.match(ui,/from \|\| "Earliest available"/);
 assert.match(ui,/to \|\| "Latest available"/);
 assert.match(ui,/id="ec-report-period"/);
});
