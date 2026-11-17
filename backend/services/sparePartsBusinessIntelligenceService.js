"use strict";

const { pool } = require("../config/db");
const { buildAccountingIntelligence } = require("./accountingIntelligenceService");
const { buildSales, money, datePart } = require("./sparePartsFinancialAuditMath");

class IntelligenceReportError extends Error {
  constructor(code,message,statusCode=400){super(message);this.code=code;this.statusCode=statusCode;}
}
function validDate(v){
  const text=String(v||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
  const date=new Date(text+"T00:00:00Z");
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===text?text:null;
}
function changeDate(day,offset){
  const date=new Date(day+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
function reportDates(fromInput,toInput,today=new Date().toISOString().slice(0,10)){
  const from=fromInput?validDate(fromInput):changeDate(today,-29);
  const to=toInput?validDate(toInput):today;
  if(!from||!to||from>to)throw new IntelligenceReportError("REPORT_PERIOD_INVALID","Choose valid From and To dates.");
  const days=Math.round((new Date(to)-new Date(from))/86400000)+1;
  if(days>366)throw new IntelligenceReportError("REPORT_PERIOD_TOO_LONG","Choose a reporting period of 366 days or less.",422);
  return {from,to,days,previousFrom:changeDate(from,-days),previousTo:changeDate(from,-1)};
}
function selectedBranch(user){
  const branch=Number(user?.branch_id);
  if(!Number.isSafeInteger(branch)||branch<=0)
    throw new IntelligenceReportError("STORE_SELECTION_REQUIRED","Select your authorised Spare Parts store before exporting.");
  return branch;
}
function num(x){const v=Number(x||0);return Number.isFinite(v)?v:0}
function sum(rows,key){return money(rows.reduce((a,b)=>a+num(b[key]),0))}
function pct(a,b){return b>0?money(100*a/b):null}
function gh(v){return "GHS "+num(v).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2})}
function group(rows,key,measure){
  const out=new Map();
  for(const row of rows){
    const label=String(row[key]||"Unspecified").slice(0,120);
    out.set(label,money((out.get(label)||0)+num(row[measure])));
  }
  return [...out.entries()].map(([label,value])=>({label,value}))
    .sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
}
function cols(...pairs){return pairs.map(([key,label])=>({key,label}));}
function limit(data,name){
  if(data.length>12000)throw new IntelligenceReportError("REPORT_DATA_VOLUME",
    "More than 12,000 "+name+" rows. Narrow the report period.",422);
  return data;
}
async function read(conn,sql,params,name){
  const [results]=await conn.query(sql,params);
  return limit(results,name);
}
async function loadEvidence(branchId,p){
  const conn=await pool.getConnection();
  let started=false;
  try{
    await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION READ ONLY");started=true;
    const [[branchRows],[sales],[allocations],[debtPaid],[refunds],[expenses],[openDebts],[products],[prev]] = await Promise.all([
      conn.query("SELECT id,name,code FROM branches WHERE id=? LIMIT 1",[branchId]),
      read(conn,[
        "SELECT s.id AS sale_id,s.created_at,s.receipt_number,s.customer_name,s.payment_type,",
        "s.sale_status,s.is_voided,s.subtotal,s.discount_amount,s.tax_amount,s.total,",
        "s.amount_paid,s.balance,0 AS debt_payments_lifetime,u.full_name AS staff_name,",
        "si.id AS source_line,si.product_id,si.product_name,si.quantity,",
        "si.unit_price,si.line_total,si.cost_price_at_sale",
        "FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id",
        "LEFT JOIN users u ON u.id=s.staff_id",
        "WHERE s.branch_id=? AND s.created_at>=? AND s.created_at<DATE_ADD(?,INTERVAL 1 DAY)",
        "ORDER BY s.created_at,s.id,si.id LIMIT 12001"
      ].join(" "),[branchId,p.from,p.to],"sale line"),
      read(conn,[
        "SELECT s.created_at,spa.payment_channel,spa.amount FROM sale_payment_allocations spa",
        "JOIN sales s ON s.id=spa.sale_id AND s.branch_id=spa.branch_id",
        "WHERE s.branch_id=? AND s.sale_status='completed' AND COALESCE(s.is_voided,0)=0",
        "AND s.created_at>=? AND s.created_at<DATE_ADD(?,INTERVAL 1 DAY) LIMIT 12001"
      ].join(" "),[branchId,p.from,p.to],"payment allocation"),
      read(conn,[
        "SELECT dp.paid_at,dp.amount,dp.payment_method,s.customer_name",
        "FROM debt_payments dp JOIN debts d ON d.id=dp.debt_id AND d.branch_id=dp.branch_id",
        "LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id",
        "WHERE dp.branch_id=? AND dp.paid_at>=? AND dp.paid_at<DATE_ADD(?,INTERVAL 1 DAY) LIMIT 12001"
      ].join(" "),[branchId,p.from,p.to],"debt payment"),
      read(conn,[
        "SELECT r.id,r.returned_at,r.return_type,r.refund_amount,r.refund_method,r.quantity,",
        "r.sale_id,r.product_id FROM returns r",
        "WHERE r.branch_id=? AND r.returned_at>=? AND r.returned_at<DATE_ADD(?,INTERVAL 1 DAY)",
        "ORDER BY r.id LIMIT 12001"
      ].join(" "),[branchId,p.from,p.to],"return"),
      read(conn,[
        "SELECT id,category,amount,is_voided,is_reversal,expense_date",
        "FROM expenses WHERE branch_id=? AND expense_date>=? AND expense_date<=?",
        "ORDER BY id LIMIT 12001"
      ].join(" "),[branchId,p.from,p.to],"expense"),
      read(conn,[
        "SELECT id,customer_id,customer_name,balance,created_at,due_date",
        "FROM debts WHERE branch_id=? AND balance>0 ORDER BY balance DESC LIMIT 12001"
      ].join(" "),[branchId],"open debt"),
      read(conn,[
        "SELECT id,name,quantity,low_stock_threshold,cost_price",
        "FROM products WHERE branch_id=? ORDER BY id LIMIT 12001"
      ].join(" "),[branchId],"product"),
      conn.query([
        "SELECT COUNT(*) AS receipts,COALESCE(SUM(total),0) AS value",
        "FROM sales WHERE branch_id=? AND sale_status='completed'",
        "AND COALESCE(is_voided,0)=0 AND created_at>=?",
        "AND created_at<DATE_ADD(?,INTERVAL 1 DAY)"
      ].join(" "),[branchId,p.previousFrom,p.previousTo])
    ]);
    if(!branchRows.length)throw new IntelligenceReportError("STORE_NOT_FOUND","Selected store was not found.",404);
    await conn.commit();started=false;
    return {branch:branchRows[0],sales,allocations,debtPaid,refunds,expenses,openDebts,products,previous:prev[0]||{}};
  }catch(error){if(started)await conn.rollback().catch(()=>{});throw error;}
  finally{conn.release();}
}
function buildVisualModel(evidence,p,generatedAt){
  const sales=buildSales(evidence.sales);
  const active=sales.receipts.filter(r=>r.active);
  const lines=sales.lines.filter(r=>!r.voided&&!r.missing_item);
  const missingCost=evidence.sales.filter(r=>r.source_line!=null
    &&String(r.sale_status).toLowerCase()==="completed"&&!Number(r.is_voided)
    &&(r.cost_price_at_sale==null||num(r.cost_price_at_sale)<=0));
  const costCoverage=pct(lines.length-missingCost.length,lines.length);
  const margin=costCoverage===100?sum(lines,"profit"):null;
  const invoiceTotal=sum(active,"total"),tax=sum(active,"tax");
  const pretax=sum(active,"pretax_sales"),historicalCost=sum(lines,"cost");
  const validRefunds=evidence.refunds.filter(r=>String(r.return_type||"").toLowerCase()==="refund");
  const refundTotal=sum(validRefunds,"refund_amount");
  const collectedAtSale=sum(evidence.allocations,"amount");
  const debtCollected=sum(evidence.debtPaid,"amount");
  const collectedNet=money(collectedAtSale+debtCollected-refundTotal);
  const activeExpenses=evidence.expenses.filter(r=>!num(r.is_voided)&&!num(r.is_reversal));
  const expenseTotal=sum(activeExpenses,"amount");
  const openDebtTotal=sum(evidence.openDebts,"balance");
  const asOf=generatedAt.slice(0,10);
  const ageDetails=evidence.openDebts.map(d=>{
    const due=d.due_date?datePart(d.due_date):"";
    const late=due?Math.round((new Date(asOf)-new Date(due))/86400000):null;
    const bucket=late===null?"No due date":late<=0?"Not yet due":late<=30?"1–30 overdue":
      late<=60?"31–60 overdue":late<=90?"61–90 overdue":"90+ overdue";
    return {...d,late,bucket};
  });
  const aging=["Not yet due","1–30 overdue","31–60 overdue","61–90 overdue","90+ overdue","No due date"]
    .map(bucket=>({bucket,accounts:ageDetails.filter(x=>x.bucket===bucket).length,
      balance:sum(ageDetails.filter(x=>x.bucket===bucket),"balance")}));
  const overdueTotal=sum(ageDetails.filter(x=>x.late>0),"balance");
  const byCustomer=new Map();
  for(const debt of ageDetails){
    const key=num(debt.customer_id)>0?"id:"+debt.customer_id:"name:"+String(debt.customer_name||"").toLowerCase();
    const item=byCustomer.get(key)||{customer:String(debt.customer_name||"Unidentified").slice(0,140),
      invoices:0,balance:0,overdue:0,oldest_late:0};
    item.invoices++;
    item.balance=money(item.balance+num(debt.balance));
    if(debt.late>0){item.overdue=money(item.overdue+num(debt.balance));
      item.oldest_late=Math.max(item.oldest_late,debt.late);}
    byCustomer.set(key,item);
  }
  const debtors=[...byCustomer.values()].sort((a,b)=>b.overdue-a.overdue||b.balance-a.balance);
  const days=[];
  for(let day=p.from;day<=p.to;day=changeDate(day,1)){
    days.push({date:day,invoices:0,at_sale:0,debt_paid:0,refunds:0,net_money_in:0});
  }
  const indexed=new Map(days.map(x=>[x.date,x]));
  const byDay=(dataset,dateKey,key,outKey)=>{
    for(const row of dataset){const day=indexed.get(datePart(row[dateKey]));
      if(day)day[outKey]=money(day[outKey]+num(row[key]));}
  };
  byDay(active,"date","total","invoices");
  byDay(evidence.allocations,"created_at","amount","at_sale");
  byDay(evidence.debtPaid,"paid_at","amount","debt_paid");
  byDay(validRefunds,"returned_at","refund_amount","refunds");
  days.forEach(d=>d.net_money_in=money(d.at_sale+d.debt_paid-d.refunds));
  const productMap=new Map();
  for(const line of lines){
    const key=String(line.product_id||line.item);
    const result=productMap.get(key)||{product_id:line.product_id,item:line.item,
      units:0,net_sales:0,cost:0,provisional_margin:0,lines:0};
    result.units+=num(line.qty);
    result.net_sales=money(result.net_sales+num(line.net));
    result.cost=money(result.cost+num(line.cost));
    result.provisional_margin=money(result.provisional_margin+num(line.profit));
    result.lines++;
    productMap.set(key,result);
  }
  const products=[...productMap.values()].sort((a,b)=>b.net_sales-a.net_sales);
  const expenses=group(activeExpenses,"category","amount");
  const tender=group(evidence.allocations.map(r=>({...r,channel:r.payment_channel}))
    .concat(evidence.debtPaid.map(r=>({...r,channel:r.payment_method}))),"channel","amount");
  const lowStock=evidence.products.filter(x=>x.low_stock_threshold!=null
    &&num(x.quantity)<=num(x.low_stock_threshold));
  const negatives=evidence.products.filter(x=>num(x.quantity)<0);
  const costMissingProducts=evidence.products.filter(x=>x.cost_price==null||num(x.cost_price)<=0);
  const inventoryCost=money(evidence.products.reduce((sum,x)=>sum+num(x.quantity)*num(x.cost_price),0));
  const previousTotal=money(evidence.previous.value);
  const change=previousTotal>0?money(100*(invoiceTotal-previousTotal)/previousTotal):null;
  const findings=[];
  function finding(level,area,observation,action,evidenceRef){
    findings.push({priority:level,area,observation,action,evidence:evidenceRef});
  }
  finding(overdueTotal>0?"HIGH":"INFO","Collections",
    "Overdue customer balance: "+gh(overdueTotal)+".",
    "Follow up by actual due date. Contact the largest overdue balances first.","debts.due_date, debts.balance");
  finding(missingCost.length?"HIGH":"INFO","Margin quality",
    missingCost.length+" selected sale lines have missing/zero historical cost.",
    "Do not certify gross or net profit until missing historical purchase costs are reviewed.",
    "sale_items.cost_price_at_sale");
  finding(sales.exceptions.length?"HIGH":"INFO","Receipt accuracy",
    sales.exceptions.length+" original sales receipt mathematics require review.",
    "Compare receipt headers against historical item lines and assigned discounts/tax.",
    "Sales and sale_items");
  finding(negatives.length?"HIGH":"INFO","Stock",
    negatives.length+" current products have negative stock.",
    "Verify physical counts and stock-movement sources before approval.","products.quantity");
  finding(lowStock.length?"MEDIUM":"INFO","Stock replenishment",
    lowStock.length+" products are at/below their reorder threshold.",
    "Confirm supplier lead time, stock counts and replenishment budget.","products.low_stock_threshold");
  finding("INFO","Cash movement",
    "Recorded receipts at sale "+gh(collectedAtSale)+", debt receipts "+gh(debtCollected)+
      ", and financial refunds out "+gh(refundTotal)+".",
    "Reconcile with daily closings and provider/bank statements. Not a bank balance.",
    "sale_payment_allocations, debt_payments, returns");
  const narrative=[
    {topic:"Sales performance",explanation:active.length+" completed receipts produced "+
      gh(invoiceTotal)+" of invoice value including tax. Sales before tax were "+gh(pretax)+
      ". Sale value is not the same as money actually collected."},
    {topic:"Collections and cash exposure",explanation:
      "Recorded original sale-day receipts were "+gh(collectedAtSale)+
      " and later debt repayments dated in this period were "+gh(debtCollected)+
      ". Financial refunds were "+gh(refundTotal)+". Their difference, "+
      gh(collectedNet)+", excludes unverified channel settlements, expense payments and supplier payments."},
    {topic:"Customer debt",explanation:
      "The current open-debt snapshot is "+gh(openDebtTotal)+
      ", of which "+gh(overdueTotal)+" has passed its recorded due date. "+
      "Open debt is a snapshot at download time, not new credit sales of this report period."},
    {topic:"Gross margin reliability",explanation:margin==null
      ? "Historical cost is incomplete, so the report deliberately withholds a gross-profit figure. "+
        "Recorded cost coverage is "+(costCoverage===null?"not measurable":costCoverage+"%")+"."
      : "Historical gross margin on sold items before returns/expenses is "+gh(margin)+
        ". This is not net profit or an accountant-certified statement."},
    {topic:"Expenses and purchasing",explanation:
      "Active recorded business expenses in the period are "+gh(expenseTotal)+
      ". Voided/reversal records are excluded. Purchase expenditure is not automatically treated as cost of goods sold."},
    {topic:"Inventory controls",explanation:
      evidence.products.length+" products are in the current store register, with estimated catalogue-cost value "+
      gh(inventoryCost)+". "+lowStock.length+" products require restock review and "+
      negatives.length+" have negative quantity."},
    {topic:"Previous period comparison",explanation:change===null?
      "The preceding equal-length period had no comparable sale total, so growth is not computed.":
      "Invoice value changed "+(change>=0?"+":"")+change+"% against the immediately preceding "+
      p.days+" days. This compares sales booked, not actual collections."},
  ];
  const chartLines=days.filter((x,i)=>p.days<=31||i%Math.ceil(p.days/31)===0);
  const charts=[
    {title:"Daily completed invoice value",kind:"line",unit:"GHS incl. tax",
      note:"By sale date. This is not a cash collection chart.",
      points:chartLines.map(x=>({label:x.date.slice(5),value:x.invoices}))},
    {title:"Top selling parts",kind:"bar",unit:"GHS excl. tax",
      note:"Historical line sales with receipt-level discounts allocated.",
      points:products.slice(0,8).map(x=>({label:x.item,value:x.net_sales}))},
    {title:"Recorded receipts and refunds",kind:"bar",unit:"GHS",
      note:"At-sale receipts plus later debt collections; refunds are money out.",
      points:[{label:"At-sale received",value:collectedAtSale},{label:"Debt collected",value:debtCollected},
        {label:"Refunds paid",value:refundTotal}]},
    {title:"Current debt by due-date age",kind:"bar",unit:"GHS",
      note:"As-of-download snapshot. No due date shown separately.",
      points:aging.map(x=>({label:x.bucket,value:x.balance}))},
    {title:"Active expense categories",kind:"bar",unit:"GHS",
      note:"Excludes voided/reversal expenses; not audited cash spend.",
      points:expenses.slice(0,8).map(x=>({label:x.label,value:x.value}))},
  ];
  const metrics=[
    ["Completed sales receipts",active.length],["Invoice value incl tax (GHS)",invoiceTotal],
    ["Sales before tax (GHS)",pretax],["Invoice tax (GHS)",tax],
    ["At-sale recorded collections (GHS)",collectedAtSale],
    ["Debt payments in period (GHS)",debtCollected],
    ["Refunds paid out (GHS)",refundTotal],
    ["Recorded net collections after refunds (GHS)",collectedNet],
    ["Current open debt (GHS)",openDebtTotal],
    ["Past-due debt (GHS)",overdueTotal],
    ["Active expense total (GHS)",expenseTotal],
    ["Historical cost of sold items (GHS)",sum(lines,"cost")],
    ["Historical gross margin before returns (GHS)",margin==null?"Withheld: missing historical costs":margin],
    ["Historical cost coverage (%)",costCoverage==null?"No sold lines":costCoverage],
    ["Current inventory at recorded cost (GHS)",inventoryCost],
    ["Low-stock products now",lowStock.length],
    ["Negative-stock products now",negatives.length],
    ["Receipt math exceptions",sales.exceptions.length],
  ];
  const cards=[
    {label:"SALES INCL TAX",value:invoiceTotal,note:"GHS · sale-date",isMoney:true},
    {label:"AT-SALE RECEIPTS",value:collectedAtSale,note:"GHS · recorded",isMoney:true},
    {label:"DEBT REPAYMENTS",value:debtCollected,note:"GHS · payment-date",isMoney:true},
    {label:"REFUNDS OUT",value:refundTotal,note:"GHS · financial refunds",isMoney:true},
    {label:"OPEN CUSTOMER DEBT",value:openDebtTotal,note:"GHS · current snapshot",isMoney:true},
    {label:"OVERDUE",value:overdueTotal,note:"GHS · due-date based",isMoney:true},
    {label:"LOW STOCK",value:lowStock.length,note:"Current inventory",isMoney:false},
    {label:"AUDIT EXCEPTIONS",value:sales.exceptions.length,note:"Receipt math flags",isMoney:false},
  ];
  const sourceNotes=[
    {basis:"Sales",detail:"Historical receipts dated by sale creation. Tax and discounts allocated across historical lines in pesewas."},
    {basis:"Collections",detail:"At-sale payment allocations use sale date; debt payments use actual recorded payment date. No lifetime paid double-count."},
    {basis:"Returns",detail:"Only return_type=refund causes cash-out; stock-only returns do not reduce cash."},
    {basis:"Debt aging",detail:"Unpaid balances are current snapshot, aged against due_date. No due date is distinct from not overdue."},
    {basis:"Inventory",detail:"Quantities and catalogue-cost valuations are current snapshots, not stock value at period close."},
    {basis:"Profit",detail:"Historical cost gaps prevent certified gross profit. Expense totals do not equal statutory net profit."},
    {basis:"Cash",detail:"Recorded payments are not verified external bank/MoMo settlements and exclude other cash outflows."},
    {basis:"Timing",detail:"Raw transaction evidence is read in one repeatable-read MySQL snapshot. System-wide accounting views have separate controls."},
  ];
  const sections=[
    {name:"Business Interpretation",columns:cols(["topic","Management topic"],["explanation","Evidence-based explanation"]),rows:narrative},
    {name:"Actions and Warnings",columns:cols(["priority","Priority"],["area","Area"],
      ["observation","What was observed"],["action","Suggested next step"],["evidence","Source"]),rows:findings},
    {name:"Daily Sales and Cash",columns:cols(["date","Date"],["invoices","Invoice value incl tax"],
      ["at_sale","At-sale collections"],["debt_paid","Debt collections"],
      ["refunds","Refunds out"],["net_money_in","Net recorded in"]),rows:days},
    {name:"Top Product Results",columns:cols(["product_id","Product ID"],["item","Product"],
      ["lines","Sale lines"],["units","Units"],["net_sales","Sales excl tax"],
      ["cost","Recorded historical cost"],["provisional_margin","Provisional margin"]),rows:products.slice(0,150)},
    {name:"Receipts by Channel",columns:cols(["label","Recorded channel"],["value","Collected GHS"]),rows:tender},
    {name:"Debt Customer Priorities",columns:cols(["customer","Customer"],["invoices","Open debts"],
      ["balance","Outstanding"],["overdue","Past-due"],["oldest_late","Oldest days late"]),
      rows:debtors.slice(0,150)},
    {name:"Debt Aging",columns:cols(["bucket","Due-date age"],["accounts","Debt records"],
      ["balance","Outstanding GHS"]),rows:aging},
    {name:"Expenses by Category",columns:cols(["label","Expense category"],["value","Active expense GHS"]),rows:expenses},
    {name:"Restock Watchlist",columns:cols(["id","Product ID"],["name","Product"],
      ["quantity","On hand"],["low_stock_threshold","Reorder threshold"],
      ["cost_price","Catalogue cost"]),rows:lowStock.slice(0,200)},
    {name:"Receipt Exceptions",columns:cols(["type","Record type"],["date","Date"],
      ["receipt","Receipt"],["source_id","Source ID"],["issue","Issue"],
      ["amount","Variance"]),rows:sales.exceptions.slice(0,200)},
    {name:"Calculation Notes",columns:cols(["basis","Basis"],["detail","Disclosure"]),rows:sourceNotes},
  ];
  return {metrics,cards,charts,sections,narrative,
    summary:{invoiceTotal,pretax,collectedAtSale,debtCollected,refundTotal,collectedNet,
      openDebtTotal,overdueTotal,expenseTotal,inventoryCost,margin,missingHistoricalCosts:missingCost.length,
      lowStock:lowStock.length,negativeStock:negatives.length},
    originalEvents:{sales:active.length,lines:lines.length,
      returns:evidence.refunds.length,debtPayments:evidence.debtPaid.length,
      expenses:activeExpenses.length,openDebts:evidence.openDebts.length},
  };
}
async function buildBusinessIntelligence(req){
  const branchId=selectedBranch(req.user);
  const period=reportDates(req.query?.from,req.query?.to);
  const data=await loadEvidence(branchId,period);
  const now=new Date().toISOString();
  const model=buildVisualModel(data,period,now);
  return {...model,branch:String(data.branch.code||"Store "+branchId)+" - "+
    String(data.branch.name||"Spare Parts"),
    period,generatedAt:now,branchId};
}
module.exports={IntelligenceReportError,validDate,reportDates,selectedBranch,
  loadEvidence,buildVisualModel,buildBusinessIntelligence};
