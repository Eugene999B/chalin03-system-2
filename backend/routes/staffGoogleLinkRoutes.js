"use strict";
/* Google OIDC account linking only, never an authority/role grant.
 * Every link starts with recent authenticator step-up on an existing session.
 */
const express=require("express");
const {pool}=require("../config/db");
const {requireAuth}=require("../middleware/authMiddleware");
const p=require("../services/staffPasswordlessCrypto");
const google=require("../services/staffGoogleOidcService");
const {writeAuditEvent}=require("../services/auditTrailService");
const router=express.Router();
const safe=(res,status=400)=>res.status(status).json({status:"error",message:"Google account linking could not be completed. Sign in again and try once more."});
const action=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(err=>{
 console.warn("Staff Google linking:",String(err.code||err.name||"unknown").slice(0,50));
 return safe(res,503);
});
function resultUrl(ok){
 return "https://work.chalin03.com/account-security?google="+(ok?"linked":"error");
}
router.post("/start",requireAuth,action(async(req,res)=>{
 if(!google.configured())return res.status(503).json({status:"error",message:"Google account linking is not yet configured."});
 const code=String(req.body?.authenticator_code||"");
 if(!/^\d{6}$/.test(code))return safe(res);
 const conn=await pool.getConnection();let url;
 try{
  await conn.beginTransaction();
  const [sessions]=await conn.query("SELECT session_id FROM auth_sessions WHERE user_id=? AND session_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() LIMIT 1",[req.user.id,req.user.session_id]);
  if(!sessions.length){await conn.rollback();return safe(res,403);}
  const [rows]=await conn.query("SELECT * FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[req.user.id]);
  const user=rows[0];
  if(!user||user.google_sub){await conn.rollback();return safe(res,409);}
  const secret=p.decryptSecret({ciphertext:user.secret_ciphertext,iv:user.secret_iv,tag:user.secret_tag});
  const counter=p.matchedCounter(secret,code);
  if(counter===null||counter<=Number(user.last_totp_counter)){await conn.rollback();return safe(res);}
  await conn.query("UPDATE staff_passwordless_identities SET last_totp_counter=? WHERE user_id=?",[counter,req.user.id]);
  const state=google.randomUrlSafe(32),nonce=google.randomUrlSafe(32),verifier=google.randomUrlSafe(48);
  const encrypted=p.encryptSecret(verifier),hash=p.digestChallenge(state);
  await conn.query("INSERT INTO staff_passwordless_google_links(state_digest,user_id,session_id,nonce,pkce_ciphertext,pkce_iv,pkce_tag,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE))",
   [hash,req.user.id,req.user.session_id,nonce,encrypted.ciphertext,encrypted.iv,encrypted.tag]);
  url=google.authorizeUrl({state,nonce,verifier});
  await conn.commit();
 }catch(err){await conn.rollback();throw err;}finally{conn.release();}
 res.set("Cache-Control","no-store");
 return res.json({status:"success",authorization_url:url});
}));
router.get("/callback",action(async(req,res)=>{
 const state=String(req.query?.state||""),code=String(req.query?.code||"");
 if(!google.configured()||!code||code.length>1500||state.length<35||state.length>140)return res.redirect(303,resultUrl(false));
 const conn=await pool.getConnection();let row;
 try{
  await conn.beginTransaction();
  const [rows]=await conn.query("SELECT * FROM staff_passwordless_google_links WHERE state_digest=? FOR UPDATE",[p.digestChallenge(state)]);
  row=rows[0];
  if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now()){await conn.rollback();return res.redirect(303,resultUrl(false));}
  const [sessions]=await conn.query("SELECT session_id FROM auth_sessions WHERE user_id=? AND session_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() LIMIT 1",[row.user_id,row.session_id]);
  if(!sessions.length){await conn.rollback();return res.redirect(303,resultUrl(false));}
  await conn.query("UPDATE staff_passwordless_google_links SET consumed_at=UTC_TIMESTAMP() WHERE state_digest=?",[row.state_digest]);
  await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 try{
  const verifier=p.decryptSecret({ciphertext:row.pkce_ciphertext,iv:row.pkce_iv,tag:row.pkce_tag});
  const token=await google.getGoogleIdToken({code,verifier});
  const keys=await google.fetchGoogleJwks();
  const identity=google.verifyGoogleIdToken(token,keys,{clientId:process.env.GOOGLE_OIDC_CLIENT_ID,expectedNonce:row.nonce});
  const update=await pool.query("UPDATE staff_passwordless_identities i INNER JOIN auth_sessions a ON a.user_id=i.user_id AND a.session_id=? AND a.revoked_at IS NULL AND a.expires_at>UTC_TIMESTAMP() SET i.google_sub=?,i.google_email=?,i.google_linked_at=UTC_TIMESTAMP() WHERE i.user_id=? AND i.google_sub IS NULL",
   [row.session_id,identity.sub,identity.email,row.user_id]);
  if(update[0].affectedRows!==1)return res.redirect(303,resultUrl(false));
  await writeAuditEvent({userId:row.user_id,action:"STAFF_GOOGLE_ACCOUNT_LINKED",actionType:"security.staff_google_link",
   outcome:"success",severity:"notice",entityType:"user",entityId:row.user_id,details:"Verified Google OpenID subject linked. No roles or permissions changed."});
  return res.redirect(303,resultUrl(true));
 }catch(err){
  console.warn("Google OAuth verification failure:",String(err.code||err.name||"invalid-token").slice(0,70));
  return res.redirect(303,resultUrl(false));
 }
}));
module.exports=router;
