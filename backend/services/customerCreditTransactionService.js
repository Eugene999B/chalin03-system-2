"use strict";
const {creditLimit,evaluateCredit,debtDueDate}=require("./customerCreditPolicy");
const {toPesewas}=require("./customerCreditProfileService");
const {sealSalePayload,reviewDecision,sumActiveReservations}=require("./customerCreditApprovalPolicy");

function conflict(code,message){return Object.assign(new Error(message),{statusCode:409,code});}
function enabled(env=process.env){return env.CHALIN03_CREDIT_PREVIEW==="true"&&env.CHALIN03_CREDIT_ENFORCEMENT_PREVIEW==="true";}

// Caller holds branch row lock; use locking reads to avoid a stale transaction snapshot.
async function loadExposure(conn,branchId,customerId,excludeId=null){
  const [customers]=await conn.query("SELECT id FROM customers WHERE id=? AND branch_id=? FOR UPDATE",[customerId,branchId]);
  if(!customers.length)throw conflict("CREDIT_CUSTOMER_REQUIRED","Select a verified customer first.");
  const [profiles]=await conn.query("SELECT score FROM customer_credit_profiles WHERE customer_id=? FOR UPDATE",[customerId]);
  const [terms]=await conn.query("SELECT term_months FROM customer_credit_settings WHERE branch_id=? FOR UPDATE",[branchId]);
  if(!terms.length)throw conflict("CREDIT_SCHEMA_NOT_READY","Credit settings are not ready.");
  const [debts]=await conn.query(
    "SELECT d.balance FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id WHERE d.branch_id=? AND COALESCE(s.customer_id,d.customer_id)=? AND d.balance>0 FOR UPDATE",
    [branchId,customerId]
  );
  const outstanding=debts.reduce((sum,d)=>sum+toPesewas(d.balance),0);
  // Branch lock serializes all staged sale/approval changes for this customer.
  const reserved=await sumActiveReservations(conn,{customerId,excludeId});
  return {score:Number(profiles[0]?.score??30),termMonths:Number(terms[0].term_months),outstanding,reserved};
}
function readJson(v){return typeof v==="string"?JSON.parse(v):v;}
async function prepareCreditSale(conn,{branchId,customerId,userId,requestKey,payload,total,paid,businessDate}){
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(requestKey||""))throw conflict("CREDIT_REQUEST_KEY_REQUIRED","Refresh the sale screen before requesting credit.");
  const sealed=sealSalePayload(payload);
  const [rows]=await conn.query("SELECT id,status,payload_sha256,customer_id,expires_at>UTC_TIMESTAMP() AS active,executed_sale_id FROM customer_credit_approval_requests WHERE branch_id=? AND requested_by=? AND request_key=? FOR UPDATE",[branchId,userId,requestKey]);
  const prior=rows[0];
  if(prior){
    if(prior.payload_sha256!==sealed.hash||Number(prior.customer_id)!==customerId)throw conflict("CREDIT_REQUEST_CHANGED","Sale details changed. Start a new approval request.");
    if(prior.status==="executed")throw conflict("CREDIT_ALREADY_EXECUTED","This approval was already posted as sale #"+prior.executed_sale_id+". Check Sales History.");
    if(!Number(prior.active)||!["pending","approved"].includes(prior.status))throw conflict("CREDIT_REQUEST_CLOSED","This request is closed or expired. Start a new request.");
    if(prior.status==="pending")return {pending:true,id:String(prior.id)};
  }
  const exposure=await loadExposure(conn,branchId,customerId,prior?.id?Number(prior.id):null);
  const result=evaluateCredit({...exposure,total:toPesewas(total),paid:toPesewas(paid)});
  if(prior&&prior.status==="approved"){
    // An approved exception permits the exact sale only and never the absolute cap.
    if(result.projectedExposure>creditLimit(100))throw conflict("CREDIT_CAP_EXCEEDED","Current exposure exceeds the maximum credit cap.");
    return {approvalId:prior.id,dueDate:debtDueDate(businessDate,exposure.termMonths)};
  }
  if(result.decision!=="approval_required")return {dueDate:debtDueDate(businessDate,exposure.termMonths)};
  if(result.projectedExposure>creditLimit(100))throw conflict("CREDIT_CAP_EXCEEDED","This purchase exceeds the maximum GH₵200,000 credit exposure.");
  const [insert]=await conn.query(
    "INSERT INTO customer_credit_approval_requests (branch_id,customer_id,requested_by,request_key,payload_sha256,sale_payload,new_debt_pesewas,score_at_request,limit_at_request_pesewas,exposure_at_request_pesewas,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 72 HOUR))",
    [branchId,customerId,userId,requestKey,sealed.hash,sealed.serialized,result.newDebt,result.score,result.limit,result.exposure]
  );
  return {pending:true,id:String(insert.insertId)};
}
async function reviewCreditRequest(conn,{branchId,reviewerId,requestId,action,reason}){
  await conn.query("SELECT id FROM branches WHERE id=? FOR UPDATE",[branchId]);
  const [rows]=await conn.query("SELECT *,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expires_at) AS remaining_seconds FROM customer_credit_approval_requests WHERE id=? AND branch_id=? FOR UPDATE",[requestId,branchId]);
  const request=rows[0];if(!request)throw conflict("CREDIT_REQUEST_NOT_FOUND","Credit request not found.");
  let exposure;
  if(action==="approve"){
    const v=await loadExposure(conn,branchId,Number(request.customer_id));
    exposure=v.outstanding+v.reserved;
  }
  const now=Date.now();
  let decision;
  try{
    decision=reviewDecision({request:{...request,expiresAtMs:now+Number(request.remaining_seconds)*1000,new_debt_pesewas:Number(request.new_debt_pesewas)},reviewerId,branchId,action,reason,now,authoritativeExposure:exposure});
  }catch(e){throw conflict("CREDIT_REVIEW_CONFLICT",e.message);}
  if(sealSalePayload(readJson(request.sale_payload)).hash!==request.payload_sha256)throw conflict("CREDIT_PAYLOAD_INTEGRITY","Credit request integrity check failed.");
  const [updated]=await conn.query("UPDATE customer_credit_approval_requests SET status=?,reviewed_by=?,review_reason=?,reviewed_at=UTC_TIMESTAMP() WHERE id=? AND status='pending' AND expires_at>UTC_TIMESTAMP()",[decision.status,reviewerId,decision.review_reason,requestId]);
  if(updated.affectedRows!==1)throw conflict("CREDIT_REQUEST_EXPIRED","This request expired before the review could be saved.");
  return decision;
}
async function consumeCreditApproval(conn,id,saleId){
  const [result]=await conn.query("UPDATE customer_credit_approval_requests SET status='executed',executed_sale_id=? WHERE id=? AND status='approved' AND expires_at>UTC_TIMESTAMP()",[saleId,id]);
  if(result.affectedRows!==1)throw conflict("CREDIT_APPROVAL_NOT_ACTIVE","Approval is no longer active. Sale was not posted.");
}
module.exports={enabled,loadExposure,prepareCreditSale,reviewCreditRequest,consumeCreditApproval};
