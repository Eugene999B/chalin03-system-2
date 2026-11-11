"use strict";

/**
 * A return is linked to immutable sale-item prices, not the current catalogue
 * price or the HIGHEST unit price among the original lines. The receipt's
 * sale-level discount and tax belong proportionately to those lines.
 *
 * Results are in GHS (two decimals), with strict integer-pesewa arithmetic.
 * Stock-only returns do not constitute a customer cash refund.
 */
const toCents = value => {
  const text=String(value ?? "0").trim();
  // A financial receipt is a 2-decimal amount. Reject fractional pesewas
  // rather than letting Number.toFixed silently change what was recorded.
  if(!/^(?:0|[1-9]\\d{0,12})(?:\\.\\d{1,2})?$/.test(text))
    throw new Error("Financial return source has an invalid 2-decimal amount.");
  const [whole,fraction=""]=text.split(".");
  const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(cents))
    throw new Error("Financial return value exceeds safe accounting precision.");
  return cents;
};
const asMoney = c => Number((c/100).toFixed(2));
const roundedShare=(part,whole,total)=>{
  if(!Number.isSafeInteger(part)||!Number.isSafeInteger(whole)||
      !Number.isSafeInteger(total)||whole<=0||part<0||total<0)
    throw new Error("Historical return item value cannot be reconciled.");
  const rounded=(BigInt(total)*BigInt(part)+BigInt(whole)/2n)/BigInt(whole);
  const asNumber=Number(rounded);
  if(!Number.isSafeInteger(asNumber))throw new Error("Financial allocation exceeds safe precision.");
  return asNumber;
};
function calculateReturnLimit({
  saleSubtotal,saleDiscount,saleTax,saleTotal,
  historicalItemGross,soldQuantity,returnQuantity,
  previouslyRefundedForItem=0,
}){
  const subtotal=toCents(saleSubtotal);
  const discount=toCents(saleDiscount);
  const tax=toCents(saleTax);
  const total=toCents(saleTotal);
  const itemGross=toCents(historicalItemGross);
  const paidAlready=toCents(previouslyRefundedForItem);
  const sold=Number(soldQuantity),returned=Number(returnQuantity);
  if(!Number.isSafeInteger(sold)||sold<=0||
     !Number.isSafeInteger(returned)||returned<=0||returned>sold)
    throw new Error("Returned quantity exceeds supported original sale quantity.");
  if(subtotal<=0||discount>subtotal||itemGross>subtotal||
     subtotal-discount+tax!==total)
    throw new Error("The original receipt requires financial reconciliation before this refund.");
  // Split the ENTIRE receipt charge over source item gross amounts. This
  // correctly accounts for both whole-receipt discount and whole-receipt tax.
  const itemCustomerValue=roundedShare(itemGross,subtotal,total);
  const quantityValue=roundedShare(returned,sold,itemCustomerValue);
  const remainingCustomerValue=Math.max(0,itemCustomerValue-paidAlready);
  const allowed=Math.min(quantityValue,remainingCustomerValue);
  return {
    unit_value_estimate:asMoney(roundedShare(1,sold,itemCustomerValue)),
    original_item_customer_value:asMoney(itemCustomerValue),
    estimated_return_amount:asMoney(quantityValue),
    previously_refunded:asMoney(paidAlready),
    remaining_item_refund_value:asMoney(remainingCustomerValue),
    maximum_refund:asMoney(allowed),
  };
}
module.exports={calculateReturnLimit};
