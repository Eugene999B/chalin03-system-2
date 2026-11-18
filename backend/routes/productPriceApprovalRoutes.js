"use strict";

const express = require("express");
const {pool} = require("../config/db");
const {writeAuditEvent} = require("../services/auditTrailService");
const {operationalApprovalExecutionMiddleware} = require("../middleware/operationalApprovalExecutionMiddleware");
const {createOperationalRequest,hashPayload} = require("../services/operationalApprovalService");
const {
  canChangeMasterPriceDirectly,priceSnapshot,proposedPriceSnapshot,
  changedPriceFields,validatePriceChange,changeSummary,normalizePrice
} = require("../services/productPriceApprovalPolicy");

const router=express.Router();
const idValue=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;};
const errorResponse=(res,status,code,message)=>res.status(status).json({status:"error",code,message});
const branchIdOf=req=>idValue(req.user?.branch_id);
const reasonText=value=>String(value||"").trim().slice(0,1000);

async function lockProduct(connection,productId,branchId){
  const [rows]=await connection.query(
    "SELECT id,branch_id,name,cost_price,selling_price,is_active FROM products "+
    "WHERE id=? AND branch_id=? AND is_active=1 LIMIT 1 FOR UPDATE",
    [productId,branchId]);
  return rows[0]||null;
}

async function queuePriceRequest(req, connection, product, after, reason){
  const branchId=branchIdOf(req);
  const before=priceSnapshot(product);
  const cleanReason=reasonText(reason);
  if(cleanReason.length<12){
    const e=new Error("Explain why the price must change (at least 12 characters).");
    e.statusCode=400;e.code="PRICE_CHANGE_REASON_REQUIRED";throw e;
  }
  const changed=changedPriceFields(before,after);
  if(!changed.length){
    const e=new Error("Choose a different cost or selling price.");
    e.statusCode=400;e.code="PRICE_UNCHANGED";throw e;
  }
  const [active]=await connection.query(
    "SELECT id FROM audit_unlock_requests WHERE branch_id=? "+
    "AND approval_kind='product_price_change' AND entity_type='product' "+
    "AND entity_id=? AND status='pending' AND execution_status IN ('pending','executing') "+
    "AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1 FOR UPDATE",
    [branchId,product.id]);
  if(active.length){
    const e=new Error("This product already has a pending price request. Review or reject it before submitting a new one.");
    e.statusCode=409;e.code="PRODUCT_PRICE_REQUEST_ALREADY_PENDING";throw e;
  }
  return createOperationalRequest({
    req,connection,branchId,
    approvalKind:"product_price_change",entityType:"product",entityId:product.id,
    requestArea:"product_price",periodLabel:"Master price approval — "+product.name,
    requestedAction:"Change "+product.name+": "+changeSummary(before,after),
    reason:cleanReason,amount:Number(after.selling_price),
    payload:{product_id:Number(product.id),product_name:product.name,before,after,price_fields:changed},
    notificationMessage:(req.user?.full_name||req.user?.username||"Employee")+
      " requested master price change for "+product.name+" ("+changeSummary(before,after)+
      "). Boss, System Administrator or Auditor review required."
  });
}

async function sendRequest(req,res){
  const branchId=branchIdOf(req),productId=idValue(req.params.id);
  if(!branchId||!productId)return errorResponse(res,400,"STORE_OR_PRODUCT_REQUIRED","Choose a product in your signed-in store.");
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const product=await lockProduct(connection,productId,branchId);
    if(!product){
      await connection.rollback();
      return errorResponse(res,404,"PRODUCT_NOT_FOUND","Product not found in this store.");
    }
    const proposed=validatePriceChange({product,values:req.body||{}});
    if(!proposed.ok){
      await connection.rollback();
      return errorResponse(res,400,proposed.code,proposed.message);
    }
    const result=await queuePriceRequest(req,connection,product,proposed.after,req.body?.reason);
    await connection.commit();
    return res.status(result.duplicate?200:201).json({
      status:"success",pending_approval:true,
      message:"Price change submitted for approval. The live product prices are unchanged.",
      request:{id:result.request.id,request_code:result.request.request_code},
      old_prices:proposed.before,proposed_prices:proposed.after
    });
  }catch(e){
    await connection.rollback().catch(()=>{});
    return errorResponse(res,e.statusCode||500,e.code||"PRICE_REQUEST_FAILED",
      e.statusCode?e.message:"Could not send price change for approval.");
  }finally{connection.release();}
}

// Prevent a manager from laundering a direct price change through PUT /products/:id.
// The regular product handler still updates metadata when prices are unchanged.
async function interceptUnapprovedPut(req,res,next){
  if(await canChangeMasterPriceDirectly(req.user))return next();
  if(String(req.user?.role||"").toLowerCase()!=="manager")return next();
  const branchId=branchIdOf(req),productId=idValue(req.params.id);
  if(!branchId||!productId)return errorResponse(res,400,"STORE_OR_PRODUCT_REQUIRED","Select a valid product and store.");
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const product=await lockProduct(connection,productId,branchId);
    if(!product){
      await connection.rollback();
      return errorResponse(res,404,"PRODUCT_NOT_FOUND","Product not found in this store.");
    }
    const nextPrice=proposedPriceSnapshot(product,{
      cost_price:req.body?.cost_price,selling_price:req.body?.selling_price
    });
    if(!nextPrice){
      await connection.rollback();
      return errorResponse(res,400,"PRICE_INVALID","Enter valid prices in Ghana cedis.");
    }
    if(!changedPriceFields(priceSnapshot(product),nextPrice).length){
      await connection.commit();
      return next();
    }
    const created=await queuePriceRequest(req,connection,product,nextPrice,req.body?.price_change_reason);
    await connection.commit();
    return res.status(202).json({
      status:"success",pending_approval:true,
      message:"Your proposed price change was sent for approval. No product details or prices were changed. Edit other product details separately.",
      request:{id:created.request.id,request_code:created.request.request_code},
      old_prices:priceSnapshot(product),proposed_prices:nextPrice
    });
  }catch(e){
    await connection.rollback().catch(()=>{});
    return errorResponse(res,e.statusCode||500,e.code||"PRICE_EDIT_GUARD_FAILED",
      e.statusCode?e.message:"The price edit could not be processed safely.");
  }finally{connection.release();}
}

