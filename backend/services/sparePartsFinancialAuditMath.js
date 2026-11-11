"use strict";

/**
 * CHALIN03 read-only audit maths. Never changes a source sales/return/debt
 * record. Money is allocated in integer pesewas, with the last-penny
 * remainder assigned deterministically to source lines, so the report
 * reconciles to the recorded receipt rather than inventing rounded totals.
 */
function cents(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || Math.abs(n) > 9e12) throw new Error("Invalid monetary amount in audit source");
  return Math.round(n * 100);
}
const money = value => cents(value) / 100;
const dec = value => value / 100;
function allocate(totalCents, weights) {
  if (!weights.length) return [];
  const total = Math.trunc(totalCents);
  const absolute = Math.abs(total);
  const positive = weights.map(w => Math.max(0, Math.trunc(w)));
  const weight = positive.reduce((a,b) => a + b, 0);
  if (!weight) {
    return weights.map((_,i) => i === 0 ? total : 0);
  }
  const floats = positive.map(w => absolute * w / weight);
  const base = floats.map(Math.floor);
  let remaining = absolute - base.reduce((a,b) => a+b, 0);
  const order = floats.map((v,i) => ({i,fraction:v-base[i]}))
    .sort((a,b)=>b.fraction-a.fraction || a.i-b.i);
  for(let k=0;k<remaining;k++) base[order[k % order.length].i]++;
  return base.map(v => Math.sign(total) * v);
}
function datePart(value) {
  if (value instanceof Date) return value.toISOString().slice(0,10);
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0,10);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0,10) : "";
}
function sumCents(rows,key) {
  return rows.reduce((total,row) => total + cents(row[key]), 0);
}
function isSaleActive(row) {
  return String(row.sale_status || "").toLowerCase() === "completed" &&
    Number(row.is_voided || 0) !== 1;
}
function buildSales(raw) {
  const byReceipt = new Map();
  for(const source of raw) {
    const id = Number(source.sale_id);
    if (!byReceipt.has(id)) byReceipt.set(id, []);
    byReceipt.get(id).push(source);
  }
  const lines=[],receipts=[],exceptions=[];
  for(const [saleId, sourceRows] of byReceipt) {
    const s=sourceRows[0];
    const active=isSaleActive(s);
    const sourceLines=sourceRows.filter(x=>x.source_line !== null && x.source_line !== undefined)
      .sort((a,b)=>Number(a.source_line)-Number(b.source_line));
    const weights=sourceLines.map(x=>Math.max(0,cents(x.line_total)));
    const discounts=allocate(cents(s.discount_amount),weights);
    const taxes=allocate(cents(s.tax_amount),weights);
    const base={sale_id:saleId,date:datePart(s.created_at),receipt:s.receipt_number||"",
      staff:s.staff_name||"Unassigned",customer:s.customer_name||"Walk-in",
      payment:String(s.payment_type||"Unknown"),status:active?"Completed":String(s.sale_status||"Excluded"),
      voided:!active};
    for(let i=0;i<sourceLines.length;i++) {
      const src=sourceLines[i];
      const gross=weights[i],discount=discounts[i],tax=taxes[i];
      const qty=Number(src.quantity||0);
      const unitCost=cents(src.cost_price_at_sale);
      const cost=Math.round(unitCost*qty);
      const pretax=gross-discount;
      const invoice=pretax+tax;
      const row={...base,source_line:Number(src.source_line),product_id:Number(src.product_id||0),
        item:src.product_name||"[Unnamed historical line]",
        unit_price:money(src.unit_price),qty,
        gross:dec(gross),discount:active?dec(discount):0,net:active?dec(pretax):0,
        tax:active?dec(tax):0,receipt_amount:active?dec(invoice):0,
        unit_cost:dec(unitCost),cost:active?dec(cost):0,
        profit:active?dec(pretax-cost):0,
        margin:active&&pretax>0?money(100*(pretax-cost)/pretax):0,
        recorded_gross:dec(gross),missing_item:false};
      lines.push(row);
    }
    if(!sourceLines.length){
      lines.push({...base,source_line:"",product_id:"",item:"[Missing historical sale item]",
        unit_price:0,qty:0,gross:0,discount:0,net:0,tax:0,receipt_amount:0,
        unit_cost:0,cost:0,profit:0,margin:0,missing_item:true});
    }
    const lineSubtotal=weights.reduce((a,b)=>a+b,0);
    const linePretax=lineSubtotal-cents(s.discount_amount);
    const lineInvoice=linePretax+cents(s.tax_amount);
    const headerSubtotal=cents(s.subtotal),headerDiscount=cents(s.discount_amount);
    const headerTax=cents(s.tax_amount),headerInvoice=cents(s.total);
    const lineCost=sumCents(lines.filter(x=>x.sale_id===saleId && !x.missing_item),"cost");
    const errors=[];
    if(!sourceLines.length)errors.push("Missing sale item source lines");
    if(lineSubtotal!==headerSubtotal)errors.push("Item line totals differ from receipt subtotal");
    if(headerSubtotal-headerDiscount+headerTax!==headerInvoice)errors.push("Receipt header fails subtotal minus discount plus tax");
    if(lineInvoice!==headerInvoice)errors.push("Allocated item totals differ from receipt total");
    if(cents(s.amount_paid)>headerInvoice)errors.push("Recorded lifetime paid amount exceeds receipt");
    if(!active)errors.push("Excluded non-completed / voided sale");
    const receipt={...base,source_lines:sourceLines.length,
      subtotal:dec(headerSubtotal),line_subtotal:dec(lineSubtotal),
      discount:dec(headerDiscount),tax:dec(headerTax),
      total:dec(headerInvoice),
      allocated_total:dec(lineInvoice),
      total_difference:active?dec(lineInvoice-headerInvoice):0,
      subtotal_difference:active?dec(lineSubtotal-headerSubtotal):0,
      pretax_sales:active?dec(headerSubtotal-headerDiscount):0,
      paid_lifetime:money(s.amount_paid),balance_lifetime:money(s.balance),
      cost:active?dec(lineCost):0,
      review_status:errors.length?errors.join("; "):"Reconciled",
      active};
    receipts.push(receipt);
    if(errors.length) exceptions.push({type:"Sale",date:receipt.date,receipt:receipt.receipt,
      source_id:saleId,item:"Receipt",issue:errors.join("; "),amount:receipt.total_difference});
  }
  return {lines,receipts,exceptions};
}
function buildReturns(rows) {
  const lines=[],exceptions=[];
  for(const r of rows) {
    const units=Number(r.quantity||0);
    const soldUnits=Number(r.sold_quantity||0);
    const recordedCost=Number(r.historical_sale_cost||0);
    const originalItemGross=Number(r.historical_sale_gross||0);
    const historicalUnitCost=soldUnits>0?money(recordedCost/soldUnits):0;
    const recoveredCost=soldUnits>0?money(units*recordedCost/soldUnits):0;
    const originalGross=soldUnits>0?money(units*originalItemGross/soldUnits):0;
    const kind=String(r.return_type||"stock_only").toLowerCase();
    const isRefund=kind==="refund";
    const method=isRefund?String(r.refund_method||"none").toLowerCase():"none";
    const refund=isRefund?money(r.refund_amount):0;
    const report={date:datePart(r.returned_at),return_id:Number(r.return_id),
      receipt:r.receipt_number||"[Missing linked receipt]",
      original_sale_date:datePart(r.sale_created_at),
      sale_id:Number(r.sale_id||0),product_id:Number(r.product_id||0),
      item:r.historical_product_name||r.product_name||"[Missing historical item]",
      customer:r.customer_name||"Walk-in",
      qty:units,return_type:isRefund?"Cash/financial refund":"Stock-only return",
      cash_involved:method==="cash"&&refund>0?"YES":"NO",
      refund_method:method,refund_amount:refund,cash_refund:method==="cash"?refund:0,
      momo_refund:method==="momo"?refund:0,bank_refund:method==="bank"?refund:0,
      other_refund:method==="other"?refund:0,
      original_item_gross_estimate:originalGross,
      historical_unit_cost_estimate:historicalUnitCost,
      recovered_stock_cost_estimate:recoveredCost,
      return_revenue_effect:isRefund?refund:0,
      reference:r.refund_reference||"",
      reason:r.reason||"",returned_by:r.returned_by_name||"Unknown",
      approved_by:r.approved_by_name||"Not recorded",
      source_id:Number(r.return_id),sale_status:r.sale_status||"",
      cash_movement:isRefund?"Money paid out":"No money paid out",
      review_status:""};
    const risks=[];
    if(!soldUnits) risks.push("Original sale item missing; cost cannot be verified");
    if(!r.receipt_number) risks.push("Original sale missing");
    if(units<=0) risks.push("Invalid returned quantity");
    if(isRefund&&refund<=0) risks.push("Financial return has no positive refund");
    if(isRefund&&!["cash","momo","bank","other"].includes(method)) risks.push("Unrecognised refund payment method");
    if(isRefund&&!r.approved_by_name) risks.push("No independent approver identity");
    if(!isRefund&&cents(r.refund_amount)!==0) risks.push("Stock-only return has refund money");
    if(Number(r.is_voided||0)===1||String(r.sale_status||"").toLowerCase()!=="completed")
      risks.push("Return linked to non-completed/voided sale");
    report.review_status=risks.length?risks.join("; "):"Recorded";
    if(risks.length) exceptions.push({type:"Return",date:report.date,receipt:report.receipt,
      source_id:report.return_id,item:report.item,issue:risks.join("; "),amount:refund});
    lines.push(report);
  }
  return {lines,exceptions};
}
function groupRows(rows,field,fields) {
  const map=new Map();
  for(const row of rows) {
    const key=String(row[field]||"Unspecified");
    if(!map.has(key))map.set(key,{name:key,lines:0,qty:0,...Object.fromEntries(fields.map(x=>[x,0]))});
    const group=map.get(key);group.lines++;group.qty+=Number(row.qty||0);
    for(const f of fields) group[f]+=cents(row[f]);
  }
  return [...map.values()].map(group=>{
    for(const field of fields)group[field]=dec(group[field]);
    if("net" in group && "profit" in group)group.margin=group.net>0?money(group.profit*100/group.net):0;
    return group;
  }).sort((a,b)=>(b.net||b.refund_amount||0)-(a.net||a.refund_amount||0));
}
function summaryOf(sales,returned,allocations=[],debts=[]) {
  const activeSales=sales.receipts.filter(x=>x.active);
  const validLines=sales.lines.filter(x=>!x.voided&&!x.missing_item);
  const moneySum=(rows,key)=>dec(sumCents(rows,key));
  const refunds=returned.lines.filter(x=>x.refund_amount>0);
  const refundByChannel={cash:moneySum(refunds,"cash_refund"),momo:moneySum(refunds,"momo_refund"),
    bank:moneySum(refunds,"bank_refund"),other:moneySum(refunds,"other_refund")};
  const cashReturnTotal=moneySum(refunds,"refund_amount");
  const returnsCost=moneySum(refunds,"recovered_stock_cost_estimate");
  const salePretax=moneySum(activeSales,"pretax_sales");
  const salesTax=moneySum(activeSales,"tax");
  const saleInvoice=moneySum(activeSales,"total");
  const lineInvoice=moneySum(validLines,"receipt_amount");
  const saleCost=moneySum(validLines,"cost");
  const bookedProfit=money(salePretax-saleCost);
  const initialCollected=moneySum(allocations,"amount");
  const laterDebtCollections=moneySum(debts,"amount");
  const perSale=new Map();
  for(const a of allocations)perSale.set(Number(a.sale_id),(perSale.get(Number(a.sale_id))||0)+cents(a.amount));
  const allocationExceptions=[];
  for(const sale of activeSales) {
    const allocated=perSale.get(Number(sale.sale_id))||0;
    if(allocated>cents(sale.total)) allocationExceptions.push({type:"Payment",date:sale.date,
      receipt:sale.receipt,source_id:sale.sale_id,item:"Payment allocations",
      issue:"Initial channel allocations exceed receipt total",amount:dec(allocated-cents(sale.total))});
    if(allocated>cents(sale.paid_lifetime)) allocationExceptions.push({type:"Payment",date:sale.date,
      receipt:sale.receipt,source_id:sale.sale_id,item:"Payment allocations",
      issue:"Initial channel allocations exceed lifetime amount paid",amount:dec(allocated-cents(sale.paid_lifetime))});
  }
  const financialExceptions=[...sales.exceptions,...returned.exceptions,...allocationExceptions];
  return {summary:{
    active_receipts:activeSales.length,source_lines:sales.lines.length,
    booked_subtotal:moneySum(activeSales,"subtotal"),
    booked_discounts:moneySum(activeSales,"discount"),
    booked_pretax_sales:salePretax,booked_tax:salesTax,booked_receipt_total:saleInvoice,
    item_line_including_tax:lineInvoice,
    line_to_receipt_difference:money(lineInvoice-saleInvoice),
    historical_cost:saleCost,original_gross_profit:bookedProfit,
    return_count:returned.lines.length,
    returned_units:returned.lines.reduce((s,x)=>s+x.qty,0),
    financial_return_count:refunds.length,
    stock_only_return_count:returned.lines.length-refunds.length,
    total_refunded:cashReturnTotal,
    recovered_refund_stock_cost_estimate:returnsCost,
    cash_refunded:refundByChannel.cash,momo_refunded:refundByChannel.momo,
    bank_refunded:refundByChannel.bank,other_refunded:refundByChannel.other,
    sales_receipt_value_less_period_refunds:money(saleInvoice-cashReturnTotal),
    period_profit_bridge_estimate:money(bookedProfit-cashReturnTotal+returnsCost),
    original_sale_collections_in_period:initialCollected,
    debt_collections_in_period:laterDebtCollections,
    customer_money_in_less_refunds:money(initialCollected+laterDebtCollections-cashReturnTotal),
    audit_exception_count:financialExceptions.length,
  },refundByChannel,financialExceptions,validLines,activeSales};
}
module.exports={cents,money,allocate,datePart,isSaleActive,buildSales,buildReturns,groupRows,summaryOf};
