"use strict";
const express = require("express");
const {pool} = require("../config/db");
const {requireRole} = require("../middleware/roleMiddleware");
const {sendAuditExport} = require("../services/sparePartsAuditExportService");
const {
  money, datePart, buildSales, buildReturns, groupRows, summaryOf
} = require("../services/sparePartsFinancialAuditMath");
const router = express.Router();

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value+"T00:00:00Z")) &&
  new Date(value+"T00:00:00Z").toISOString().slice(0,10) === value;
const selectedBranch=req=>Number.isSafeInteger(Number(req.user?.branch_id)) &&
  Number(req.user.branch_id)>0?Number(req.user.branch_id):null;
function dateFilter(alias,column,from,to,params) {
  const where=[];
  if(from){where.push("DATE("+alias+"."+column+") >= ?");params.push(from)}
  if(to){where.push("DATE("+alias+"."+column+") <= ?");params.push(to)}
  return where.length?" AND "+where.join(" AND "):"";
}
const label = (key,name,weight=1) => ({key,label:name,weight});
function sum(rows,key){return money(rows.reduce((total,row)=>total+Number(row[key]||0),0))}
function columnRows(metrics) {
  return metrics.map(([measure,value])=>({measure,value}));
}
function activeExpense(row) {
  return !Number(row.is_voided||0) && !Number(row.is_reversal||0);
}

