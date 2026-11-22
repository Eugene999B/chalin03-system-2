"use strict";
/* Controlled pilot. Requires independent approved schema migration.
 * Original admin bypasses FIRST enrollment SMS only after a recent,
 * authenticated session. No anonymous administrator bootstrap.
 */
const express=require("express"),QRCode=require("qrcode");
const {pool}=require("../config/db"),{requireAuth}=require("../middleware/authMiddleware");
const {isOriginalSystemAdministrator}=require("../security/systemAdminIdentity");
const {sendSmsAlertToPhone}=require("../services/smsAlertService");
const {getSmsConfig,normalizeGhanaPhone}=require("../services/smsService");
const {configured:googleLinkConfigured}=require("../services/staffGoogleOidcService");
const {createSession}=require("../services/accountSessionService");
const {writeAuditEvent}=require("../services/auditTrailService");
const auth=require("./authRoutes").commandGateAuth;
const s=require("../services/staffPasswordlessCrypto");
const router=express.Router();
s.assertConfigured();
const GENERIC="The account or security code could not be verified. Check your details or contact the administrator.";
const deny=(res,code=401)=>res.status(code).json({status:"error",message:GENERIC});
const number=v=>Number.isInteger(Number(v))&&Number(v)>0?Number(v):null;
const digest=token=>s.digestChallenge(token);
const action=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(err=>{
 console.error("Staff authenticator pilot:",String(err.code||err.name||"error").slice(0,60));
 res.status(503).json({status:"error",message:"Secure sign-in is temporarily unavailable."});
});
async function getUser(id){const rows=await auth.buildUserSelectByWhere("WHERE id = ?",[id]);return rows[0]||null;}
async function enrolled(id,conn=pool){
 const [rows]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? LIMIT 1",[id]);return rows.length>0;
}
async function accessFor(user,code,branchId){
 const a=await auth.resolveLoginWorkspace(user,code);if(!a.ok)return null;
 let branch=null;
 if(a.workspace.code==="spare_parts"){
  if(!branchId)return null;
  const b=await auth.resolveLoginBranch(user,branchId);if(!b.ok)return null;branch=b.branch;
 }else if(branchId)return null;
 return {workspace:a.workspace,branch,role:a.workspaceRole};
}
async function audit(req,id,verb){
 await writeAuditEvent({req,userId:id,action:"STAFF_PASSWORDLESS_"+verb,actionType:"security.staff_passwordless."+verb.toLowerCase(),outcome:"success",severity:"notice",entityType:"user",entityId:id,details:"Staff authenticator security event."});
}
async function sessionFor(req,userId,workspaceCode,branchId){
 const user=await getUser(userId);
 if(!user||!Number(user.is_active)||Number(user.is_login_locked))throw new Error("Account inactive");
 const a=await accessFor(user,workspaceCode,branchId);if(!a)throw new Error("Workspace revoked");
 const category=await auth.loadUserCategoryState(user);
 user.workspace_role=a.role;user.primary_workspace_code=category.primary_workspace_code;
 user.category_assignment_status=category.category_assignment_status;
 user.category_conflict_reason=category.conflict_reason;
 user.login_method="authenticator";user.must_change_password=0;
 const sess=await createSession({userId:user.id,req,workspaceCode:a.workspace.code,branchId:a.branch?.id||null,loginMethod:"authenticator",deviceEvidence:req.body.device_evidence||{}});
 const token=auth.createToken(user,a.branch,a.workspace,sess.sessionId);
 await auth.recordSuccessfulLogin(req,user);
 await audit(req,user.id,"LOGIN");
 return {status:"success",token,workspace:{id:a.workspace.id||null,code:a.workspace.code,name:a.workspace.name},
  user:await auth.buildUserResponse(user,a.branch,a.workspace)};
}
async function createChallenge({id,purpose,workspace,branch,smsCode}){
 const token=s.newChallenge(),hash=digest(token);
 await pool.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL",[id]);
 await pool.query("INSERT INTO staff_passwordless_challenges(token_digest,user_id,purpose,workspace_code,branch_id,sms_pin_digest,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND))",
 [hash,id,purpose,workspace,branch||null,smsCode?s.smsDigest(token,smsCode):null,purpose==="sms_enroll"?s.SMS_TTL_SECONDS:s.ENROLL_TTL_SECONDS]);
 return token;
}
async function challengeRow(conn,token,purposes){
 const [rows]=await conn.query("SELECT * FROM staff_passwordless_challenges WHERE token_digest=? FOR UPDATE",[digest(token)]);
 const row=rows[0];if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now()||row.attempts>=s.MAX_SMS_ATTEMPTS||!purposes.includes(row.purpose))return null;
 return row;
}
async function markFailure(conn,row){await conn.query("UPDATE staff_passwordless_challenges SET attempts=attempts+1 WHERE token_digest=?",[row.token_digest]);}
async function createSetup(token,id){
 const user=await getUser(id),totp=s.newAuthenticator(user.username);
 const box=s.encryptSecret(totp.secret);
 await pool.query("UPDATE staff_passwordless_challenges SET purpose='setup',pending_ciphertext=?,pending_iv=?,pending_tag=?,verified_at=UTC_TIMESTAMP(),expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE token_digest=? AND user_id=? AND consumed_at IS NULL",
 [box.ciphertext,box.iv,box.tag,s.ENROLL_TTL_SECONDS,digest(token),id]);
 return {stage:"setup",secret:totp.secret,otpauth_url:totp.uri,qr_data_url:await QRCode.toDataURL(totp.uri,{width:260,margin:2})};
}
async function belowLimit(id,purpose,cap,mins){
 const [rows]=await pool.query("SELECT COUNT(*) n FROM staff_passwordless_challenges WHERE user_id=? AND purpose=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)",[id,purpose,mins]);
 return Number(rows[0]?.n||0)<cap;
}
router.get("/mode",(req,res)=>res.json({status:"success",pilot:true,enforced:s.enforced()}));
router.post("/start",action(async(req,res)=>{
 const name=String(req.body?.identifier||"").trim().slice(0,120),workspace=auth.normalizeWorkspaceCode(req.body?.workspace_code),branch=number(req.body?.branch_id);
 if(!name||!workspace)return deny(res);
 const look=await auth.findUsersForLogin(name),user=look.users?.[0];
 if(!user||!Number(user.is_active)||Number(user.is_login_locked))return deny(res);
 if(!(await accessFor(user,workspace,branch)))return deny(res);
 const alreadyEnrolled=await enrolled(user.id);
 // A public username can never bootstrap the original administrator.
 if(isOriginalSystemAdministrator(user)&&!alreadyEnrolled){
  return res.status(409).json({
   status:"error",
   code:"TRUSTED_SESSION_SETUP_REQUIRED",
   message:"First-time Authenticator setup needs an existing verified account session. Open Account Security from your signed-in device."
  });
 }
 if(alreadyEnrolled){
  if(!(await belowLimit(user.id,"totp_login",8,10)))return deny(res,429);
  const challenge=await createChallenge({id:user.id,purpose:"totp_login",workspace,branch});
  return res.json({status:"success",stage:"authenticator",challenge});
 }
 const phone=normalizeGhanaPhone(user.login_phone_normalized||user.phone),config=getSmsConfig();
 if(!phone)return deny(res);
 // Duplicated staff phone assignments require admin correction before onboarding.
 const [matchingPhones]=await pool.query("SELECT COUNT(*) AS n FROM users WHERE login_phone_normalized=? AND is_active=1",[phone]);
 if(Number(matchingPhones[0]?.n||0)!==1)return deny(res);
 if(!config.enabled||config.provider==="mock")return res.status(503).json({status:"error",message:"Phone verification is not available. Contact the administrator."});
 if(!(await belowLimit(user.id,"sms_enroll",s.MAX_SMS_PER_HOUR,60)))return deny(res,429);
 const [sentEarlier]=await pool.query("SELECT sms_sent_at FROM staff_passwordless_challenges WHERE user_id=? AND sms_sent_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",[user.id]);
 if(sentEarlier.length&&Date.now()-new Date(sentEarlier[0].sms_sent_at).getTime()<s.SMS_COOLDOWN_SECONDS*1000)return deny(res,429);
 const code=s.newSmsCode(),challenge=await createChallenge({id:user.id,purpose:"sms_enroll",workspace,branch,smsCode:code});
 const sent=await sendSmsAlertToPhone({branchId:branch||user.default_branch_id||1,phone,
  message:"CHALIN03 verification: "+code+". Expires in 5 minutes. Do not share this code.",
  logMessage:"CHALIN03 first-time staff verification code [REDACTED]",smsType:"security_alert",sourceReference:"staff-passwordless-enrollment"});
 if(!sent.ok){await pool.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE token_digest=?",[digest(challenge)]);
  return res.status(503).json({status:"error",message:"SMS verification is currently unavailable."});}
 await pool.query("UPDATE staff_passwordless_challenges SET sms_sent_at=UTC_TIMESTAMP() WHERE token_digest=?",[digest(challenge)]);
 return res.json({status:"success",stage:"sms",challenge,message:"Enter the verification code sent to your registered phone."});
}));
router.post("/sms/verify",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");if(token.length<40||token.length>100)return deny(res);
 const conn=await pool.getConnection();let userId;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["sms_enroll"]);
  if(!row){await conn.rollback();return deny(res);}
  if(!s.verifySms(token,String(req.body?.code||""),row.sms_pin_digest)){await markFailure(conn,row);await conn.commit();return deny(res);}
  userId=row.user_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 return res.json({status:"success",...await createSetup(token,userId)});
}));
router.post("/administrator/start",requireAuth,action(async(req,res)=>{
 if(!isOriginalSystemAdministrator(req.user))return deny(res,403);
 const [sessions]=await pool.query("SELECT session_id FROM auth_sessions WHERE user_id=? AND session_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE) LIMIT 1",[req.user.id,req.user.session_id]);
 if(!sessions.length)return res.status(403).json({status:"error",message:"Sign in again using your trusted administrator session before enrolling."});
 if(await enrolled(req.user.id))return deny(res,409);
 const user=await getUser(req.user.id),workspace=auth.normalizeWorkspaceCode(req.user.workspace_code),branch=number(req.user.branch_id);
 if(!(await accessFor(user,workspace,branch)))return deny(res,403);
 const token=await createChallenge({id:user.id,purpose:"admin_setup",workspace,branch});
 await audit(req,user.id,"ADMIN_ENROLLMENT");
 return res.json({status:"success",challenge:token,...await createSetup(token,user.id)});
}));
router.post("/setup/confirm",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");if(token.length<40||token.length>100)return deny(res);
 const conn=await pool.getConnection();let id,workspace,branch,codes;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["setup"]);
  if(!row||!row.verified_at||!row.pending_ciphertext){await conn.rollback();return deny(res);}
  const secret=s.decryptSecret({ciphertext:row.pending_ciphertext,iv:row.pending_iv,tag:row.pending_tag});
  const counter=s.matchedCounter(secret,String(req.body?.code||""));
  if(counter===null){await markFailure(conn,row);await conn.commit();return deny(res);}
  const [exists]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[row.user_id]);
  if(exists.length){await conn.rollback();return deny(res,409);}
  await conn.query("INSERT INTO staff_passwordless_identities(user_id,secret_ciphertext,secret_iv,secret_tag,verified_at,last_totp_counter) VALUES(?,?,?,?,UTC_TIMESTAMP(),?)",[row.user_id,row.pending_ciphertext,row.pending_iv,row.pending_tag,counter]);
  codes=s.newBackupCodes(row.user_id);
  for(const item of codes)await conn.query("INSERT INTO staff_passwordless_backup_codes(user_id,code_digest) VALUES(?,?)",[row.user_id,item.digest]);
  await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP(),pending_ciphertext=NULL,pending_iv=NULL,pending_tag=NULL WHERE user_id=? AND consumed_at IS NULL",[row.user_id]);
  id=row.user_id;workspace=row.workspace_code;branch=row.branch_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 const session=await sessionFor(req,id,workspace,branch);
 await audit(req,id,"ENROLLED");res.set("Cache-Control","no-store");
 return res.json({...session,recovery_codes:codes.map(x=>x.code),message:"Save your one-time backup codes now; they cannot be viewed again."});
}));
router.post("/verify",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");if(token.length<40||token.length>100)return deny(res);
 const conn=await pool.getConnection();let id,workspace,branch;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["totp_login"]);
  if(!row){await conn.rollback();return deny(res);}
  const [rows]=await conn.query("SELECT * FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[row.user_id]);
  const credential=rows[0];if(!credential){await conn.rollback();return deny(res);}
  const value=String(req.body?.code||"").trim();let approved=false;
  if(/^\d{6}$/.test(value)){
   const secret=s.decryptSecret({ciphertext:credential.secret_ciphertext,iv:credential.secret_iv,tag:credential.secret_tag});
   const counter=s.matchedCounter(secret,value);
   if(counter!==null&&counter>Number(credential.last_totp_counter)){
    await conn.query("UPDATE staff_passwordless_identities SET last_totp_counter=? WHERE user_id=?",[counter,row.user_id]);approved=true;
   }
  }else{
   const codeHash=s.recoveryDigest(row.user_id,value);
   const [found]=await conn.query("SELECT used_at FROM staff_passwordless_backup_codes WHERE user_id=? AND code_digest=? FOR UPDATE",[row.user_id,codeHash]);
   if(found.length&&!found[0].used_at){
    await conn.query("UPDATE staff_passwordless_backup_codes SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND code_digest=? AND used_at IS NULL",[row.user_id,codeHash]);approved=true;
   }
  }
  if(!approved){await markFailure(conn,row);await conn.commit();return deny(res);}
  await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE token_digest=?",[row.token_digest]);
  id=row.user_id;workspace=row.workspace_code;branch=row.branch_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 res.set("Cache-Control","no-store");return res.json(await sessionFor(req,id,workspace,branch));
}));
router.get("/account/status",requireAuth,action(async(req,res)=>{
 const [rows]=await pool.query("SELECT verified_at,google_email,google_linked_at FROM staff_passwordless_identities WHERE user_id=?",[req.user.id]);
 const info=rows[0]||{};
 res.set("Cache-Control","no-store");
 return res.json({status:"success",authenticator_active:!!rows.length,google_linked:!!info.google_linked_at,google_email:info.google_email||null,google_linking_available:googleLinkConfigured()});
}));
router.get("/administrator/readiness",requireAuth,action(async(req,res)=>{
 if(!isOriginalSystemAdministrator(req.user))return deny(res,403);
 const [rows]=await pool.query(
  `SELECT COUNT(*) AS active_users,
    SUM(CASE WHEN identity.user_id IS NULL THEN 1 ELSE 0 END) AS not_enrolled,
    SUM(CASE WHEN user.id<>? AND (user.login_phone_normalized IS NULL OR user.login_phone_normalized='') THEN 1 ELSE 0 END) AS missing_verified_phone,
    SUM(CASE WHEN identity.user_id IS NOT NULL AND COALESCE(codes.unused,0)=0 THEN 1 ELSE 0 END) AS missing_unused_backup_codes,
    SUM(CASE WHEN user.id=? AND identity.user_id IS NOT NULL THEN 1 ELSE 0 END) AS administrator_enrolled
   FROM users user
   LEFT JOIN staff_passwordless_identities identity ON identity.user_id=user.id
   LEFT JOIN (SELECT user_id,COUNT(*) AS unused FROM staff_passwordless_backup_codes
    WHERE used_at IS NULL GROUP BY user_id) codes ON codes.user_id=user.id
   WHERE user.is_active=1`,[req.user.id,req.user.id]
 );
 const [duplicates]=await pool.query(
  "SELECT COUNT(*) n FROM (SELECT login_phone_normalized FROM users WHERE is_active=1 AND login_phone_normalized IS NOT NULL AND login_phone_normalized<>'' GROUP BY login_phone_normalized HAVING COUNT(*)>1) AS repeated"
 );
 const r=rows[0]||{},sms=getSmsConfig();
 const issues={
  inactive_admin_setup:Number(r.administrator_enrolled||0)!==1,
  ordinary_users_pending:Number(r.not_enrolled||0)>0,
  missing_staff_phones:Number(r.missing_verified_phone||0)>0,
  phones_shared:Number(duplicates[0]?.n||0)>0,
  missing_unused_recovery:Number(r.missing_unused_backup_codes||0)>0,
  sms_provider_unavailable:!sms.enabled||sms.provider==="mock"
 };
 const accountSetupReady=!Object.values(issues).some(Boolean);
 res.set("Cache-Control","no-store");
 return res.json({status:"success",eligible_accounts:Number(r.active_users||0),
  enrolled_accounts:Number(r.active_users||0)-Number(r.not_enrolled||0),
  passwordless_cutover_ready:accountSetupReady,issues,
  manual_gates_still_required:["validated signed backup","Google OAuth configuration if linking is offered",
   "approved additive migration and rollback plan","SMS receipt check","all legacy credential paths and sessions audited",
   "approved final staff announcement dispatch"]});
}));

module.exports=router;