// The approval token is installed and verified by operationalApprovalExecutionMiddleware,
// including reviewed-by, request-kind, matching route, request hash and a one-time token.
// This action itself locks the approval and product atomically before changing prices.
async function applyApprovedPrice(req,res){
  if(req.approvalExecution?.approval_kind!=="product_price_change"){
    return errorResponse(res,403,"PRICE_APPROVAL_EXECUTION_REQUIRED",
      "Master prices can only be applied through a protected approved request.");
  }
  const branchId=branchIdOf(req),productId=idValue(req.params.id),approvalId=idValue(req.approvalExecution.request_id);
  if(!branchId||!productId||!approvalId)return errorResponse(res,400,"INVALID_APPROVAL_CONTEXT","Invalid price approval context.");
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [requests]=await connection.query(
      "SELECT id,branch_id,entity_id,requested_by,reviewed_by,status,execution_status,"+
      "approval_kind,approval_payload_json,approval_payload_hash FROM audit_unlock_requests "+
      "WHERE id=? LIMIT 1 FOR UPDATE",[approvalId]);
    const approval=requests[0];
    if(!approval||approval.approval_kind!=="product_price_change"||
      approval.status!=="approved"||approval.execution_status!=="executing"||
      Number(approval.branch_id)!==branchId||Number(approval.entity_id)!==productId||
      Number(approval.reviewed_by)!==Number(req.approvalExecution.approved_by)||
      Number(approval.requested_by)===Number(approval.reviewed_by)){
      const e=new Error("The approval is invalid, already executed or belongs to a different product/store.");
      e.statusCode=409;e.code="INVALID_PRICE_APPROVAL";throw e;
    }
    const payload=typeof approval.approval_payload_json==="string"
      ?JSON.parse(approval.approval_payload_json):approval.approval_payload_json;
    if(!payload||hashPayload(payload)!==approval.approval_payload_hash||
       Number(payload.product_id)!==productId){
      const e=new Error("Approved price evidence failed its integrity check.");
      e.statusCode=409;e.code="PRICE_APPROVAL_INTEGRITY_FAILED";throw e;
    }
    const product=await lockProduct(connection,productId,branchId);
    if(!product){
      const e=new Error("The product is no longer available for a price change.");
      e.statusCode=409;e.code="PRICE_PRODUCT_NO_LONGER_ACTIVE";throw e;
    }
    const current=priceSnapshot(product),before=payload.before,after=payload.after;
    if(current.cost_price!==before?.cost_price||current.selling_price!==before?.selling_price){
      const e=new Error("Prices changed since this request was submitted. Reject the outdated request and submit a new one.");
      e.statusCode=409;e.code="STALE_PRICE_APPROVAL";throw e;
    }
    if(normalizePrice(after?.cost_price)!==after?.cost_price||
      normalizePrice(after?.selling_price)!==after?.selling_price||
      !changedPriceFields(current,after).length){
      const e=new Error("The approved price values are invalid.");
      e.statusCode=409;e.code="INVALID_APPROVED_PRICE";throw e;
    }
    await connection.query(
      "UPDATE products SET cost_price=?,selling_price=? WHERE id=? AND branch_id=?",
      [after.cost_price,after.selling_price,productId,branchId]
    );
    await writeAuditEvent({
      req,connection,branchId,userId:req.approvalExecution.approved_by,
      action:"APPROVED_PRODUCT_MASTER_PRICE_CHANGE",
      details:product.name+" — "+changeSummary(current,after)+
        "; requested by "+approval.requested_by+
        ", approved by "+req.approvalExecution.approved_by,
      workspaceCode:"spare_parts",entityType:"product",entityId:String(productId),
      actionType:"product_price_approved",outcome:"success",severity:"high",
      metadata:{approval_id:approvalId,before:current,after,
        requested_by:approval.requested_by,approved_by:approval.reviewed_by}
    });
    await connection.query(
      "UPDATE audit_unlock_requests SET execution_status='executed',executed_at=NOW(),"+
      "execution_result_json=?,execution_error=NULL,execution_token_hash=NULL "+
      "WHERE id=? AND execution_status='executing'",
      [JSON.stringify({product_id:productId,old_prices:current,new_prices:after}),approvalId]
    );
    await connection.commit();
    return res.json({status:"success",message:"Approved price change is now active. Historical receipts remain untouched.",
      product_id:productId,old_prices:current,new_prices:after});
  }catch(e){
    await connection.rollback().catch(()=>{});
    return errorResponse(res,e.statusCode||500,e.code||"PRICE_EXECUTION_FAILED",
      e.statusCode?e.message:"Could not apply the approved price safely.");
  }finally{connection.release();}
}

router.post("/:id/price-change-request",sendRequest);
router.post("/:id/approved-price",operationalApprovalExecutionMiddleware,applyApprovedPrice);
router.put("/:id",interceptUnapprovedPut);

module.exports={router,queuePriceRequest,interceptUnapprovedPut,applyApprovedPrice};
