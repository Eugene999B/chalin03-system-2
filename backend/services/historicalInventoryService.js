"use strict";
// Reconstruct book stock by reversing recorded changes using immutable product IDs.
// UTC is Ghana civil time. Cutoffs are exclusive midnight boundaries.
function dateKey(v){if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error("Choose valid reporting dates.");const d=new Date(v+"T00:00:00Z");if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw Error("Choose valid reporting dates.");return d;}
function reportingPeriod(from,to,now=new Date()){
 if(!from&&!to)return null;
 const start=from?dateKey(from):null,end=to?dateKey(to):null;
 if(!end)throw Error("Select an end date for the historical inventory report.");
 if(start&&start>end)throw Error("Start date must not be after end date.");
 if(end.toISOString().slice(0,10)>now.toISOString().slice(0,10))throw Error("Inventory cannot be reported for a future date.");
 return {start,cutoff:new Date(+end+86400000),end:to,from:from||null};
}
function timestamp(v){if(!v)throw Error("Missing movement timestamp");const n=+new Date(v);if(!Number.isFinite(n))throw Error("Invalid movement timestamp");return n;}
function number(v){if(v===null||v===undefined||v===""||!Number.isSafeInteger(Number(v)))throw Error("Invalid recorded stock quantity");return Number(v);}
function id(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw Error("Unresolved movement product ID");return n;}
function json(v){return typeof v==="string"?JSON.parse(v):v;}
function group(rows,key){const map=new Map();for(const r of rows){const k=Number(r[key]);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return map;}
function isVoid(s){return Number(s.is_voided||0)===1||["cancelled","voided","canceled"].includes(String(s.sale_status||"").toLowerCase());}
function saleContribution(s,items,returns,cutoff){
 const out=new Map();
 const add=(p,n)=>out.set(id(p),(out.get(id(p))||0)+number(n));
 if(!s||timestamp(s.created_at)>=cutoff)return out;
 // A void restores the unreturned portion; returns are accounted for separately.
 if(isVoid(s)){
  if(!s.voided_at||timestamp(s.voided_at)>=cutoff)throw Error("Sale void chronology cannot be verified");
  for(const r of returns)if(timestamp(r.returned_at)<cutoff)add(r.product_id,-number(r.quantity));
 }else for(const i of items)add(i.product_id,-number(i.quantity));
 return out;
}
function reconstruct(data,cutoff){
 const end=+cutoff,qty=new Map(data.products.map(p=>[id(p.id),number(p.quantity)]));
 const adjust=(p,n)=>{p=id(p);if(!qty.has(p))throw Error("Movement references a missing product ID");qty.set(p,qty.get(p)+number(n));};
 for(const m of data.movements)if(timestamp(m.at)>=end)adjust(m.product_id,-number(m.delta));
 const histories=group(data.history,"sale_id"),items=group(data.items,"sale_id"),returns=group(data.returns,"sale_id");
 for(const sale of data.sales){
  const sid=Number(sale.id),currentItems=items.get(sid)||[],ret=returns.get(sid)||[];
  const changes=(histories.get(sid)||[]).filter(h=>timestamp(h.created_at)>=end).sort((a,b)=>timestamp(a.created_at)-timestamp(b.created_at)||Number(a.id)-Number(b.id));
  let old=sale,oldItems=currentItems;
  if(timestamp(sale.created_at)<end){
   if(changes.length){const before=json(changes[0].before_snapshot_json);if(!before?.sale||!Array.isArray(before.items))throw Error("Missing original sale snapshot for sale "+sid);old=before.sale;oldItems=before.items;}
   else if((sale.edited_at&&timestamp(sale.edited_at)>=end)||(sale.voided_at&&timestamp(sale.voided_at)>=end))throw Error("Missing sale change history for sale "+sid);
  }else{old=null;oldItems=[];}
  const current=saleContribution(sale,currentItems,ret,Infinity),previous=saleContribution(old,oldItems,ret,end);
  for(const [p,n] of current)adjust(p,-n);
  for(const [p,n] of previous)adjust(p,n);
 }
 for(const r of data.returns)if(timestamp(r.returned_at)>=end)adjust(r.product_id,-number(r.quantity));
 return qty;
}
function productRows(data,period){
 const closing=reconstruct(data,period.cutoff),opening=period.start?reconstruct(data,period.start):null;
 const audit=group(data.audit,"product_id"),costEvents=group(data.costEvents,"product_id");
 return data.products.filter(p=>timestamp(p.created_at)<+period.cutoff).map(p=>{
  const pid=id(p.id),q=closing.get(pid),o=opening&&timestamp(p.created_at)<+period.start?opening.get(pid):opening?0:null;
  if(q<0||(o!==null&&o<0))throw Error("Negative reconstructed stock for product "+pid+"; ledger requires reconciliation.");
  const post=(audit.get(pid)||[]).filter(a=>timestamp(a.created_at)>=+period.cutoff);
  const detailChanged=post.some(a=>["UPDATE_PRODUCT_DETAILS","DELETE_PRODUCT"].includes(a.action));
  const priceEvents=[...(costEvents.get(pid)||[]).filter(a=>timestamp(a.at)>=+period.cutoff),...post.filter(a=>/PRICE/.test(a.action)).map(a=>({at:a.created_at,sequence:a.id,kind:"price",metadata:a.metadata_json}))].sort((a,b)=>timestamp(a.at)-timestamp(b.at)||Number(a.sequence||0)-Number(b.sequence||0));
  let cost=p.cost_price,selling=p.selling_price,notes=[];
  // A later purchase can change master cost but may not preserve its previous value.
  for(const event of priceEvents.slice().reverse()){
   if(event.kind==="purchase"||event.kind==="transfer"){cost=null;if(event.kind==="transfer")selling=null;continue;}
   if(event.kind==="adjustment"){if(event.before!==null&&event.before!==undefined)cost=event.before;else cost=null;continue;}
   let before;try{before=json(event.metadata)?.before;}catch{before=null;}
   cost=before?.cost_price??null;selling=before?.selling_price??null;
  }
  if(detailChanged){notes.push("Product details/status edited after cutoff; historical details unavailable");}
  if(cost===null||selling===null)notes.push("Historical master price not fully evidenced");
  return {...p,quantity:q,opening_quantity:o,net_change:o===null?null:q-o,cost_price:cost,selling_price:selling,details_changed:detailChanged,history_note:notes.join("; ")||"No later master-detail edit identified; reconstructed from recorded movements"};
 });
}
async function loadHistoricalProducts(pool,branchId,period){
 const connection=await pool.getConnection();
 try{
  await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  const query=async(sql,params=[branchId])=>(await connection.query(sql,params))[0];
  const products=await query("SELECT id,branch_id,name,size,category,cost_price,selling_price,quantity,low_stock_threshold,barcode,is_active,created_at FROM products WHERE branch_id=? ORDER BY name,id");
  const movements=await query(`SELECT product_id, adjusted_at AS at, new_quantity-old_quantity AS delta FROM stock_adjustments WHERE branch_id=?
   UNION ALL SELECT pi.product_id,p.created_at,pi.quantity FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE p.branch_id=?
   UNION ALL SELECT i.source_product_id,t.dispatched_at,-i.dispatched_quantity FROM stock_transfer_items i JOIN stock_transfers t ON t.id=i.transfer_id WHERE t.from_branch_id=? AND t.status IN ('dispatched','received')
   UNION ALL SELECT i.destination_product_id,t.received_at,i.received_quantity FROM stock_transfer_items i JOIN stock_transfers t ON t.id=i.transfer_id WHERE t.to_branch_id=? AND t.status='received'`,[branchId,branchId,branchId,branchId]);
  const sales=await query("SELECT id,created_at,edited_at,voided_at,is_voided,sale_status FROM sales WHERE branch_id=?");
  const items=await query("SELECT i.sale_id,i.product_id,i.quantity FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.branch_id=?");
  const returns=await query("SELECT sale_id,product_id,quantity,returned_at FROM returns WHERE branch_id=?");
  const history=await query("SELECT id,sale_id,created_at,before_snapshot_json FROM sale_change_history WHERE branch_id=? AND created_at>=?",[branchId,period.start||period.cutoff]);
  const audit=await query(`SELECT id,CAST(entity_id AS UNSIGNED) AS product_id,action,created_at,metadata_json FROM activity_log WHERE branch_id=? AND entity_type='product' AND created_at>=?`,[branchId,period.cutoff]);
  // Legacy soft-delete audit entries lack entity_id; recover only the explicit ID in the recorded message.
  const deleted=await query("SELECT id,action,details,created_at FROM activity_log WHERE branch_id=? AND action='DELETE_PRODUCT' AND created_at>=?",[branchId,period.cutoff]);
  for(const r of deleted){const match=String(r.details||"").match(/with ID (\d+)$/);if(!match)throw Error("A historical product deletion has no recoverable product ID");audit.push({...r,product_id:Number(match[1])});}
  const costEvents=await query(`SELECT product_id,adjusted_at AS at,id AS sequence,'adjustment' AS kind,cost_price_before AS before FROM stock_adjustments WHERE branch_id=? AND adjusted_at>=? AND movement_type='quick_restock'
   UNION ALL SELECT pi.product_id,p.created_at,pi.id,'purchase',NULL FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE p.branch_id=? AND p.created_at>=?`,[branchId,period.cutoff,branchId,period.cutoff]);
  const rows=productRows({products,movements,sales,items,returns,history,audit,costEvents},period);
  await connection.commit();return rows;
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
module.exports={reportingPeriod,reconstruct,productRows,loadHistoricalProducts};