router.get("/transaction-history",requireRole("admin","manager","auditor"),async(req,res)=>{
  const branchId=selectedBranch(req);
  if(!branchId)return res.status(400).json({status:"error",message:"Select an authorised Spare Parts store before exporting."});
  const from=String(req.query.from||"").trim(),to=String(req.query.to||"").trim();
  if((from&&!isDate(from))||(to&&!isDate(to))||(from&&to&&from>to))
    return res.status(400).json({status:"error",message:"Choose a valid reporting date range."});
  const format=String(req.query.format||"xlsx").toLowerCase();
  if(!["xlsx","csv","word","doc","pdf"].includes(format))
    return res.status(400).json({status:"error",message:"Choose Excel, PDF, Word or CSV."});

  let connection;
  try {
    connection=await pool.getConnection();
    // All tabs use the same database snapshot. This prevents a transaction
    // posted during export from appearing in one section but not another.
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION READ ONLY");

    const salesParams=[branchId];
    const saleDates=dateFilter("s","created_at",from,to,salesParams);
    const [saleRaw]=await connection.query([
      "SELECT s.id AS sale_id,s.created_at,s.receipt_number,s.customer_name,s.payment_type,",
      "s.sale_status,s.is_voided,s.subtotal,s.discount_amount,s.tax_amount,s.total,",
      "s.amount_paid,s.balance,COALESCE(debt_hist.debt_paid_lifetime,0) AS debt_payments_lifetime,",
      "staff.full_name AS staff_name,",
      "si.id AS source_line,si.product_id,si.product_name,si.quantity,",
      "si.unit_price,si.line_total,si.cost_price_at_sale",
      "FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id",
      "LEFT JOIN (SELECT d.branch_id,d.sale_id,SUM(dp.amount) AS debt_paid_lifetime",
      "FROM debts d INNER JOIN debt_payments dp ON dp.debt_id=d.id",
      "AND dp.branch_id=d.branch_id WHERE d.sale_id IS NOT NULL",
      "GROUP BY d.branch_id,d.sale_id) debt_hist",
      "ON debt_hist.sale_id=s.id AND debt_hist.branch_id=s.branch_id",
      "LEFT JOIN users staff ON staff.id=s.staff_id",
      "WHERE s.branch_id = ?"+saleDates,
      "ORDER BY s.created_at DESC,s.id DESC,si.id ASC LIMIT 20001"
    ].join(" "),salesParams);
    if(saleRaw.length>20000) {
      await connection.rollback();
      return res.status(422).json({status:"error",code:"EXPORT_RANGE_TOO_LARGE",
        message:"More than 20,000 sale item lines. Select a shorter date range."});
    }

    // Returned-at, not original sale date, decides which return belongs to
    // this reporting period. Historical sale item aggregates are one row per
    // sale/product to avoid multiplying refunds when a SKU has multiple lines.
    const returnParams=[branchId];
    const returnDates=dateFilter("r","returned_at",from,to,returnParams);
    const [returnRaw]=await connection.query([
      "SELECT r.id AS return_id,r.branch_id,r.sale_id,r.product_id,r.quantity,",
      "r.reason,r.return_type,r.refund_amount,r.refund_method,r.refund_reference,",
      "r.returned_at,r.approved_by,",
      "s.created_at AS sale_created_at,s.receipt_number,s.sale_status,s.is_voided,",
      "s.customer_name,s.total,s.amount_paid,s.subtotal AS sale_subtotal,",
      "s.discount_amount AS sale_discount,s.tax_amount AS sale_tax,",
      "history.historical_product_name,history.sold_quantity,",
      "history.historical_sale_cost,history.historical_sale_gross,",
      "p.name AS product_name,",
      "u.full_name AS returned_by_name,approver.full_name AS approved_by_name",
      "FROM returns r",
      "LEFT JOIN sales s ON s.id=r.sale_id AND s.branch_id=r.branch_id",
      "LEFT JOIN (SELECT si.sale_id,si.product_id,",
      "MAX(si.product_name) AS historical_product_name,",
      "SUM(si.quantity) AS sold_quantity,",
      "SUM(si.quantity * si.cost_price_at_sale) AS historical_sale_cost,",
      "SUM(si.line_total) AS historical_sale_gross",
      "FROM sale_items si GROUP BY si.sale_id,si.product_id) history",
      "ON history.sale_id=r.sale_id AND history.product_id=r.product_id",
      "LEFT JOIN products p ON p.id=r.product_id AND p.branch_id=r.branch_id",
      "LEFT JOIN users u ON u.id=r.returned_by",
      "LEFT JOIN users approver ON approver.id=r.approved_by",
      "WHERE r.branch_id = ?"+returnDates,
      "ORDER BY r.returned_at DESC,r.id DESC LIMIT 20001"
    ].join(" "),returnParams);
    if(returnRaw.length>20000) {
      await connection.rollback();
      return res.status(422).json({status:"error",code:"EXPORT_RETURNS_RANGE_TOO_LARGE",
        message:"More than 20,000 returns match. Select a shorter date range."});
    }

    // Payment allocations represent money collected at the time of sale.
    // sales.amount_paid is a LIFETIME value (later debt collections change it),
    // so it must not be counted as daily cash received at the sale date.
    const allocParams=[branchId];
    const allocDates=dateFilter("s","created_at",from,to,allocParams);
    const [allocationRows]=await connection.query([
      "SELECT spa.sale_id,spa.payment_channel AS payment,",
      "SUM(spa.amount) AS amount",
      "FROM sale_payment_allocations spa",
      "INNER JOIN sales s ON s.id=spa.sale_id AND s.branch_id=spa.branch_id",
      "WHERE s.branch_id = ? AND s.sale_status='completed'",
      "AND COALESCE(s.is_voided,0)=0"+allocDates,
      "GROUP BY spa.sale_id,spa.payment_channel"
    ].join(" "),allocParams);
    const allocations=allocationRows.map(x=>({
      sale_id:Number(x.sale_id),payment:x.payment||"Unspecified",
      amount:money(x.amount)
    }));

    // Debt repayments use their own paid_at date, even when the original
    // customer sale happened outside the selected date range.
    const debtParams=[branchId];
    const debtDates=dateFilter("dp","paid_at",from,to,debtParams);
    const [debtRaw]=await connection.query([
      "SELECT dp.id AS payment_id,dp.paid_at,dp.amount,dp.payment_method,",
      "dp.debt_id,d.sale_id,s.receipt_number,s.customer_name,s.sale_status,s.is_voided,",
      "u.full_name AS collected_by",
      "FROM debt_payments dp",
      "INNER JOIN debts d ON d.id=dp.debt_id AND d.branch_id=dp.branch_id",
      "LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id",
      "LEFT JOIN users u ON u.id=dp.received_by",
      "WHERE dp.branch_id = ?"+debtDates,
      "ORDER BY dp.paid_at DESC,dp.id DESC LIMIT 20001"
    ].join(" "),debtParams);
    if(debtRaw.length>20000) {
      await connection.rollback();
      return res.status(422).json({status:"error",code:"EXPORT_DEBT_RANGE_TOO_LARGE",
        message:"More than 20,000 debt payments match. Select a shorter date range."});
    }
    const debts=debtRaw.map(x=>({
      date:datePart(x.paid_at),payment_id:Number(x.payment_id),
      debt_id:Number(x.debt_id),sale_id:Number(x.sale_id||0),
      receipt:x.receipt_number||"Unlinked",
      customer:x.customer_name||"Unspecified",
      amount:money(x.amount),payment:x.payment_method||"Unspecified",
      collected_by:x.collected_by||"Unknown",
      source_status:String(x.sale_status||"Unknown")
    }));

    const expenseParams=[branchId];
    const expenseDates=(from?" AND e.expense_date >= ?":"")+(to?" AND e.expense_date <= ?":"");
    if(from)expenseParams.push(from);
    if(to)expenseParams.push(to);
    const [expenseRaw]=await connection.query([
      "SELECT e.id,e.category,e.description,e.amount,e.payment_method,",
      "e.funding_source,e.affects_daily_closing,e.expense_date,",
      "e.is_voided,e.is_reversal,e.reversal_of_expense_id,",
      "u.full_name AS recorded_by_name",
      "FROM expenses e LEFT JOIN users u ON u.id=e.recorded_by",
      "WHERE e.branch_id = ?"+expenseDates,
      "ORDER BY e.expense_date DESC,e.id DESC LIMIT 20001"
    ].join(" "),expenseParams);
    if(expenseRaw.length>20000){
      await connection.rollback();
      return res.status(422).json({status:"error",code:"EXPORT_EXPENSES_RANGE_TOO_LARGE",
        message:"More than 20,000 expenses match. Select a shorter date range."});
    }
    const expenses=expenseRaw.map(x=>({
      ...x,date:datePart(x.expense_date),amount:money(x.amount),
      recorded_by:x.recorded_by_name||"Unknown",
      status:Number(x.is_voided)?"Voided":Number(x.is_reversal)?"Reversal":"Active",
      effective_amount:activeExpense(x)?money(x.amount):0,
    }));
    const [stores]=await connection.query(
      "SELECT name,code FROM branches WHERE id=? LIMIT 1",[branchId]);
    await connection.commit();

    const sales=buildSales(saleRaw);
    const returned=buildReturns(returnRaw);
    const outcome=summaryOf(sales,returned,allocations,debts,expenses);
    const s=outcome.summary;
    const expenseAudit=[];
    const byExpenseId=new Map(expenses.map(e=>[Number(e.id),e]));
    const reversedExpenseIds=new Set(expenses.filter(e=>Number(e.is_reversal)).map(e=>Number(e.reversal_of_expense_id)));
    for(const e of expenses){
      if(Number(e.is_voided) && !reversedExpenseIds.has(Number(e.id))){
        expenseAudit.push({type:"Expense",date:e.date,receipt:"",source_id:Number(e.id),
          item:e.category,issue:"Voided expense has no matching reversal in this reporting range",
          amount:e.amount});
      }
      if(Number(e.is_reversal)&&!byExpenseId.has(Number(e.reversal_of_expense_id))){
        expenseAudit.push({type:"Expense",date:e.date,receipt:"",source_id:Number(e.id),
          item:e.category,issue:"Expense reversal source not found in this reporting range",amount:e.amount});
      }
    }
    const warnings=[...outcome.financialExceptions,...expenseAudit];
    const originalAllocations=groupRows(allocations,"payment",["amount"]);
    const refundChannels=groupRows(returned.lines,"refund_method",[
      "refund_amount","cash_refund","momo_refund","bank_refund","other_refund"
    ]);
    const metric=[
      ["Active completed sale receipts",s.active_receipts],
      ["Original receipt subtotal (GHS)",s.booked_subtotal],
      ["Recorded discounts (GHS)",s.booked_discounts],
      ["Sales excluding tax, BEFORE returns (GHS)",s.booked_pretax_sales],
      ["Recorded sales tax (GHS)",s.booked_tax],
      ["Full receipt totals INCLUDING tax (GHS)",s.booked_receipt_total],
      ["Sum of allocated item lines including tax (GHS)",s.item_line_including_tax],
      ["Item line to receipt difference (GHS)",s.line_to_receipt_difference],
      ["Historical cost of sold lines (GHS)",s.historical_cost],
      ["Gross profit from sales BEFORE returns (GHS)",s.original_gross_profit],
      ["Number of return events (returned-at date)",s.return_count],
      ["Returned units",s.returned_units],
      ["Financial refund events",s.financial_return_count],
      ["Stock-only, NO CASH return events",s.stock_only_return_count],
      ["Total MONEY REFUNDED (GHS)",s.total_refunded],
      ["Cash refunds PAID OUT (GHS)",s.cash_refunded],
      ["MoMo refunds PAID OUT (GHS)",s.momo_refunded],
      ["Bank refunds PAID OUT (GHS)",s.bank_refunded],
      ["Other refunds PAID OUT (GHS)",s.other_refunded],
      ["Estimated recovered historical cost of refunded stock (GHS)",s.recovered_refund_stock_cost_estimate],
      ["Total currently-active operating expenses (GHS)",s.active_operating_expenses],
      ["Sale-period receipt value LESS return-period refunds (GHS)",s.sales_receipt_value_less_period_refunds],
      ["Indicative margin bridge AFTER returns and expenses (GHS)",s.period_profit_bridge_estimate],
      ["Completed receipts with no allocation rows and a positive LIFETIME paid balance",s.receipts_missing_original_payment_allocations],
      ["Receipts with reconstructed tender but unknown original channel",s.receipts_with_unknown_initial_channel],
      ["Reconstructed sale-day customer receipts (GHS)",s.reconstructed_original_sale_collections],
      ["Reconstructed original tender with UNKNOWN channel (GHS)",s.unknown_original_channel_amount],
      ["LIFETIME paid snapshot on unallocated receipts (NOT initial cash) (GHS)",s.lifetime_paid_on_unallocated_receipts],
      ["Verified payment allocations on sales IN PERIOD (GHS)",s.original_sale_collections_in_period],
      ["Debt repayments actually collected IN PERIOD (GHS)",s.debt_collections_in_period],
      ["Reconstructed customer receipts IN minus refunds OUT (GHS)",s.customer_money_in_less_refunds],
      ["Issues needing investigation",warnings.length]
    ];
    const groups=[label("name","Group",2),label("lines","Count"),
      label("qty","Units"),label("net","Sales excl. tax"),label("tax","Tax"),
      label("receipt_amount","Receipt incl. tax"),
      label("cost","Cost"),label("profit","Gross profit"),label("margin","Margin %")];
    const returnCols=[
      label("date","Return Date"),label("return_id","Return ID"),
      label("receipt","Original Receipt"),label("original_sale_date","Original Sale Date"),
      label("item","Returned Item",2),label("product_id","Product ID"),
      label("qty","Returned Qty"),label("return_type","Return Type"),
      label("cash_involved","Cash Involved?"),
      label("refund_method","Refund Method"),label("refund_amount","Money Refunded (GHS)"),
      label("cash_refund","Cash Paid Out"),label("momo_refund","MoMo Paid Out"),
      label("bank_refund","Bank Paid Out"),label("other_refund","Other Paid Out"),
      label("original_item_gross_estimate","Original Item Gross Estimate"),
      label("estimated_net_refundable","Expected Item Refund Incl Tax Estimate"),
      label("refund_vs_estimated_value","Refund Minus Expected Estimate"),
      label("historical_unit_cost_estimate","Historical Unit Cost Estimate"),
      label("recovered_stock_cost_estimate","Recovered Stock Cost Estimate"),
      label("reference","Refund Reference",1.5),label("reason","Return Reason",2),
      label("returned_by","Processed By"),label("approved_by","Approved By"),
      label("customer","Customer",1.5),label("sale_id","Original Sale ID"),
      label("review_status","Investigation Flag",2)
    ];
    const cols=[
      label("date","Transaction Date"),label("receipt","Receipt",2),label("item","Item",3),
      label("unit_price","Historical Unit Price"),label("qty","Quantity"),
      label("gross","Source Line Amount"),label("discount","Allocated Discount"),
      label("net","Sales Before Tax"),label("tax","Allocated Tax"),
      label("receipt_amount","Line Total Incl Tax"),
      label("unit_cost","Cost Price At Sale"),label("cost","Historical Cost"),
      label("profit","Gross Profit Excl Tax"),label("margin","Profit Margin %"),
      label("payment","Sale Payment Type"),label("staff","Staff"),
      label("customer","Customer"),label("status","Sale Status"),
      label("source_line","Source Line ID"),label("sale_id","Sale ID")
    ];
    const receiptCols=[
      label("date","Sale Date"),label("receipt","Receipt"),label("sale_id","Sale ID"),
      label("status","Sale Status"),label("source_lines","Source Lines"),
      label("subtotal","Source Header Subtotal"),label("line_subtotal","Sum Item Lines"),
      label("subtotal_difference","Difference vs Subtotal"),
      label("discount","Recorded Discount"),label("tax","Recorded Tax"),
      label("pretax_sales","Booked Pretax Sales"),label("total","Receipt Incl Tax"),
      label("allocated_total","Allocated Lines Incl Tax"),
      label("total_difference","Difference vs Receipt"),
      label("paid_lifetime","Paid (Lifetime Snapshot)"),
      label("debt_payments_lifetime","Debt Payments (Lifetime)"),
      label("initial_paid_reconstructed","Reconstructed Initial Tender"),
      label("balance_lifetime","Outstanding (Lifetime Snapshot)"),
      label("review_status","Reconciliation",3)
    ];
    const sumCols=[label("measure","Measure",3),label("value","Value")];
    const refundCols=[label("name","Refund Channel"),label("lines","Return Events"),
      label("qty","Units"),label("refund_amount","Refund Total"),
      label("cash_refund","Cash Out"),label("momo_refund","MoMo Out"),
      label("bank_refund","Bank Out"),label("other_refund","Other Out")];
    const expenseCols=[label("date","Expense Date"),label("id","Expense ID"),
      label("category","Category"),label("description","Description",2),
      label("amount","Recorded Amount"),label("effective_amount","Effective Amount"),
      label("payment_method","Payment Channel"),
      label("funding_source","Funding"),label("status","Status"),
      label("recorded_by","Recorded By"),label("reversal_of_expense_id","Reversal Of")];
    const notes=[
      {measure:"DATE BASIS",value:"Sales: date created; Returns: date returned; Debts: date actually paid; Expenses: expense date."},
      {measure:"TAX BASIS",value:"Profit and line sales exclude tax; full receipt totals include tax."},
      {measure:"DISCOUNT BASIS",value:"Receipt discount and tax distributed in pesewas with exact remainder reconciliation."},
      {measure:"CASH BASIS",value:"Cash/Bank/MoMo refunds are actual money OUT; stock-only returns are NOT money OUT."},
      {measure:"COST BASIS",value:"Returned stock cost is estimated using the original sale's quantity-weighted historical item cost."},
      {measure:"PAID BASIS",value:"sales.amount_paid is lifetime, not initial collection. Payment allocations are initial sale receipts."},
      {measure:"MISSING LEGACY ALLOCATIONS",value:"A paid-lifetime receipt may have zero original tender and later debt repayments. Reconstruct original tender as current lifetime paid minus all recorded debt repayments; only a positive unallocated original tender is an investigation gap. Channel is UNKNOWN unless an actual allocation row exists."},
      {measure:"PROFIT BASIS",value:"Indicative period bridge: sold-item pretax margin minus actual refunds plus estimated recovered cost minus effective expenses. Refund tax allocation may require manual accounting adjustment."},
      {measure:"PERIOD CUT-OFF",value:"Returns from an older sale still appear when returned during the selected date window. Sales from previous periods are not rebooked."},
      {measure:"REPORT LIMITS",value:"Read-only source evidence; other corrections, liabilities, credit adjustments, external payment confirmation and tax returns need independent reconciliation."}
    ];
    const sections=[
      {name:"System Summary",columns:sumCols,rows:columnRows(metric)},
      {name:"Audit Basis Notes",columns:sumCols,rows:notes},
      {name:"Receipt Reconciliation",columns:receiptCols,rows:sales.receipts},
      {name:"Returns Detail",columns:returnCols,rows:returned.lines},
      {name:"Refund Channels",columns:refundCols,rows:refundChannels},
      {name:"Daily Refunds",columns:refundCols,rows:groupRows(returned.lines,"date",
        ["refund_amount","cash_refund","momo_refund","bank_refund","other_refund"])},
      {name:"Daily Sales",columns:groups,rows:groupRows(outcome.validLines,"date",
        ["net","tax","receipt_amount","cost","profit"])},
      {name:"Staff Performance",columns:groups,rows:groupRows(outcome.validLines,"staff",
        ["net","tax","receipt_amount","cost","profit"])},
      {name:"Payment Channels",columns:groups,rows:groupRows(outcome.validLines,"payment",
        ["net","tax","receipt_amount","cost","profit"])},
      {name:"Collected At Sale",columns:[label("name","Actual Channel"),label("lines","Allocations"),
        label("amount","Collected GHS")],rows:originalAllocations},
      {name:"Debt Collections",columns:[label("date","Paid Date"),label("payment_id","Payment ID"),
        label("receipt","Original Receipt"),label("debt_id","Debt ID"),
        label("payment","Channel"),label("amount","Money Collected"),
        label("collected_by","Received By"),label("customer","Customer")],rows:debts},
      {name:"Expenses",columns:expenseCols,rows:expenses},
      {name:"Item Performance",columns:groups,rows:groupRows(outcome.validLines,"item",
        ["net","tax","receipt_amount","cost","profit"])},
      {name:"Review Exceptions",columns:[label("type","Type"),label("date","Date"),
        label("receipt","Receipt"),label("item","Item"),label("source_id","Source ID"),
        label("issue","Reason",3),label("amount","Amount / Variance")],rows:warnings}
    ];
    const store=stores[0];
    return sendAuditExport(res,{
      format,title:"Spare Parts | Transaction, Returns & Financial Reconciliation",
      description:"Audited sale lines, header reconciliation and all store returns (cash, MoMo, Bank, Other and stock-only), plus dated customer collections and effective expenses. Original receipts and return dates are separate.",
      branch:(store?.code||"Store "+branchId)+" - "+(store?.name||"Spare Parts"),
      period:(from||"Earliest available")+" to "+(to||"Latest available"),
      fromDate:from,toDate:to,generatedBy:req.user?.full_name||req.user?.username,
      filename:"chalin03-transaction-and-returns-"+branchId+"-"+(from||"all")+"-"+(to||"all"),
      columns:cols,rows:sales.lines,metrics:metric,sections
    });
  }catch(e){
    if(connection){try{await connection.rollback()}catch{}}
    console.error("Spare Parts financial transaction reconciliation export error",e);
    if(res.headersSent)return res.end();
    return res.status(500).json({status:"error",message:"Could not reconcile transaction, payment and return evidence for the selected store."});
  }finally{
    if(connection)connection.release();
  }
});
module.exports=router;
