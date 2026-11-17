"use strict";

const { normalizeGhanaPhone } = require("./smsService");

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ").slice(0,150);
}
function isRealTwoPartName(value) {
  const name=cleanName(value);
  const words=name.split(/\s+/u).filter(Boolean);
  const readable=words.filter(word=>/[\p{L}]{2,}/u.test(word));
  const distinct=new Set(readable.map(word=>word.toLocaleLowerCase("en")));
  return readable.length>=2 && distinct.size>=2 && !/^\d+$/u.test(name);
}
function cleanPhone(value) {
  return normalizeGhanaPhone(value) || "";
}
function requiredIdentityFields({name,phone}) {
  const fields=[];
  if(!isRealTwoPartName(name)) fields.push("customer_name");
  if(!cleanPhone(phone)) fields.push("customer_phone");
  return fields;
}
function makeIdentityError(fields) {
  const missing=[...new Set(fields)];
  const error=new Error(
    "Complete this debtor's real first and last names and valid Ghana mobile number before recording another debt or payment. The existing debt balance will not change."
  );
  error.code="DEBT_CUSTOMER_IDENTITY_REQUIRED";
  error.statusCode=409;
  error.missing_fields=missing;
  return error;
}
/**
 * Correct ONLY incomplete customer identity under the same write-locked payment
 * transaction. Linked customers use the master profile; unlinked historic debts
 * use only the debt's current identity fields. Historical sale receipts are
 * deliberately never rewritten and financial balances are not touched.
 */
async function ensureDebtCustomerIdentity(connection,{branchId,debts,body,req,writeAuditEvent}){
  const debt=debts?.[0];
  if(!debt)throw new Error("A locked debt is required for identity checks.");
  const customerId=Number(debt.effective_customer_id||debt.customer_id||0);
  let previous,entityId,entityType;
  if(customerId){
    const [rows]=await connection.query(
      "SELECT id,name,phone FROM customers WHERE id=? AND branch_id=? LIMIT 1 FOR UPDATE",
      [customerId,branchId]
    );
    if(!rows[0]){
      const error=new Error("The debtor's linked customer profile is missing. Ask a manager to reconcile the correct customer record before collecting payment.");
      error.statusCode=409;error.code="DEBT_CUSTOMER_PROFILE_MISSING";
      throw error;
    }
    previous={name:rows[0].name||"",phone:rows[0].phone||""};
    entityId=customerId;entityType="customer";
  } else {
    previous={name:debt.customer_name||"",phone:debt.customer_phone||""};
    entityId=Number(debt.id);entityType="legacy_debt";
  }
  const needed=requiredIdentityFields(previous);
  if(!needed.length)return {name:cleanName(previous.name),phone:cleanPhone(previous.phone),changed:false};
  const proposedName=needed.includes("customer_name")?cleanName(body?.customer_name):cleanName(previous.name);
  const proposedPhone=needed.includes("customer_phone")?cleanPhone(body?.customer_phone):cleanPhone(previous.phone);
  const missing=requiredIdentityFields({name:proposedName,phone:proposedPhone});
  if(missing.length)throw makeIdentityError(missing);
  if(customerId){
    await connection.query(
      "UPDATE customers SET name=?,phone=? WHERE id=? AND branch_id=?",
      [proposedName,proposedPhone,customerId,branchId]
    );
  }else{
    await connection.query(
      "UPDATE debts SET customer_name=?,customer_phone=? WHERE id=? AND branch_id=?",
      [proposedName,proposedPhone,entityId,branchId]
    );
  }
  await writeAuditEvent({
    connection,req,branchId,userId:req.user?.id||null,
    action:"DEBT_CUSTOMER_IDENTITY_COMPLETED",actionType:"DEBT_CUSTOMER_IDENTITY_COMPLETED",
    workspaceCode:"spare_parts",entityType,entityId,
    outcome:"success",severity:"notice",
    details:"Completed previously missing debtor name and/or telephone before a debt payment.",
    metadata:{
      fields_completed:needed,old_name:previous.name,new_name:proposedName,
      old_phone:previous.phone||null,new_phone:proposedPhone,
      original_sale_receipts_preserved:true,
      money_balances_unchanged_by_identity_correction:true,
    }
  });
  return {name:proposedName,phone:proposedPhone,changed:true};
}
module.exports={cleanName,isRealTwoPartName,cleanPhone,requiredIdentityFields,makeIdentityError,ensureDebtCustomerIdentity};
