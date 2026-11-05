"use strict";
const express=require("express");
const {pool}=require("../config/db");
const {requireRole}=require("../middleware/roleMiddleware");
const {sendAuditExport}=require("../services/sparePartsAuditExportService");
const router=express.Router();

const asNumber=v=>Number(v||0);
const amount=v=>Math.round((Number(v)||0)*100)/100;
const date=v=>v?new Date(v).toISOString().slice(0,10):"";
const isDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
const safeBranch=req=>Number.isSafeInteger(Number(req.user?.branch_id))&&Number(req.user.branch_id)>0?Number(req.user.branch_id):null;

router.get("/transaction-history",requireRole("admin","manager","auditor"),async(req,res)=>{
  try{
    const branchId=safeBranch(req);
    if(!branchId)return res.status(400).json({status:"error",message:"Select an authorised Spare Parts store before exporting."});
    const from=String(req.query.from||"").trim(), to=String(req.query.to||"").trim();
    if((from&&!isDate(from))||(to&&!isDate(to))||(from&&to&&from>to))
      return res.status(400).json({status:"error",message:"Choose a valid reporting date range."});
    const where=["s.branch_id = ?"],params=[branchId];
    if(from){where.push("DATE(s.created_at)>=?");params.push(from)}
    if(to){where.push("DATE(s.created_at)<=?");params.push(to)}
    const [raw]=await pool.query([
      "SELECT s.id AS sale_id,s.created_at,s.receipt_number,s.customer_name,s.payment_type,s.sale_status,s.is_voided,",
      "s.subtotal,s.discount_amount,s.tax_amount,s.total,",
      "staff.full_name AS staff_name,si.id AS source_line,si.product_id,si.product_name,si.quantity,",
      "si.unit_price,si.line_total,si.cost_price_at_sale",
      "FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id",
      "LEFT JOIN users staff ON staff.id=s.staff_id",
      "WHERE "+where.join(" AND "),
      "ORDER BY s.created_at DESC,s.id DESC,si.id ASC LIMIT 20001"
    ].join(" "),params);
    if(raw.length>20000)return res.status(422).json({status:"error",code:"EXPORT_RANGE_TOO_LARGE",message:"More than 20,000 transaction lines match. Select a shorter date range."});
    const lines=raw.map(s=>{
      const voided=Number(s.is_voided)===1||["voided","cancelled"].includes(String(s.sale_status||"").toLowerCase());
      const units=asNumber(s.quantity),gross=amount(s.line_total),cost=amount(units*asNumber(s.cost_price_at_sale));
      const discount=asNumber(s.subtotal)>0?amount(gross*asNumber(s.discount_amount)/asNumber(s.subtotal)):0;
      const tax=asNumber(s.subtotal)>0?amount(gross*asNumber(s.tax_amount)/asNumber(s.subtotal)):0;
      const net=voided?0:amount(gross-discount);
      const realizedCost=voided?0:cost,profit=amount(net-realizedCost);
      return {
        sale_id:Number(s.sale_id),source_line:s.source_line==null?"":Number(s.source_line),
        date:date(s.created_at),receipt:s.receipt_number||"",item:s.product_name||"[Missing sale item]",
        product_id:s.product_id==null?"":Number(s.product_id),
        unit_price:asNumber(s.unit_price),qty:units,gross,
        discount:voided?0:discount,net,tax:voided?0:tax,unit_cost:asNumber(s.cost_price_at_sale),
        cost:realizedCost,profit,margin:net>0?amount(profit*100/net):0,
        payment:s.payment_type||"Unknown",staff:s.staff_name||"Unassigned",
        customer:s.customer_name||"Walk-in",status:voided?"Voided":(s.sale_status||"Recorded"),
        recorded_gross:gross,voided,missing_item:s.source_line==null,
      };
    });
    const valid=lines.filter(x=>!x.voided&&!x.missing_item);
    const uniq=new Set(valid.map(x=>x.sale_id));
    const sum=(xs,key)=>amount(xs.reduce((n,x)=>n+asNumber(x[key]),0));
    const net=sum(valid,"net"),cost=sum(valid,"cost"),profit=sum(valid,"profit");
    const agg=(key)=>{const map=new Map();valid.forEach(x=>{const k=String(x[key]||"Unspecified");const z=map.get(k)||{name:k,lines:0,qty:0,net:0,cost:0,profit:0};z.lines++;z.qty+=x.qty;z.net+=x.net;z.cost+=x.cost;z.profit+=x.profit;map.set(k,z)});return [...map.values()].map(x=>({...x,net:amount(x.net),cost:amount(x.cost),profit:amount(x.profit),margin:x.net>0?amount(x.profit*100/x.net):0})).sort((a,b)=>b.net-a.net)};
    const summaryCols=[{key:"name",label:"Group",weight:2},{key:"lines",label:"Lines"},{key:"qty",label:"Units"},{key:"net",label:"Net sales (GHS)"},{key:"cost",label:"Cost (GHS)"},{key:"profit",label:"Profit (GHS)"},{key:"margin",label:"Margin %"}];
    const cols=[
      {key:"date",label:"Transaction Date",weight:1.5},{key:"receipt",label:"Receipt",weight:1.6},
      {key:"item",label:"Item Name",weight:3},{key:"unit_price",label:"Unit Price",weight:1},
      {key:"qty",label:"Qty",weight:.6},{key:"gross",label:"Line Amount",weight:1},
      {key:"discount",label:"Allocated Discount",weight:1},{key:"net",label:"Net Amount",weight:1},
      {key:"unit_cost",label:"Unit Cost",weight:1},{key:"cost",label:"Cost",weight:1},
      {key:"profit",label:"Gross Profit",weight:1},{key:"margin",label:"Profit Margin %",weight:.9},
      {key:"payment",label:"Payment",weight:1},{key:"staff",label:"Staff",weight:1.4},
      {key:"customer",label:"Customer",weight:1.4},{key:"status",label:"Sale Status",weight:1},
      {key:"source_line",label:"Source Line ID",weight:1},{key:"sale_id",label:"Sale ID",weight:1},
    ];
    const warnings=lines.filter(x=>x.voided||x.missing_item||(!x.voided&&x.profit<0)).map(x=>({
      receipt:x.receipt,item:x.item,reason:x.voided?"Voided/cancelled — excluded from realised totals":x.missing_item?"No historical sale-item row":"Sale recorded below cost — investigate",source_line:x.source_line
    }));
    const [storeRows]=await pool.query("SELECT name,code FROM branches WHERE id=? LIMIT 1",[branchId]);
    const store=storeRows[0];
    return sendAuditExport(res,{
      format:req.query.format,title:"Spare Parts | Transaction History & Profit Investigation",
      description:"Historical sale-item evidence. Per-receipt discount and tax are allocated proportionally for analysis; figures are before any separate customer returns. Voided receipts are shown but excluded from realised totals.",
      branch:(store?.code||"Store "+branchId)+" - "+(store?.name||"Spare Parts"),
      period:(from||"Earliest")+" to "+(to||"Latest"),generatedBy:req.user?.full_name||req.user?.username,
      filename:"chalin03-transaction-history-"+branchId+"-"+(from||"all")+"-"+(to||"all"),
      columns:cols,rows:lines,
      metrics:[["Valid receipts",uniq.size],["Total source lines",lines.length],["Units sold",sum(valid,"qty")],["Net sales before returns (GHS)",net],["Historical cost (GHS)",cost],["Estimated gross profit (GHS)",profit],["Gross margin (%)",net>0?amount(profit*100/net):0],["Excluded/exception lines",warnings.length]],
      sections:[
        {name:"Daily Totals",columns:summaryCols,rows:agg("date")},
        {name:"Staff Performance",columns:summaryCols,rows:agg("staff")},
        {name:"Payment Channels",columns:summaryCols,rows:agg("payment")},
        {name:"Item Performance",columns:summaryCols,rows:agg("item")},
        {name:"Review Exceptions",columns:[{key:"receipt",label:"Receipt"},{key:"item",label:"Item"},{key:"reason",label:"Review reason"},{key:"source_line",label:"Source Line"}],rows:warnings}
      ]
    });
  }catch(e){console.error("Spare Parts transaction history export error",e);return res.status(500).json({status:"error",message:"Could not produce the transaction history for this store."})}
});
module.exports=router;
