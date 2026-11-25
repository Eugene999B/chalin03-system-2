"use strict";
// Preview only: completed, nonvoid receipts, before return adjustments.
// Mixed or unverified receipts stay in an explicit unresolved bucket.
// Never substitute this for statutory accounts or a net profit statement.
const {toPesewas}=require("./customerCreditProfileService");
const FIELDS=["invoice_total","tax","cost","outstanding","debt_collections"];
const BUCKETS=["chalin03","partner","unresolved"];
function blank(){return {receipt_count:0,...Object.fromEntries(FIELDS.map(k=>[k,0]))};}
function addSafe(a,b){const n=a+b;if(!Number.isSafeInteger(n))throw new RangeError("Report total out of range");return n;}
function summarize(rows){
 const groups=Object.fromEntries(BUCKETS.map(b=>[b,blank()]));
 const seen=new Set();
 for(const row of rows){
   if(!BUCKETS.includes(row.owner_code)||seen.has(row.owner_code))throw new Error("Invalid reporting bucket");
   seen.add(row.owner_code);
   const n=Number(row.receipt_count);
   if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid receipt count");
   const g=groups[row.owner_code];g.receipt_count=n;
   for(const k of FIELDS)g[k]=toPesewas(row[k]);
 }
 const total=blank();
 for(const g of Object.values(groups)){for(const k of Object.keys(total))total[k]=addSafe(total[k],g[k]);}
 return {groups,total,scope:"completed_nonvoid_receipts_before_return_adjustments",financial_reporting_ready:false};
}
async function readOwnershipReceiptPreview(db,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const [rows]=await db.query(
 `SELECT owner_code,COUNT(*) AS receipt_count,COALESCE(SUM(invoice_total),0) AS invoice_total,
 COALESCE(SUM(tax),0) AS tax,COALESCE(SUM(cost),0) AS cost,
 COALESCE(SUM(outstanding),0) AS outstanding,COALESCE(SUM(debt_collections),0) AS debt_collections
 FROM (
 SELECT s.id,
 CASE WHEN COUNT(si.id)>0 AND SUM(CASE WHEN si.id IS NOT NULL AND o.owner_code='chalin03' AND o.classified_by IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(o.evidence_reference,'')))>0 THEN 1 ELSE 0 END)=COUNT(si.id) THEN 'chalin03'
 WHEN COUNT(si.id)>0 AND SUM(CASE WHEN si.id IS NOT NULL AND o.owner_code='partner' AND o.classified_by IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(o.evidence_reference,'')))>0 THEN 1 ELSE 0 END)=COUNT(si.id) THEN 'partner'
 ELSE 'unresolved' END AS owner_code,
 s.total AS invoice_total,s.tax_amount AS tax,COALESCE(SUM(si.quantity*si.cost_price_at_sale),0) AS cost,
 COALESCE(d.outstanding,0) AS outstanding,COALESCE(d.debt_collections,0) AS debt_collections
 FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id
 LEFT JOIN sale_item_ownership_classifications o ON o.sale_item_id=si.id
 LEFT JOIN (
   SELECT d.sale_id,d.branch_id,SUM(d.balance) AS outstanding,SUM(COALESCE(p.collections,0)) AS debt_collections
   FROM debts d LEFT JOIN (SELECT debt_id,branch_id,SUM(amount) AS collections FROM debt_payments WHERE branch_id=? GROUP BY debt_id,branch_id) p ON p.debt_id=d.id AND p.branch_id=d.branch_id
   WHERE d.branch_id=? GROUP BY d.sale_id,d.branch_id
 ) d ON d.sale_id=s.id AND d.branch_id=s.branch_id
 WHERE s.branch_id=? AND s.sale_status='completed' AND s.is_voided=0
 GROUP BY s.id,s.total,s.tax_amount,d.outstanding,d.debt_collections
 ) receipts GROUP BY owner_code`,[branchId,branchId,branchId]);
 return summarize(rows);
}
// CSV is an explicitly scoped reconciliation artifact, not a replacement ledger.
function exportReconciliationCsv(report,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0||report.scope!=="completed_nonvoid_receipts_before_return_adjustments"||report.financial_reporting_ready!==false)throw new Error("Invalid reconciliation export scope");
 const lines=[
 ["Report","Receipt ownership reconciliation preview"],
 ["Scope","Completed non-void receipts in selected store before return adjustments"],
 ["Store ID",branchId],
 ["Currency","GHS"],
 ["Financial statement","No - mixed and unverified receipts remain unresolved"],
 ["Collections","Recorded debt payments only"],
 ["Ownership","Receipt count","Invoice total","Tax","Recorded cost","Outstanding","Debt collections"]
 ];
 for(const [label,row] of [["CHALIN03",report.groups.chalin03],["Business partner",report.groups.partner],["Mixed or unresolved",report.groups.unresolved],["All included receipts",report.total]]){
   lines.push([label,row.receipt_count,...FIELDS.map(k=>{const n=row[k];if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid report amount");return (n/100).toFixed(2);})]);
 }
 return lines.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";
}
// Adjustable management planning assumption, never a transaction adjustment.
// Integer pesewas and complementary amounts reconcile exactly.
function salesPlanningScenario(invoiceTotal,percent=40){
 if(!Number.isInteger(percent)||percent<0||percent>100)throw new RangeError('Invalid planning percentage');
 if(!Number.isSafeInteger(invoiceTotal)||invoiceTotal<0)throw new RangeError("Invalid invoice total");
 const assumedPartner=Number((BigInt(invoiceTotal)*BigInt(percent)+50n)/100n);
 return {actual_invoice_total:invoiceTotal,assumed_partner_percent:percent,assumed_partner_amount:assumedPartner,estimated_company_amount:invoiceTotal-assumedPartner,scenario_only:true,scope:"completed_nonvoid_receipts_before_return_adjustments"};
}
module.exports={summarize,readOwnershipReceiptPreview,exportReconciliationCsv,salesPlanningScenario};
