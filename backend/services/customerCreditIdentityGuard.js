"use strict";
// Conservative identity gate. A phone match is evidence of possible duplicate
// identity, not proof that two people are the same. No automatic merge.
function ghPhone(value){
  const digits=String(value??"").replace(/[^0-9]/g,"");
  if(/^0[0-9]{9}$/.test(digits))return digits.slice(1);
  if(/^233[0-9]{9}$/.test(digits))return digits.slice(3);
  if(/^00233[0-9]{9}$/.test(digits))return digits.slice(5);
  if(/^[0-9]{9}$/.test(digits))return digits;
  return null;
}
function blocked(code,message){return Object.assign(new Error(message),{statusCode:409,code});}
async function assertUnambiguousCreditIdentity(conn,{customerId,phone}){
  const suffix=ghPhone(phone);
  if(!suffix)throw blocked("CREDIT_IDENTITY_UNVERIFIED","A valid customer phone is required before credit can be authorized.");
  // Only outstanding debt and active credit commitments are relevant.
  // An ordinary matching customer record alone does not block checkout.
  const [matches]=await conn.query(
    "SELECT id FROM customers WHERE id<>? AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]',''),9)=? ORDER BY id FOR UPDATE",
    [customerId,suffix]);
  const ids=matches.map(row=>Number(row.id));
  if(ids.length){
    const placeholders=ids.map(()=>"?").join(",");
    const [debt]=await conn.query(
      "SELECT d.id FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id WHERE COALESCE(s.customer_id,d.customer_id) IN ("+placeholders+") AND d.balance>0 LIMIT 1 FOR UPDATE",ids);
    const [reserved]=await conn.query(
      "SELECT id FROM customer_credit_approval_requests WHERE customer_id IN ("+placeholders+") AND status='approved' AND expires_at>UTC_TIMESTAMP() LIMIT 1 FOR UPDATE",ids);
    if(debt.length||reserved.length)throw blocked("CREDIT_IDENTITY_RECONCILIATION_REQUIRED","A matching debtor has outstanding debt or approved credit. Review the debtor account before granting additional credit.");
  }
  const [legacy]=await conn.query(
    "SELECT d.id FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id WHERE COALESCE(s.customer_id,d.customer_id) IS NULL AND d.balance>0 AND RIGHT(REGEXP_REPLACE(COALESCE(d.customer_phone,''),'[^0-9]',''),9)=? LIMIT 1 FOR UPDATE",
    [suffix]);
  if(legacy.length)throw blocked("CREDIT_LEGACY_DEBT_RECONCILIATION_REQUIRED","A matching unlinked debt requires identity reconciliation before additional credit.");
}
module.exports={ghPhone,assertUnambiguousCreditIdentity};
