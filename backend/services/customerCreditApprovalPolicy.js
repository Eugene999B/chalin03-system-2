"use strict";
const crypto=require("node:crypto");
const {MAX_LIMIT}=require("./customerCreditPolicy");

function id(v){if(!Number.isSafeInteger(v)||v<=0)throw new RangeError("Invalid identifier");return v;}
function money(v){if(!Number.isSafeInteger(v)||v<0)throw new RangeError("Invalid exposure");return v;}
function canonical(value){
  if(value===null||typeof value==="string"||typeof value==="boolean")return value;
  if(typeof value==="number"&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(canonical);
  if(value&&Object.getPrototypeOf(value)===Object.prototype){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  }
  throw new TypeError("Invalid sale payload");
}
function sealSalePayload(payload){
  // The caller supplies a server-validated, whitelisted sale payload only.
  // No raw request, password, OTP, recovery code, or authentication header.
  const serialized=JSON.stringify(canonical(payload));
  if(Buffer.byteLength(serialized)>65536)throw new RangeError("Sale payload too large");
  return {serialized,hash:crypto.createHash("sha256").update(serialized).digest("hex")};
}
function verifyPayload(payload,hash){
  if(typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash))return false;
  return crypto.timingSafeEqual(Buffer.from(sealSalePayload(payload).hash,"hex"),Buffer.from(hash,"hex"));
}
function reviewDecision({request,reviewerId,branchId,action,now=Date.now(),reason,authoritativeExposure}){
  id(reviewerId);id(branchId);
  if(Number(request.branch_id)!==branchId)throw new Error("Request is outside authorized branch");
  if(Number(request.requested_by)===reviewerId)throw new Error("Independent reviewer required");
  if(request.status!=="pending")throw new Error("Request is no longer pending");
  if(!Number.isFinite(now)||!Number.isFinite(request.expiresAtMs)||request.expiresAtMs<=now)throw new Error("Request expired");
  if(!["approve","reject"].includes(action))throw new Error("Invalid review decision");
  if(typeof reason!=="string"||reason.trim().length<3||reason.trim().length>500)throw new Error("Review reason is required");
  if(action==="approve"){
    const exposure=money(authoritativeExposure),newDebt=money(request.new_debt_pesewas);
    if(newDebt===0||!Number.isSafeInteger(exposure+newDebt)||exposure+newDebt>MAX_LIMIT)throw new Error("Absolute credit cap exceeded");
  }
  return {status:action==="approve"?"approved":"rejected",reviewed_by:reviewerId,review_reason:reason.trim()};
}

// Use inside a transaction with the canonical customer row locked. A queue
// approval is not a posted sale; execution must revalidate stock, price, scope,
// hash, score, exposure, expiry and consume the reservation atomically.
async function sumActiveReservations(db,{customerId,excludeId=null}){
  id(customerId);if(excludeId!==null)id(excludeId);
  const [rows]=await db.query(
    "SELECT COALESCE(SUM(new_debt_pesewas),0) AS reserved FROM customer_credit_approval_requests WHERE customer_id=? AND status='approved' AND expires_at>UTC_TIMESTAMP() AND (? IS NULL OR id<>?)",
    [customerId,excludeId,excludeId]
  );
  const raw=String(rows[0].reserved);
  if(!/^\d+$/.test(raw))throw new RangeError("Invalid reservation total");
  return money(Number(raw));
}
module.exports={sealSalePayload,verifyPayload,reviewDecision,sumActiveReservations};
