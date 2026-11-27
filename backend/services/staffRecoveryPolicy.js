"use strict";
const {SYSTEM_ADMIN_ID,SYSTEM_ADMIN_USERNAME}=require("../security/systemAdminIdentity");
// Preserve prior challenge records and reset only the target's attempt window
// after an authenticated, audited owner action. Same-second attempts count.
const RECOVERY_WINDOW_SQL=" AND created_at >= COALESCE((SELECT MAX(a.created_at) FROM activity_log a WHERE a.entity_type='user' AND CAST(a.entity_id AS BINARY)=CAST(CAST(staff_passwordless_challenges.user_id AS CHAR CHARACTER SET ascii) AS BINARY) AND a.action='STAFF_ACCOUNT_SECURITY_RESET' AND a.outcome='success'),'1970-01-02 00:00:00')";
function recoveryAllowed(actor,target){
 return !!actor&&!!target&&Number(target.id)!==Number(actor.id)&&Number(target.id)!==SYSTEM_ADMIN_ID&&String(target.username||"").trim().toLowerCase()!==SYSTEM_ADMIN_USERNAME&&String(target.role||"").toLowerCase()!=="admin"&&Number(target.is_active)===1;
}
function recoveryMode(value){return value===undefined?"reenroll":(["unlock","reenroll"].includes(value)?value:null);}
// An audited full reset permanently retires legacy access for the target, even
// before global enforcement. Retain the marker in the immutable audit history.
// Existing enrollment also retires the password path. Fail closed on DB errors.
async function legacyStaffLoginRetired(db,userId){
 const [rows]=await db.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id = ? LIMIT 1",[userId]);
 if(rows.length)return true;
 const [resets]=await db.query("SELECT id FROM activity_log WHERE entity_type='user' AND entity_id=? AND action='STAFF_AUTHENTICATOR_REVOKED' AND outcome='success' LIMIT 1",[String(userId)]);
 return resets.length>0;
}
module.exports={RECOVERY_WINDOW_SQL,recoveryAllowed,recoveryMode,legacyStaffLoginRetired};
