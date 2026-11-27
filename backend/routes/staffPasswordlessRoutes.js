"use strict";
/* Controlled pilot. Requires independent approved schema migration.
 * Original admin bypasses FIRST enrollment SMS only after a recent,
 * authenticated session. No anonymous administrator bootstrap.
 */
const express=require("express"),QRCode=require("qrcode"),bcrypt=require("bcryptjs");
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
const {issueStaffSession}=require("../services/staffCookieSession");
const {verifyStaffProtectedAction}=require("../services/staffProtectedActionService");
const {rotationBinding,liveRotationRow,retireAuthenticatorAccess,unlockStaffAccess}=require("../services/staffAuthenticatorLifecycle");
const {RECOVERY_WINDOW_SQL,recoveryAllowed,recoveryMode}=require("../services/staffRecoveryPolicy");
const {turnstileConfig,verifyStaffTurnstile}=require("../services/staffTurnstile");
s.assertConfigured();
const GENERIC="The account or security code could not be verified. Check your details or contact the administrator.";
const OTP_WINDOW_MINUTES=15,OTP_MAX_FAILURES=10;
const incorrectCode=(res,row,kind="authenticator")=>{
 const attemptsLeft=Math.max(0,s.MAX_SMS_ATTEMPTS-Number(row.attempts)-1);
 res.set("Cache-Control","no-store");
 if(attemptsLeft===0)return res.status(429).json({
  status:"error",code:"CODE_ATTEMPTS_EXHAUSTED",
  message:"Too many incorrect codes. Start a new verification after a short break.",
  attempts_remaining:0
 });
 return res.status(422).json({
  status:"error",code:"SECURITY_CODE_INCORRECT",
  message:kind==="sms"?"That SMS code is incorrect. Please check it and try again.":"Incorrect or expired code. Wait for a fresh code in Authenticator and try again.",
  attempts_remaining:attemptsLeft
 });
};
const unavailableChallenge=(res)=>res.status(410).json({
 status:"error",code:"VERIFICATION_EXPIRED",
 message:"This verification has ended or expired. Select Start again to request a new code."
});
async function tooManyCodeFailures(userId,conn=pool){
 const [rows]=await conn.query(
  "SELECT COALESCE(SUM(attempts),0) AS n FROM staff_passwordless_challenges WHERE user_id=? AND purpose='totp_login' AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)"+RECOVERY_WINDOW_SQL,
  [userId,OTP_WINDOW_MINUTES]
 );
 return Number(rows[0]?.n||0)>=OTP_MAX_FAILURES;
}

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
async function sessionFor(req,userId,workspaceCode,branchId,verifiedVersion){
 const user=await getUser(userId);
 if(!user||!Number(user.is_active)||Number(user.is_login_locked))throw new Error("Account inactive");
 if(verifiedVersion!==undefined&&Number(user.token_version||0)!==Number(verifiedVersion))throw new Error("Account security state changed");
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
 await pool.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL AND NOT (purpose='admin_setup' AND verified_at IS NOT NULL AND pending_ciphertext IS NOT NULL)",[id]);
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
 const [rows]=await pool.query("SELECT COUNT(*) n FROM staff_passwordless_challenges WHERE user_id=? AND (purpose=? OR (?='sms_enroll' AND sms_sent_at IS NOT NULL)) AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)"+RECOVERY_WINDOW_SQL,[id,purpose,purpose,mins]);
 return Number(rows[0]?.n||0)<cap;
}
router.get("/mode",(req,res)=>{res.set("Cache-Control","no-store");return res.json({status:"success",pilot:true,enforced:s.enforced(),turnstile_site_key:turnstileConfig().siteKey});});
router.post("/start",action(async(req,res)=>{
 const name=String(req.body?.identifier||"").trim().slice(0,120),workspace=auth.normalizeWorkspaceCode(req.body?.workspace_code),branch=number(req.body?.branch_id);
 if(!name||!workspace)return deny(res);
 const human=await verifyStaffTurnstile(req.body?.turnstile_token);
 if(!human.ok)return res.status(human.unavailable?503:403).json({status:"error",code:"SECURITY_CHALLENGE_REQUIRED",message:human.unavailable?"Security verification is temporarily unavailable. Please try again.":"Complete the security check and try again. If it is not visible, refresh this page."});
 const look=await auth.findUsersForLogin(name),user=look.users?.[0];
 if(!user||!Number(user.is_active)||Number(user.is_login_locked))return deny(res);
 if(!(await accessFor(user,workspace,branch)))return deny(res);
 const alreadyEnrolled=await enrolled(user.id);
 // A public username can never bootstrap the original administrator.
 if(isOriginalSystemAdministrator(user)&&!alreadyEnrolled){
  // A username is not proof of identity. Create a short-lived, limited
  // first-setup challenge. The account owner verifies the EXISTING credential
  // exactly once before an Authenticator secret can ever be generated.
  // Subsequent sign-ins use only the Authenticator or a recovery code.
  if(!(await belowLimit(user.id,"admin_setup",5,60)))return deny(res,429);
  const challenge=await createChallenge({id:user.id,purpose:"admin_setup",workspace,branch});
  res.set("Cache-Control","no-store");
  return res.json({status:"success",stage:"identity",challenge});
 }
 if(alreadyEnrolled){
  if(!(await belowLimit(user.id,"totp_login",8,10))||await tooManyCodeFailures(user.id)){
   res.set("Retry-After","900");
   return res.status(429).json({status:"error",code:"RATE_LIMITED",message:"Too many recent attempts. Try again after 15 minutes."});
  }
  const challenge=await createChallenge({id:user.id,purpose:"totp_login",workspace,branch});
  return res.json({status:"success",stage:"authenticator",challenge});
 }
 const phone=normalizeGhanaPhone(user.login_phone_normalized||user.phone),config=getSmsConfig();
 if(!phone)return deny(res);
 // Duplicated staff phone assignments require admin correction before onboarding.
 const [matchingPhones]=await pool.query("SELECT COUNT(*) AS n FROM users WHERE login_phone_normalized=? AND is_active=1",[phone]);
 if(Number(matchingPhones[0]?.n||0)!==1)return deny(res);
 if(!config.enabled||config.provider==="mock")return res.status(503).json({status:"error",message:"Phone verification is not available. Contact the administrator."});
 if(!(await belowLimit(user.id,"sms_enroll",s.MAX_SMS_PER_HOUR,60))){res.set("Retry-After","3600");return res.status(429).json({status:"error",code:"RATE_LIMITED",message:"Too many verification SMS requests. Retry after the hourly limit expires or contact the System Administrator."});}
 const [sentEarlier]=await pool.query("SELECT sms_sent_at FROM staff_passwordless_challenges WHERE user_id=? AND sms_sent_at IS NOT NULL"+RECOVERY_WINDOW_SQL+" ORDER BY created_at DESC LIMIT 1",[user.id]);
 if(sentEarlier.length&&Date.now()-new Date(sentEarlier[0].sms_sent_at).getTime()<s.SMS_COOLDOWN_SECONDS*1000){res.set("Retry-After","60");return res.status(429).json({status:"error",code:"RATE_LIMITED",message:"A verification SMS was recently requested. Allow at least one minute before requesting another."});}
 const code=s.newSmsCode(),challenge=await createChallenge({id:user.id,purpose:"sms_enroll",workspace,branch,smsCode:code});
 const sent=await sendSmsAlertToPhone({branchId:branch||user.default_branch_id||1,phone,
  message:"CHALIN03 verification: "+code+". Expires in 5 minutes. Do not share this code.",
  logMessage:"CHALIN03 first-time staff verification code [REDACTED]",smsType:"security_alert",sourceReference:"staff-passwordless-enrollment"});
 if(!sent.ok){await pool.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE token_digest=?",[digest(challenge)]);
  return res.status(503).json({status:"error",message:"SMS verification is currently unavailable."});}
 await pool.query("UPDATE staff_passwordless_challenges SET sms_sent_at=UTC_TIMESTAMP() WHERE token_digest=?",[digest(challenge)]);
 return res.json({status:"success",stage:"sms",challenge,message:"Enter the verification code sent to your registered phone."});
}));
// Single-use identity verification for the ORIGINAL account only.
// Cannot expose the TOTP seed from a username or caller-supplied user ID.
// No SMS is ever sent in this flow. It is disabled after enrollment.
router.post("/first-setup/verify",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");
 const password=typeof req.body?.verification==="string"?req.body.verification:"";
 if(token.length<40||token.length>100||password.length===0||password.length>256)return deny(res);
 const conn=await pool.getConnection();let userId;
 try{
  await conn.beginTransaction();
  const row=await challengeRow(conn,token,["admin_setup"]);
  if(!row||row.verified_at||row.pending_ciphertext){await conn.rollback();return deny(res);}
  const user=await getUser(row.user_id);
  if(!user||!isOriginalSystemAdministrator(user)||!Number(user.is_active)||Number(user.is_login_locked)){
   await conn.rollback();return deny(res);
  }
  const [enrolledRows]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[row.user_id]);
  if(enrolledRows.length){await conn.rollback();return deny(res,409);}
  const verified=await bcrypt.compare(password,user.password_hash);
  if(!verified){
   await markFailure(conn,row);
   await conn.commit();
   return deny(res);
  }
  // Atomically retire the proof stage before returning an enrollment key.
  // A second concurrent confirmation cannot produce a competing QR secret.
  await conn.query(
   "UPDATE staff_passwordless_challenges SET purpose='setup' WHERE token_digest=? AND purpose='admin_setup' AND consumed_at IS NULL",
   [row.token_digest]
  );
  userId=row.user_id;
  await conn.commit();
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 // The challenge is upgraded, not copied. It remains short-lived and can
 // only be completed with a valid code from the new Authenticator.
 const setup=await createSetup(token,userId);
 await audit(req,userId,"OWNER_FIRST_SETUP_VERIFIED");
 res.set("Cache-Control","no-store");
 return res.json({status:"success",challenge:token,...setup});
}));
router.post("/sms/verify",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");if(token.length<40||token.length>100)return deny(res);
 const conn=await pool.getConnection();let userId;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["sms_enroll"]);
  if(!row){await conn.rollback();return deny(res);}
  if(!s.verifySms(token,String(req.body?.code||""),row.sms_pin_digest)){await markFailure(conn,row);await conn.commit();return incorrectCode(res,row,"sms");}
  userId=row.user_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 return res.json({status:"success",...await createSetup(token,userId)});
}));
// The account name is not proof of ownership. This is used only when a
// recently authenticated original account owner enters their own username
// on the normal sign-in design. No SMS and no public enrollment key.
router.post("/start/verified",requireAuth,action(async(req,res)=>{
 const lookup=await auth.findUsersForLogin(String(req.body?.identifier||"").trim().slice(0,120));
 const candidate=lookup.users?.[0];
 if(!candidate||!isOriginalSystemAdministrator(req.user)||!isOriginalSystemAdministrator(candidate)||
    Number(candidate.id)!==Number(req.user.id))return deny(res,403);
 const workspace=auth.normalizeWorkspaceCode(req.body?.workspace_code);
 const branch=number(req.body?.branch_id);
 if(!(await accessFor(candidate,workspace,branch)))return deny(res,403);
 const [sessions]=await pool.query(
  "SELECT session_id FROM auth_sessions WHERE user_id=? AND session_id=? AND revoked_at IS NULL AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE) AND expires_at>UTC_TIMESTAMP() LIMIT 1",
  [req.user.id,req.user.session_id]);
 if(!sessions.length)return res.status(403).json({
  status:"error",code:"RECENT_SESSION_REQUIRED",
  message:"Your secure session needs to be confirmed again before creating a new Authenticator key."
 });
 if(await enrolled(candidate.id))return deny(res,409);
 const token=await createChallenge({id:candidate.id,purpose:"admin_setup",workspace,branch});
 const setup=await createSetup(token,candidate.id);
 await audit(req,candidate.id,"TRUSTED_FIRST_SETUP");
 res.set("Cache-Control","no-store");
 return res.json({status:"success",challenge:token,...setup});
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
 const conn=await pool.getConnection();let id,workspace,branch,codes,verifiedVersion;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["setup"]);
  if(!row||!row.verified_at||!row.pending_ciphertext){await conn.rollback();return unavailableChallenge(res);}
  const secret=s.decryptSecret({ciphertext:row.pending_ciphertext,iv:row.pending_iv,tag:row.pending_tag});
  const counter=s.matchedCounter(secret,String(req.body?.code||""));
  if(counter===null){await markFailure(conn,row);await conn.commit();return incorrectCode(res,row);}
  const [current]=await conn.query("SELECT token_version,is_active,is_login_locked FROM users WHERE id=? FOR UPDATE",[row.user_id]);
  if(!current[0]||!Number(current[0].is_active)||Number(current[0].is_login_locked)){await conn.rollback();return deny(res,403);}
  verifiedVersion=Number(current[0].token_version||0);
  const [exists]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[row.user_id]);
  if(exists.length){await conn.rollback();return deny(res,409);}
  await conn.query("INSERT INTO staff_passwordless_identities(user_id,secret_ciphertext,secret_iv,secret_tag,verified_at,last_totp_counter) VALUES(?,?,?,?,UTC_TIMESTAMP(),?)",[row.user_id,row.pending_ciphertext,row.pending_iv,row.pending_tag,counter]);
  codes=s.newBackupCodes(row.user_id);
  for(const item of codes)await conn.query("INSERT INTO staff_passwordless_backup_codes(user_id,code_digest) VALUES(?,?)",[row.user_id,item.digest]);
  await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP(),pending_ciphertext=NULL,pending_iv=NULL,pending_tag=NULL WHERE user_id=? AND consumed_at IS NULL",[row.user_id]);
  id=row.user_id;workspace=row.workspace_code;branch=row.branch_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 const session=await sessionFor(req,id,workspace,branch,verifiedVersion);
 await audit(req,id,"ENROLLED");res.set("Cache-Control","no-store");
 return res.json(issueStaffSession(req,res,{...session,recovery_codes:codes.map(x=>x.code),message:"Save your one-time backup codes now; they cannot be viewed again."}));
}));
router.post("/verify",action(async(req,res)=>{
 const token=String(req.body?.challenge||"");if(token.length<40||token.length>100)return deny(res);
 const conn=await pool.getConnection();let id,workspace,branch,verifiedVersion;
 try{
  await conn.beginTransaction();const row=await challengeRow(conn,token,["totp_login"]);
  if(!row){await conn.rollback();return unavailableChallenge(res);}
  if(await tooManyCodeFailures(row.user_id,conn)){await conn.rollback();res.set("Retry-After","900");return res.status(429).json({status:"error",code:"RATE_LIMITED",message:"Too many recent attempts. Try again after 15 minutes."});}
  const [current]=await conn.query("SELECT token_version,is_active,is_login_locked FROM users WHERE id=? FOR UPDATE",[row.user_id]);
  if(!current[0]||!Number(current[0].is_active)||Number(current[0].is_login_locked)){await conn.rollback();return deny(res,403);}
  verifiedVersion=Number(current[0].token_version||0);
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
  if(!approved){await markFailure(conn,row);await conn.commit();return incorrectCode(res,row);}
  await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP() WHERE token_digest=?",[row.token_digest]);
  id=row.user_id;workspace=row.workspace_code;branch=row.branch_id;await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 res.set("Cache-Control","no-store");return res.json(issueStaffSession(req,res,await sessionFor(req,id,workspace,branch,verifiedVersion)));
}));

// Authenticated self-rotation. The existing secret remains usable until the
// new authenticator is proven. The isolated, encrypted challenge is bound to
// the currently verified session and cannot be redeemed by public enrollment.
router.post("/account/rotate/start",requireAuth,action(async(req,res)=>{
 res.set("Cache-Control","no-store");
 const checked=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
 if(!checked.ok){if(checked.status===429)res.set("Retry-After","900");return res.status(checked.status).json({status:"error",code:checked.code,message:checked.message});}
 const token=s.newChallenge(),fresh=s.newAuthenticator(req.user.username),box=s.encryptSecret(fresh.secret);
 const qr=await QRCode.toDataURL(fresh.uri,{width:260,margin:2});
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  if(!(await liveRotationRow(conn,req.user))){await conn.rollback();return deny(res,403);}
  await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=UTC_TIMESTAMP(),pending_ciphertext=NULL,pending_iv=NULL,pending_tag=NULL WHERE user_id=? AND purpose='admin_setup' AND verified_at IS NOT NULL AND consumed_at IS NULL",[req.user.id]);
  await conn.query("INSERT INTO staff_passwordless_challenges(token_digest,user_id,purpose,workspace_code,branch_id,sms_pin_digest,pending_ciphertext,pending_iv,pending_tag,verified_at,expires_at) VALUES(?,?,'admin_setup',?,?,?,?,?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE))",[digest(token),req.user.id,req.user.workspace_code,req.user.branch_id||null,rotationBinding(token,req.user),box.ciphertext,box.iv,box.tag]);
  await writeAuditEvent({connection:conn,req,action:"STAFF_AUTHENTICATOR_ROTATION_STARTED",actionType:"security.staff_authenticator.rotation_started",severity:"warning",entityType:"user",entityId:req.user.id,details:"Verified account holder started Authenticator replacement."});
  await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 return res.json({status:"success",challenge:token,stage:"rotation",secret:fresh.secret,qr_data_url:qr});
}));
router.post("/account/rotate/confirm",requireAuth,action(async(req,res)=>{
 res.set("Cache-Control","no-store");
 const token=String(req.body?.challenge||""),code=String(req.body?.code||"");
 if(token.length<40||token.length>100||!/^\d{6}$/.test(code))return deny(res,400);
 const conn=await pool.getConnection();let codes,newVersion,workspace,branch;
 try{
  await conn.beginTransaction();
  const row=await challengeRow(conn,token,["admin_setup"]);
  if(!row||Number(row.user_id)!==Number(req.user.id)||!row.verified_at||!row.pending_ciphertext||
   !s.safeEqualHex(row.sms_pin_digest,rotationBinding(token,req.user))){await conn.rollback();return unavailableChallenge(res);}
  if(!(await liveRotationRow(conn,req.user))){await conn.rollback();return deny(res,403);}
  const secret=s.decryptSecret({ciphertext:row.pending_ciphertext,iv:row.pending_iv,tag:row.pending_tag});
  const counter=s.matchedCounter(secret,code);
  if(counter===null){await markFailure(conn,row);await conn.commit();return incorrectCode(res,row);}
  codes=s.newBackupCodes(req.user.id);
  await retireAuthenticatorAccess(conn,req.user.id,"authenticator_rotated");
  await conn.query("UPDATE staff_passwordless_identities SET secret_ciphertext=?,secret_iv=?,secret_tag=?,last_totp_counter=?,verified_at=UTC_TIMESTAMP(),google_sub=NULL,google_email=NULL,google_linked_at=NULL WHERE user_id=?",[row.pending_ciphertext,row.pending_iv,row.pending_tag,counter,req.user.id]);
  for(const item of codes)await conn.query("INSERT INTO staff_passwordless_backup_codes(user_id,code_digest) VALUES(?,?)",[req.user.id,item.digest]);
  await writeAuditEvent({connection:conn,req,action:"STAFF_AUTHENTICATOR_ROTATED",actionType:"security.staff_authenticator.rotated",severity:"critical",entityType:"user",entityId:req.user.id,details:"Authenticator replaced after proof of old and new codes. Previous sessions and recovery credentials revoked."});
  newVersion=Number(req.user.token_version||0)+1;workspace=row.workspace_code;branch=row.branch_id;
  await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 const session=await sessionFor(req,req.user.id,workspace,branch,newVersion);
 return res.json(issueStaffSession(req,res,{...session,recovery_codes:codes.map(x=>x.code),message:"Authenticator replaced. Old keys, sessions and backup codes are no longer valid."}));
}));
// Staff recovery is deliberately narrower than owner handover. Only the
// original administrator may revoke ordinary staff credentials after fresh
// TOTP proof. Elevated accounts must use rotation or stronger owner recovery.
router.post("/administrator/revoke-authenticator",requireAuth,action(async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(!isOriginalSystemAdministrator(req.user))return deny(res,403);
 // Pilot recovery is safe because legacy password access remains retired for the selected account after a full reset.
 if(!s.pilotEnabled()||!s.assertConfigured())return res.status(503).json({status:"error",code:"AUTHENTICATOR_UNAVAILABLE",message:"Secure Authenticator recovery is temporarily unavailable."});
 const target=number(req.body?.user_id),reason=String(req.body?.reason||"").trim().slice(0,500),mode=recoveryMode(req.body?.mode);
 if(!target||!mode||target===Number(req.user.id)||reason.length<8)return res.status(400).json({status:"error",message:"Select another staff account and enter a reason of at least eight characters."});
 const checked=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
 if(!checked.ok){if(checked.status===429)res.set("Retry-After","900");return res.status(checked.status).json({status:"error",code:checked.code,message:checked.message});}
 const config=getSmsConfig();
 if(mode==="reenroll"&&(!config.enabled||config.provider==="mock"))return res.status(409).json({status:"error",message:"Verified phone enrollment is unavailable. Do not revoke this Authenticator yet."});
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  if(!(await liveRotationRow(conn,req.user))){await conn.rollback();return deny(res,403);}
  const [rows]=await conn.query("SELECT id,username,role,is_active,is_login_locked,login_phone_normalized FROM users WHERE id=? FOR UPDATE",[target]);
  const user=rows[0];
  if(!recoveryAllowed(req.user,user)){
   await conn.rollback();return res.status(409).json({status:"error",message:"This account requires verified self-rotation or separate administrator recovery."});
  }
  const [identity]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[target]);
  if(mode==="reenroll"){
   if(!config.enabled||config.provider==="mock"){await conn.rollback();return res.status(409).json({status:"error",message:"Verified phone enrollment is unavailable. Contact support before resetting."});}
   const phone=normalizeGhanaPhone(user.login_phone_normalized);
   const [matching]=await conn.query("SELECT COUNT(*) n FROM users WHERE login_phone_normalized=? AND is_active=1",[phone||""]);
   if(!phone||Number(matching[0]?.n||0)!==1){await conn.rollback();return res.status(409).json({status:"error",message:"A unique registered phone is required for safe staff re-enrollment."});}
  }
  if(mode==="reenroll"){
   await retireAuthenticatorAccess(conn,target,"authenticator_revoked");
   await conn.query("DELETE FROM staff_passwordless_identities WHERE user_id=?",[target]);
  }else await unlockStaffAccess(conn,target);
  await conn.query("UPDATE users SET failed_login_attempts=0,locked_until=NULL,is_login_locked=FALSE,login_locked_at=NULL,login_lock_reason=NULL,last_failed_login_at=NULL,last_failed_login_ip=NULL WHERE id=?",[target]);
  await conn.query("UPDATE password_recovery_otps SET invalidated_at=NOW(),invalidation_reason='administrator_reset' WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL",[target]);
  const auditId=await writeAuditEvent({connection:conn,req,action:"STAFF_ACCOUNT_SECURITY_RESET",actionType:"security.staff_authenticator.reset",severity:"critical",entityType:"user",entityId:target,details:mode==="reenroll"?"Owner reset staff Authenticator and login restrictions. Registered phone verification required.":"Owner cleared staff login restrictions; existing Authenticator retained.",metadata:{reason,mode,previously_locked:Boolean(Number(user.is_login_locked)),previously_enrolled:identity.length===1}});
  if(!auditId)throw new Error("Required recovery audit was not recorded");
  if(mode==="reenroll"){
   const revokeAudit=await writeAuditEvent({connection:conn,req,action:"STAFF_AUTHENTICATOR_REVOKED",actionType:"security.staff_authenticator.revoked",severity:"critical",entityType:"user",entityId:target,details:"Existing staff Authenticator and backup credentials revoked.",metadata:{reason,legacy_signin_retired:true}});
   if(!revokeAudit)throw new Error("Required revocation audit was not recorded");
  }
  await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 return res.json({status:"success",message:mode==="reenroll"?"Staff account reset. Previous Authenticator and sessions revoked. The user must verify their registered phone and enroll again. Permissions are unchanged.":"Staff login restrictions cleared. Existing Authenticator is retained; previous sessions and pending sign-in challenges revoked."});
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
