"use strict";

/**
 * Product master price governance, separate from historical sale or purchase prices.
 * Only Administrators (including the original System Administrator/boss) and
 * Auditors may change a stocked product's master prices directly.
 */
function canChangeMasterPriceDirectly(user) {
  const role=String(user?.role || "").trim().toLowerCase();
  return role==="admin" || role==="auditor";
}
function normalizePrice(value) {
  if (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  if (value===null || value===undefined || value==="") return null;
  const n=Number(value);
  return Number.isFinite(n) && n>=0 && n<=9999999999.99 ? n.toFixed(2) : null;
}
function priceSnapshot(product) {
  return {cost_price:normalizePrice(product?.cost_price),selling_price:normalizePrice(product?.selling_price)};
}
function proposedPriceSnapshot(product, values={}) {
  const prior=priceSnapshot(product);
  const cost=Object.prototype.hasOwnProperty.call(values,"cost_price")?normalizePrice(values.cost_price):prior.cost_price;
  const selling=Object.prototype.hasOwnProperty.call(values,"selling_price")?normalizePrice(values.selling_price):prior.selling_price;
  if(cost===null||selling===null)return null;
  return {cost_price:cost,selling_price:selling};
}
function changedPriceFields(before,after) {
  if(!before||!after)return [];
  return ["cost_price","selling_price"].filter(key=>before[key]!==after[key]);
}
function validatePriceChange({product,values}) {
  const before=priceSnapshot(product),after=proposedPriceSnapshot(product,values);
  if(!after)return {ok:false,code:"INVALID_PRODUCT_PRICE",message:"Enter valid non-negative GHS prices with at most two decimal places."};
  const fields=changedPriceFields(before,after);
  if(!fields.length)return {ok:false,code:"PRODUCT_PRICE_UNCHANGED",message:"Enter a new cost or selling price that differs from the current value."};
  return {ok:true,before,after,fields};
}
function changeSummary(before,after){
  return changedPriceFields(before,after).map(key=>{
    const label=key==="cost_price"?"cost":"selling";
    return `${label} GHS ${before[key]} → GHS ${after[key]}`;
  }).join("; ");
}
module.exports={canChangeMasterPriceDirectly,normalizePrice,priceSnapshot,proposedPriceSnapshot,
  changedPriceFields,validatePriceChange,changeSummary};
