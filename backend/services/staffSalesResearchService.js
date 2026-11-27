"use strict";
const {toPesewas}=require("./customerCreditProfileService");
const FIELDS=["invoice_total","tax","cost","outstanding","debt_collections"];
const REDUCTION_PERCENT=40;
function parseReduction(value="40"){
 if(value!=="40")throw Object.assign(Error("Staff research is fixed at 40%."),{statusCode:400});
 return REDUCTION_PERCENT;
}
function scaleMoney(n){
 if(!Number.isSafeInteger(n))throw new RangeError("Invalid research amount");
 const sign=n<0?-1:1;
 return sign*Number((BigInt(Math.abs(n))*BigInt(100-REDUCTION_PERCENT)+50n)/100n);
}
function quantity(value){
 const n=Number(value);
 if(!Number.isFinite(n)||n<0)throw new RangeError("Invalid quantity");
 return n;
}
function calculateReceipt(row){
 const actual={units:quantity(row.units),...Object.fromEntries(FIELDS.map(k=>[k,toPesewas(row[k])]))};
 const modeled={units:actual.units*(100-REDUCTION_PERCENT)/100,...Object.fromEntries(FIELDS.map(k=>[k,scaleMoney(actual[k])]))};
 for(const a of [actual,modeled])a.margin=a.invoice_total-a.tax-a.cost;
 const reduction=Object.fromEntries(Object.keys(actual).map(k=>[k,actual[k]-modeled[k]]));
 return {sale_id:String(row.id),date:String(row.sale_date),actual,modeled,reduction};
}
function summarize(receipts){
 const fields=["units",...FIELDS,"margin"];
 const result={receipts:receipts.length,actual:{},modeled:{},reduction:{}};
 for(const type of ["actual","modeled","reduction"])for(const field of fields){
   const n=receipts.reduce((sum,r)=>sum+r[type][field],0);
   if(!Number.isFinite(n)||(field!=="units"&&!Number.isSafeInteger(n)))throw new RangeError("Research total exceeds range");
   result[type][field]=n;
 }
 return result;
}
async function readSalesResearch(db,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const [rows]=await db.query(`SELECT s.id,DATE_FORMAT(s.created_at,'%Y-%m-%d') AS sale_date,
 s.total AS invoice_total,s.tax_amount AS tax,
 COALESCE(i.units,0) AS units,COALESCE(i.cost,0) AS cost,
 COALESCE(d.outstanding,0) AS outstanding,COALESCE(d.debt_collections,0) AS debt_collections
 FROM sales s LEFT JOIN (
 SELECT si.sale_id,SUM(si.quantity) AS units,SUM(si.quantity*si.cost_price_at_sale) AS cost
 FROM sale_items si JOIN sales ss ON ss.id=si.sale_id WHERE ss.branch_id=? GROUP BY si.sale_id
 ) i ON i.sale_id=s.id
 LEFT JOIN (
 SELECT d.sale_id,d.branch_id,SUM(d.balance) AS outstanding,SUM(COALESCE(p.collections,0)) AS debt_collections
 FROM debts d LEFT JOIN (SELECT debt_id,branch_id,SUM(amount) AS collections FROM debt_payments WHERE branch_id=? GROUP BY debt_id,branch_id) p ON p.debt_id=d.id AND p.branch_id=d.branch_id
 WHERE d.branch_id=? GROUP BY d.sale_id,d.branch_id
 ) d ON d.sale_id=s.id AND d.branch_id=s.branch_id
 WHERE s.branch_id=? AND s.sale_status='completed' AND s.is_voided=0
 ORDER BY s.created_at DESC,s.id DESC LIMIT 50001`,[branchId,branchId,branchId,branchId]);
 if(rows.length>50000)throw Object.assign(Error("This store exceeds the research report limit; date-range support is required."),{statusCode:422});
 const receipts=rows.map(calculateReceipt);
 const today=new Date().toISOString().slice(0,10);
 const start=new Date(today+"T00:00:00Z");start.setUTCDate(start.getUTCDate()-6);
 const week=start.toISOString().slice(0,10),month=today.slice(0,7)+"-01";
 const periods={today:summarize(receipts.filter(r=>r.date===today)),last_seven_days:summarize(receipts.filter(r=>r.date>=week&&r.date<=today)),month_to_date:summarize(receipts.filter(r=>r.date>=month&&r.date<=today)),all_time:summarize(receipts)};
 return {scenario_only:true,reduction_percent:REDUCTION_PERCENT,branch_id:branchId,as_of:new Date().toISOString(),scope:"completed_nonvoid_receipts_before_returns",periods,receipts};
}
module.exports={parseReduction,scaleMoney,calculateReceipt,summarize,readSalesResearch};
