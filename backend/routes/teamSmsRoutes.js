"use strict";
const express=require("express"),crypto=require("node:crypto");
const {pool}=require("../config/db");
const {requireRole}=require("../middleware/roleMiddleware");
const {requirePermission}=require("../middleware/permissionMiddleware");
const {buildRateLimiter}=require("../middleware/securityMiddleware");
const {getSmsConfig,sendSms}=require("../services/smsService");
const {estimateSmsSegments}=require("../services/smsReliabilityService");
const {listFinanceCustomers}=require("../services/equipmentFinanceCustomerPortfolioService");
const {maskPhone}=require("../services/financeSmsCampaignService");
const {MAX_BATCH,uniqueRecipients,fingerprint,chooseRecipients,messageText,classifySubmissionError,manualRecipient}=require("../services/teamSmsPolicy");
const {BOSS_NAME,hasVerifiedBossIdentity}=require("../services/saleDiscountAuthorizationService");
const handle=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(res,status,message)=>res.status(status).json({status:"error",message});
const limiter=buildRateLimiter({windowMinutes:15,max:6,message:"Campaign submission limit reached; review delivery history before sending again."});
function live(c){return c.enabled&&Boolean(c.senderId)&&((c.provider==="arkesel"&&Boolean(c.arkeselApiKey))||(c.provider==="hubtel"&&Boolean(c.hubtelClientId&&c.hubtelClientSecret)));}
function branch(scope,req){return scope==="spare_parts"?Number(req.user.branch_id):null;}
function prefix(scope,req){return "team-sms:"+scope+":"+(branch(scope,req)||"company")+":";}
async function audience(scope,req,target){
 if(target==="manual")return {recipients:[],invalid:0,duplicates:0,truncated:false};
 if(!["staff","customers"].includes(target))throw Error("Invalid recipient type");
 let rows,truncated=false;
 if(target==="staff"){
  const where=scope==="spare_parts"?"AND (u.default_branch_id=? OR u.can_access_all_branches=1 OR EXISTS (SELECT 1 FROM user_branch_access a WHERE a.user_id=u.id AND a.branch_id=? AND a.can_access=1))":"";
  const workspace=scope==="spare_parts"?"spare_parts":"equipment_hire";
  const [staff]=await pool.query("SELECT u.id,u.full_name AS name,u.phone,u.role AS category FROM users u WHERE u.is_active=1 AND u.primary_workspace_code=? AND u.category_assignment_status='assigned' "+where+" ORDER BY u.full_name,u.id LIMIT 1001",[workspace,...(scope==="spare_parts"?[branch(scope,req),branch(scope,req)]:[])]);
  const [owners]=await pool.query("SELECT id,full_name,role,is_active,phone FROM users WHERE LOWER(TRIM(full_name))=? AND is_active=1 LIMIT 2",[BOSS_NAME]);
  const owner=owners.length===1&&hasVerifiedBossIdentity(owners[0],owners)?owners[0]:null;
  // The verified company owner is a cross-workspace communication recipient, not a change to account access.
  rows=staff.slice(0,1000).filter(r=>!owner||Number(r.id)!==Number(owner.id));
  if(owner)rows.unshift({id:owner.id,name:owner.full_name,phone:owner.phone,category:"Owner / CEO"});
  truncated=staff.length>1000;
 }else if(scope==="finance"){
  const p=await listFinanceCustomers({limit:500});
  if(!p.readiness)throw Error("Finance portfolio unavailable");
  rows=p.customers.map(r=>({id:r.customer_id||r.id,name:r.customer_name,phone:r.phone,category:r.portfolio_status}));
  truncated=Number(p.count)>rows.length;
 }else{
  const [customers]=await pool.query("SELECT c.id,c.name,c.phone,CASE WHEN EXISTS(SELECT 1 FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id WHERE d.branch_id=c.branch_id AND COALESCE(s.customer_id,d.customer_id)=c.id AND d.balance>0) THEN 'owing' ELSE 'customer' END AS category FROM customers c WHERE c.branch_id=? ORDER BY c.name,c.id LIMIT 1001",[branch(scope,req)]);
  rows=customers.slice(0,1000);truncated=customers.length>1000;
 }
 return {...uniqueRecipients(rows),truncated};
}
function resolveSelection(data,body){
 if(body.target==="manual"){
  if(body.mode!=="manual")throw Error("Invalid manual recipient mode.");
  return [manualRecipient(body.phone)];
 }
 return chooseRecipients(data.recipients,body.mode,body.ids);
}
function publicRecipient(r){return {id:r.id,name:r.name,category:r.category,masked_phone:r.masked_phone};}
function createTeamSmsRouter(scope){
 const router=express.Router();
 router.use(requireRole("admin","manager"));
 if(scope==="finance")router.use(requirePermission("fleet.assets.manage"));
 router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
 router.get("/recipients",handle(async(req,res)=>{
  let data;try{data=await audience(scope,req,req.query.target||"staff");}catch(e){return fail(res,503,"Recipient directory is unavailable; check the selected workspace.");}
  const config=getSmsConfig();
  res.json({status:"success",recipients:data.recipients.map(publicRecipient),invalid:data.invalid,duplicates:data.duplicates,truncated:data.truncated,max_batch:MAX_BATCH,live_sending:live(config),provider:config.provider});
 }));
 router.post("/preview",handle(async(req,res)=>{
  try{
   const message=messageText(req.body.message),data=await audience(scope,req,req.body.target);
   if(req.body.mode==="all"&&data.truncated)return fail(res,409,"Directory is incomplete; select a verified subset.");
   const selected=resolveSelection(data,req.body);
   if(!selected.length||selected.length>MAX_BATCH)return fail(res,400,"Select 1 to "+MAX_BATCH+" unique recipients.");
   const metrics=estimateSmsSegments(message);
   res.json({status:"success",count:selected.length,segments_per_recipient:metrics.segment_count,estimated_credits:metrics.estimated_credits*selected.length,fingerprint:fingerprint(selected,message),recipients:selected.map(publicRecipient)});
  }catch(e){return fail(res,400,req.body.target==="manual"?"Enter a valid Ghana mobile number and a message of 1 to 480 characters.":"Invalid message or recipient selection. Refresh and try again.");}
 }));
 router.get("/history",handle(async(req,res)=>{
  const [rows]=await pool.query("SELECT id,recipient_phone,message,status,provider_message_id,created_at,status_reason,source_reference FROM sms_log WHERE source_reference LIKE ? AND archived_at IS NULL ORDER BY id DESC LIMIT 150",[prefix(scope,req)+"%"]);
  res.json({status:"success",messages:rows.map(r=>({...r,recipient_phone:maskPhone(r.recipient_phone)}))});
 }));
 router.post("/send",limiter,handle(async(req,res)=>{
  if(req.body.confirmation!=="SEND MESSAGES"||req.body.contact_eligible!==true)return fail(res,400,"Confirm recipient eligibility and type SEND MESSAGES.");
  const batch=String(req.body.batch_id||"");
  if(!/^[a-f0-9-]{36}$/i.test(batch))return fail(res,400,"Invalid submission identifier.");
  const config=getSmsConfig();if(!live(config))return fail(res,409,"Live SMS provider is not enabled.");
  let selected,message;
  try{message=messageText(req.body.message);const data=await audience(scope,req,req.body.target);
   if(req.body.mode==="all"&&data.truncated)return fail(res,409,"Directory is incomplete; select a verified subset.");
   selected=resolveSelection(data,req.body);
   if(!selected.length||selected.length>MAX_BATCH||fingerprint(selected,message)!==req.body.fingerprint)return fail(res,409,"Recipient or message preview has changed. Review again.");
  }catch(e){return fail(res,400,"Invalid message or recipient selection.");}
  const lock="team-sms:"+crypto.createHash("sha256").update(prefix(scope,req)+batch).digest("hex").slice(0,48);
  const conn=await pool.getConnection();let held=false;
  try{
   const [[row]]=await conn.query("SELECT GET_LOCK(?,0) AS acquired",[lock]);held=Number(row.acquired)===1;
   if(!held)return fail(res,409,"This campaign is being processed. Check delivery history.");
   const results=[],metrics=estimateSmsSegments(message);
   const batchPrefix=prefix(scope,req)+batch+":";
   const [priorBatch]=await conn.query("SELECT message,source_reference FROM sms_log WHERE source_reference LIKE ? LIMIT 1",[batchPrefix+"%"]);
   if(priorBatch.length&&(priorBatch[0].message!==message||!priorBatch[0].source_reference.startsWith(batchPrefix+req.body.fingerprint+":")))return fail(res,409,"This submission identifier was used for a different campaign.");
   for(const r of selected){
    const ref=batchPrefix+req.body.fingerprint+":"+crypto.createHash("sha256").update(r.phone).digest("hex").slice(0,24);
    const [prior]=await conn.query("SELECT id,status,status_reason FROM sms_log WHERE source_reference=? LIMIT 1",[ref]);
    if(prior.length){results.push({id:r.id,name:r.name,masked_phone:r.masked_phone,status:prior[0].status,status_reason:prior[0].status_reason,log_id:prior[0].id,already_processed:true});continue;}
    const [claim]=await conn.query("INSERT INTO sms_log (branch_id,recipient_phone,message,sms_type,status,provider,sender_id,segment_count,estimated_credits,source_reference,sent_by,status_reason) VALUES (?,?,?,'other','pending',?,?,?,?,?,?,?)",[branch(scope,req),r.phone,message,config.provider,config.senderId,metrics.segment_count,metrics.estimated_credits,ref,req.user.id,"Provider submission claimed; check delivery history before retrying."]);
    let result,status,reason,providerMessageId=null,providerStatus=null;
    try{result=await sendSms({to:r.phone,message});status=["accepted","delivered","undelivered","expired","failed","delivery_unknown"].includes(result.status)?result.status:"delivery_unknown";providerMessageId=result.providerMessageId||null;providerStatus=result.providerStatus||null;reason=status==="accepted"?"Provider accepted; delivery not confirmed.":status==="delivered"?"Provider confirmed delivery.":status==="failed"||status==="undelivered"||status==="expired"?"Provider reported "+status+".":"Provider outcome not confirmed.";}
    catch(e){const failure=classifySubmissionError(e);status=failure.status;reason=failure.reason;providerMessageId=failure.providerMessageId;providerStatus=failure.providerStatus;console.warn("Team SMS submission outcome:",status,"HTTP:",Number(e?.statusCode)||"unknown");}
    try{await conn.query("UPDATE sms_log SET status=?,provider_message_id=?,provider_status=?,status_reason=?,submitted_at=NOW(),last_status_at=NOW(),delivery_confirmed_at=IF(?='delivered',NOW(),NULL) WHERE id=?",[status,providerMessageId,providerStatus,reason,status,claim.insertId]);}
    catch(e){status="delivery_unknown";reason="Could not save provider outcome. Check delivery history before retrying.";console.warn("Team SMS log update failed:",e?.code||"unknown");}
    results.push({id:r.id,name:r.name,masked_phone:r.masked_phone,status,status_reason:reason,log_id:claim.insertId});
   }
   const counts={};for(const row of results)counts[row.status]=(counts[row.status]||0)+1;
   const delivered=counts.delivered||0,accepted=counts.accepted||0,failed=(counts.failed||0)+(counts.undelivered||0)+(counts.expired||0),unknown=results.length-delivered-accepted-failed;
   res.status(202).json({status:"processed",counts,results,message:"Processed "+results.length+": "+delivered+" delivered, "+accepted+" accepted by provider, "+failed+" failed or undelivered, "+unknown+" unverified."});
  }finally{if(held)await conn.query("SELECT RELEASE_LOCK(?)",[lock]).catch(()=>{});conn.release();}
 }));
 return router;
}
module.exports={createTeamSmsRouter};
