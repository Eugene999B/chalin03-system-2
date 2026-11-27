"use strict";
const crypto=require("node:crypto");
const {buildOtpAuthUri,generateTotpSecret,generateRecoveryCodes,totpAt}=require("./ownerMfaService");
const SMS_TTL_SECONDS=300,ENROLL_TTL_SECONDS=900,MAX_SMS_ATTEMPTS=5,MAX_SMS_PER_HOUR=3,SMS_COOLDOWN_SECONDS=60;
function secureKey(name,env=process.env){
 const v=String(env[name]||"");
 if(v.length<32)throw new Error(name+" requires a unique 32+ character secret");
 return crypto.createHash("sha256").update(v).digest();
}
function newChallenge(){return crypto.randomBytes(32).toString("base64url");}
function digestChallenge(value,env=process.env){
 return crypto.createHmac("sha256",secureKey("STAFF_PASSWORDLESS_HMAC_KEY",env)).update("challenge:"+String(value)).digest("hex");
}
function newSmsCode(){return String(crypto.randomInt(1000000)).padStart(6,"0");}
function smsDigest(token,code,env=process.env){
 if(!/^\d{6}$/.test(String(code)))throw new Error("Invalid SMS code");
 return crypto.createHmac("sha256",secureKey("STAFF_PASSWORDLESS_HMAC_KEY",env)).update("sms:"+token+":"+code).digest("hex");
}
function safeEqualHex(a,b){
 if(!/^[a-f0-9]{64}$/.test(String(a))||!/^[a-f0-9]{64}$/.test(String(b)))return false;
 return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function verifySms(token,code,expected,env=process.env){
 return /^\d{6}$/.test(String(code))&&safeEqualHex(smsDigest(token,code,env),expected);
}
function encryptSecret(value,env=process.env){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",secureKey("STAFF_PASSWORDLESS_ENCRYPTION_KEY",env),iv);
 const data=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);
 return {ciphertext:data.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
function decryptSecret(item,env=process.env){
 const decipher=crypto.createDecipheriv("aes-256-gcm",secureKey("STAFF_PASSWORDLESS_ENCRYPTION_KEY",env),Buffer.from(item.iv,"base64"));
 decipher.setAuthTag(Buffer.from(item.tag,"base64"));
 return Buffer.concat([decipher.update(Buffer.from(item.ciphertext,"base64")),decipher.final()]).toString("utf8");
}
function recoveryDigest(id,code,env=process.env){
 const clean=String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 return crypto.createHmac("sha256",secureKey("STAFF_PASSWORDLESS_HMAC_KEY",env)).update("recovery:"+id+":"+clean).digest("hex");
}
function safeEqualCode(a,b){
 if(!/^\d{6}$/.test(String(a))||!/^\d{6}$/.test(String(b)))return false;
 return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function matchedCounter(secret,code,time=Date.now()){
 if(!/^\d{6}$/.test(String(code)))return null;
 const base=Math.floor(time/30000);
 for(let offset=-1;offset<=1;offset++){
  const counter=base+offset;
  if(counter>=0 && safeEqualCode(totpAt(secret,{timestamp:counter*30000}),code))return counter;
 }
 return null;
}
function newAuthenticator(username){
 const secret=generateTotpSecret();
 return {secret,uri:buildOtpAuthUri({secret,username,issuer:"CHALIN03"})};
}
function newBackupCodes(userId,env=process.env){
 return generateRecoveryCodes(10).map(code=>({code,digest:recoveryDigest(userId,code,env)}));
}
function noticeText(){
 return "CHALIN03: Password sign-in is being replaced. Install Google Authenticator or another authenticator app. On first sign-in verify your phone via SMS, scan the QR code and save backup codes. Never share your codes.";
}
function pilotEnabled(env=process.env){return String(env.STAFF_PASSWORDLESS_PILOT||"").toLowerCase()==="true";}
function enforced(env=process.env){return String(env.STAFF_PASSWORDLESS_ENFORCED||"").toLowerCase()==="true";}
function assertConfigured(env=process.env){
 if(!pilotEnabled(env)&&!enforced(env))return false;
 secureKey("STAFF_PASSWORDLESS_HMAC_KEY",env);
 secureKey("STAFF_PASSWORDLESS_ENCRYPTION_KEY",env);
 if(env.STAFF_PASSWORDLESS_HMAC_KEY===env.STAFF_PASSWORDLESS_ENCRYPTION_KEY)throw new Error("Passwordless crypto keys must be independent");
 if(enforced(env)&&!pilotEnabled(env))throw new Error("Enforcement requires an enabled pilot");
 return true;
}
module.exports={SMS_TTL_SECONDS,ENROLL_TTL_SECONDS,MAX_SMS_ATTEMPTS,MAX_SMS_PER_HOUR,SMS_COOLDOWN_SECONDS,
 newChallenge,digestChallenge,newSmsCode,smsDigest,safeEqualHex,verifySms,
 encryptSecret,decryptSecret,recoveryDigest,matchedCounter,newAuthenticator,newBackupCodes,
 noticeText,pilotEnabled,enforced,assertConfigured};
