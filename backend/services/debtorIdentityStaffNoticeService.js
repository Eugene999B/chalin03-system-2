"use strict";
const crypto=require("node:crypto");
const {pool}=require("../config/db");
const {getSmsConfig,normalizeGhanaPhone,sendSms}=require("./smsService");

// One announcement for active internal accounts, not customer phones.
const POLICY_ID="CHALIN03_DEBT_IDENTITY_20261117_V1";
const LOCK_NAME="chalin03_debt_identity_notice_20261117_v1";
const SMS_TEXT="CHALIN03 NOTICE: Verify two different real names and valid phone numbers for all customers who owe. Complete missing details before new credit sales or debt payments.";
const MAX_RECIPIENTS=500;
function sourceReference(phone) {
  return POLICY_ID+":"+crypto.createHash("sha256").update(phone).digest("hex").slice(0,26);
}
function classifySubmission(result) {
  const status=String(result?.status||"delivery_unknown");
  return ["accepted","delivered","undelivered","expired","failed","delivery_unknown"].includes(status)
    ?status:"delivery_unknown";
}
function collectRecipients(staff=[],office=[],extra=[]) {
  const recipients=new Map();
  for(const row of [...staff,...office,...extra]){
    const phone=normalizeGhanaPhone(row?.phone);
    if(phone&&!recipients.has(phone))recipients.set(phone,{phone,kind:row.kind||"staff"});
  }
  return [...recipients.values()];
}
async function dispatchStaffDebtorIdentityNoticeOnce(){
  const cfg=getSmsConfig();
  if(!cfg.enabled){
    console.info("Debtor identity staff SMS not sent: provider disabled. In-app announcement remains active.");
    return {status:"sms_disabled"};
  }
  if(process.env.NODE_ENV!=="production")return {status:"not_production"};
  const connection=await pool.getConnection();
  let locked=false,attempted=0,skipped=0,accepted=0,unconfirmed=0;
  try{
    const [locks]=await connection.query("SELECT GET_LOCK(?,0) AS acquired",[LOCK_NAME]);
    if(Number(locks[0]?.acquired)!==1)return {status:"another_dispatch_running"};
    locked=true;
    const [staff]=await connection.query("SELECT id,phone,role FROM users WHERE is_active=1 ORDER BY id ASC");
    const [office]=await connection.query(
      "SELECT phone,'head_office' AS kind FROM branches WHERE is_head_office=1 AND is_active=1 AND phone IS NOT NULL"
    );
    const extra=[
      {phone:process.env.CHALIN03_DEBT_POLICY_BOSS_PHONE,kind:"boss"},
      {phone:process.env.CHALIN03_DEBT_POLICY_COMPANY_PHONE,kind:"company"}
    ];
    const recipients=collectRecipients(staff,office,extra);
    if(recipients.length>MAX_RECIPIENTS){
      console.warn("Staff SMS policy notice not sent: recipient count exceeds safety cap.");
      return {status:"recipient_safety_cap",count:recipients.length};
    }
    for(const recipient of recipients){
      const ref=sourceReference(recipient.phone);
      const [claims]=await connection.query(
        "SELECT id,status FROM sms_log WHERE source_reference=? LIMIT 1",[ref]
      );
      if(claims.length){skipped++;continue;}
      const sql="INSERT INTO sms_log "+
        "(branch_id,recipient_phone,message,sms_type,status,provider,sender_id,"+
        "source_reference,segment_count,estimated_credits,provider_response,"+
        "status_reason,last_status_at) "+
        "VALUES (NULL,?,?,'other','pending',?,?,?,1,0,?,?,NOW())";
      const [insert]=await connection.query(sql,[
        recipient.phone,SMS_TEXT,cfg.provider||null,cfg.senderId||null,ref,
        JSON.stringify({policy:POLICY_ID,kind:recipient.kind}),
        "One-time staff policy notice queued by production release"
      ]);
      const logId=Number(insert.insertId);
      attempted++;
      try{
        const result=await sendSms({to:recipient.phone,message:SMS_TEXT});
        const status=classifySubmission(result);
        const submitted=["accepted","delivered"].includes(status);
        if(submitted)accepted++;else unconfirmed++;
        const updateSql="UPDATE sms_log SET status=?,provider=?,provider_message_id=?,"+
          "provider_status=?,status_reason=?,segment_count=?,estimated_credits=?,"+
          "provider_response=?,submitted_at=?,sent_at=?,last_status_at=NOW() WHERE id=?";
        await connection.query(updateSql,[
          status,result.provider||cfg.provider||null,result.providerMessageId||null,
          result.providerStatus||null,
          submitted?"Accepted by provider; final handset delivery not independently verified.":
            "Acceptance or delivery not confirmed; no automatic retry.",
          Math.max(1,Number(result.segmentCount||1)),Math.max(0,Number(result.estimatedCredits||0)),
          JSON.stringify({policy:POLICY_ID,status,provider:result.provider}).slice(0,1000),
          submitted?new Date():null,submitted?new Date():null,logId
        ]);
      }catch(error){
        unconfirmed++;
        try{
          await connection.query(
            "UPDATE sms_log SET status='delivery_unknown',status_reason=?,"+
              "provider_response=?,last_status_at=NOW() WHERE id=?",
            ["Provider acceptance uncertain; check SMS provider before manual retry.",
              JSON.stringify({policy:POLICY_ID,error_code:error?.code||"SMS_UNAVAILABLE"}).slice(0,1000),logId]
          );
        }catch(logError){
          console.warn("Staff notice SMS status logging failed:",logError.code||"UNKNOWN");
        }
      }
    }
    console.info("CHALIN03 staff debt identity SMS notice processed",{
      valid_staff_contacts:recipients.length,attempted,
      previously_claimed:skipped,provider_accepted:accepted,unconfirmed
    });
    return {status:"processed",recipients:recipients.length,attempted,skipped,accepted,unconfirmed};
  }finally{
    if(locked){
      try{await connection.query("SELECT RELEASE_LOCK(?)",[LOCK_NAME]);}
      catch(error){console.warn("Staff notice release lock failed:",error.code||"UNKNOWN");}
    }
    connection.release();
  }
}
module.exports={POLICY_ID,SMS_TEXT,sourceReference,collectRecipients,classifySubmission,dispatchStaffDebtorIdentityNoticeOnce};
