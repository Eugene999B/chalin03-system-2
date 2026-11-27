"use strict";
// Financial refunds, returned merchandise and original invoices are distinct.
const money=n=>Math.round((Number(n)||0)*100)/100;
const activeSale=s=>Number(s.is_voided||0)!==1&&!["cancelled","voided","canceled"].includes(String(s.sale_status||"").toLowerCase());
function summarizeReturnRows(rows,productFilter=null){
 const result={returned_quantity:0,returned_item_gross:0,estimated_return_value:0,recorded_refunds:0,stock_only_quantity:0,unvalued_return_count:0,matched_returned_quantity:0,matched_returned_gross:0};
 for(const r of rows){
  const q=Number(r.returned_quantity),sold=Number(r.sold_quantity),gross=Number(r.item_gross),subtotal=Number(r.subtotal),total=Number(r.total);
  if(!Number.isSafeInteger(q)||q<=0)throw Error("Invalid recorded return quantity");
  result.returned_quantity+=q;result.recorded_refunds+=Number(r.recorded_refunds||0);result.stock_only_quantity+=Number(r.stock_only_quantity||0);
  const valid=Number.isSafeInteger(sold)&&sold>=q&&r.item_gross!=null&&Number.isFinite(gross)&&gross>=0&&subtotal>0&&Number.isFinite(total)&&total>=0;
  const returnedGross=valid?gross*q/sold:0;
  if(valid){result.returned_item_gross+=returnedGross;result.estimated_return_value+=returnedGross*total/subtotal;}else result.unvalued_return_count++;
  if(productFilter?.active&&((Number(r.product_id)===Number(productFilter.productId))||(productFilter.text&&String(r.product_name||"").toLowerCase().includes(String(productFilter.text).toLowerCase())))){result.matched_returned_quantity+=q;result.matched_returned_gross+=returnedGross;}
 }
 for(const k of ["returned_item_gross","estimated_return_value","recorded_refunds","matched_returned_gross"])result[k]=money(result[k]);
 return result;
}
function receiptWithReturns(sale,rows,productFilter){
 const r=summarizeReturnRows(rows,productFilter),active=activeSale(sale);
 return {...sale,...r,net_items_sold:active?Number(sale.total_items_sold||0)-r.returned_quantity:0,net_matched_product_quantity:active?Number(sale.matched_product_quantity||0)-r.matched_returned_quantity:0,net_items_value:active&&!r.unvalued_return_count?money(Number(sale.total_items_value||0)-r.returned_item_gross):null,net_matched_product_total:active&&!r.unvalued_return_count?money(Number(sale.matched_product_total||0)-r.matched_returned_gross):null,net_sales_after_refunds:active?money(Number(sale.total||0)-r.recorded_refunds):0,net_merchandise_sales:active&&!r.unvalued_return_count?money(Number(sale.total||0)-r.estimated_return_value):null};
}
async function loadReturnRows(db,branchId,{from="",to="",saleIds=null}={}){
 if(Array.isArray(saleIds)&&!saleIds.length)return [];
 const params=[branchId],filters=[];
 if(from){filters.push("r.returned_at >= ?");params.push(from);}
 if(to){filters.push("r.returned_at < DATE_ADD(?, INTERVAL 1 DAY)");params.push(to);}
 if(Array.isArray(saleIds)){filters.push("r.sale_id IN ("+saleIds.map(()=>"?").join(",")+")");params.push(...saleIds);}
 const [rows]=await db.query(`SELECT r.sale_id,r.product_id,SUM(r.quantity) AS returned_quantity,
 SUM(CASE WHEN r.return_type='refund' THEN r.refund_amount ELSE 0 END) AS recorded_refunds,
 SUM(CASE WHEN r.return_type='stock_only' THEN r.quantity ELSE 0 END) AS stock_only_quantity,
 MAX(s.subtotal) AS subtotal,MAX(s.total) AS total,MAX(si.sold_quantity) AS sold_quantity,
 MAX(si.item_gross) AS item_gross,MAX(si.product_name) AS product_name
 FROM returns r JOIN sales s ON s.id=r.sale_id AND s.branch_id=r.branch_id
 LEFT JOIN (SELECT sale_id,product_id,SUM(quantity) AS sold_quantity,SUM(line_total) AS item_gross,MAX(product_name) AS product_name FROM sale_items GROUP BY sale_id,product_id) si ON si.sale_id=r.sale_id AND si.product_id=r.product_id
 WHERE r.branch_id=? AND COALESCE(s.is_voided,0)=0 AND LOWER(COALESCE(s.sale_status,'')) NOT IN ('cancelled','voided','canceled')
 ${filters.length?"AND "+filters.join(" AND "):""} GROUP BY r.sale_id,r.product_id`,params);
 return rows;
}
async function enrichReceipts(db,branchId,sales,{to="",productFilter=null}={}){
 const grouped=new Map();
 // Chunk ID filters to keep large spreadsheet exports safe.
 for(let i=0;i<sales.length;i+=500){const rows=await loadReturnRows(db,branchId,{to,saleIds:sales.slice(i,i+500).map(s=>s.id)});for(const row of rows){const key=Number(row.sale_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}}
 return sales.map(s=>receiptWithReturns(s,grouped.get(Number(s.id))||[],productFilter));
}
function periodNet(gross,rows){const r=summarizeReturnRows(rows);return {...r,gross_sales_amount:money(gross),net_sales_after_refunds:money(Number(gross||0)-r.recorded_refunds),net_merchandise_sales:r.unvalued_return_count?null:money(Number(gross||0)-r.estimated_return_value)};}
function dashboardNetFromDays(rows,now=new Date()){
 const today=now.toISOString().slice(0,10),month=today.slice(0,7)+"-01";
 const week=new Date(Date.parse(today+"T00:00:00Z")-6*86400000).toISOString().slice(0,10);
 const byDay={};let all=0;
 for(const r of rows){const key=String(r.day);if(key>today)continue;const net=money(Number(r.gross||0)-Number(r.refunds||0));byDay[key]=money((byDay[key]||0)+net);all+=net;}
 const sum=from=>money(Object.entries(byDay).reduce((n,[day,value])=>n+(day>=from?value:0),0));
 return {all:money(all),today:byDay[today]||0,month:sum(month),week:sum(week),by_day:Object.fromEntries(Object.entries(byDay).filter(([key])=>key>=week))};
}
async function loadDashboardNet(db,branchId){
 const [rows]=await db.query(`SELECT DATE_FORMAT(s.created_at,'%Y-%m-%d') AS day,SUM(s.total) AS gross,0 AS refunds FROM sales s WHERE s.branch_id=? AND COALESCE(s.is_voided,0)=0 AND LOWER(COALESCE(s.sale_status,'')) NOT IN ('cancelled','voided','canceled') GROUP BY DATE_FORMAT(s.created_at,'%Y-%m-%d')
 UNION ALL SELECT DATE_FORMAT(r.returned_at,'%Y-%m-%d'),0,SUM(r.refund_amount) FROM returns r JOIN sales s ON s.id=r.sale_id AND s.branch_id=r.branch_id WHERE r.branch_id=? AND r.return_type='refund' AND COALESCE(s.is_voided,0)=0 AND LOWER(COALESCE(s.sale_status,'')) NOT IN ('cancelled','voided','canceled') GROUP BY DATE_FORMAT(r.returned_at,'%Y-%m-%d')`,[branchId,branchId]);
 return dashboardNetFromDays(rows);
}
module.exports={summarizeReturnRows,receiptWithReturns,loadReturnRows,enrichReceipts,periodNet,dashboardNetFromDays,loadDashboardNet};
