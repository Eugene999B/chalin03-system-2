const test=require("node:test"),assert=require("node:assert/strict");const {summarize,readOwnershipReceiptPreview}=require("../services/ownershipReceiptPreviewService");
const line={receipt_count:1,invoice_total:"100.25",tax:"5.25",cost:"60.00",outstanding:"20.00",debt_collections:"10.00"};
test("all receipt ownership buckets reconcile without dropping unresolved amounts",()=>{const r=summarize([{...line,owner_code:"chalin03"},{...line,owner_code:"partner"},{...line,owner_code:"unresolved"}]);assert.equal(r.total.invoice_total,30075);assert.equal(r.groups.unresolved.outstanding,2000);assert.equal(r.total.receipt_count,3);assert.equal(r.financial_reporting_ready,false);assert.throws(()=>summarize([{...line,owner_code:"partner"},{...line,owner_code:"partner"}]));});
test("receipt preview stays selected-branch scoped",async()=>{const result=await readOwnershipReceiptPreview({query:async(sql,params)=>{assert.deepEqual(params,[7,7,7]);assert.match(sql,/s.is_voided=0/);return [[{...line,owner_code:"unresolved"}]];}},7);assert.equal(result.groups.unresolved.invoice_total,10025);});

test("CSV explicitly preserves unresolved receipt totals and report scope",()=>{
 const {exportReconciliationCsv}=require("../services/ownershipReceiptPreviewService");
 const report=summarize([{...line,owner_code:"chalin03"},{...line,owner_code:"unresolved"}]);
 const csv=exportReconciliationCsv(report,7);
 assert.match(csv,/before return adjustments/);
 assert.match(csv,/"Mixed or unresolved","1","100.25"/);
 assert.match(csv,/"All included receipts","2","200.50"/);
 assert.throws(()=>exportReconciliationCsv({...report,financial_reporting_ready:true},7));
});

test("fixed 40% sales planning scenario preserves actual total and rounds exactly",()=>{const {salesPlanningScenario}=require("../services/ownershipReceiptPreviewService");const s=salesPlanningScenario(10000000);assert.equal(s.assumed_partner_amount,4000000);assert.equal(s.estimated_company_amount,6000000);assert.equal(s.scenario_only,true);for(const n of [0,1,2,3,101,Number.MAX_SAFE_INTEGER]){const p=salesPlanningScenario(n);assert.equal(p.assumed_partner_amount+p.estimated_company_amount,n);}assert.throws(()=>salesPlanningScenario(-1));});
