"use strict";
const {SYSTEM_ADMIN_ID,SYSTEM_ADMIN_USERNAME}=require("../security/systemAdminIdentity");
// Preserve prior challenge records and reset only the target's attempt window
// after an authenticated, audited owner action. Same-second attempts count.
const RECOVERY_WINDOW_SQL=" AND created_at >= COALESCE((SELECT MAX(a.created_at) FROM activity_log a WHERE a.entity_type='user' AND a.entity_id=CAST(staff_passwordless_challenges.user_id AS CHAR) AND a.action='STAFF_ACCOUNT_SECURITY_RESET' AND a.outcome='success'),'1970-01-02 00:00:00')";
function recoveryAllowed(actor,target){
 return !!actor&&!!target&&Number(target.id)!==Number(actor.id)&&Number(target.id)!==SYSTEM_ADMIN_ID&&String(target.username||"").trim().toLowerCase()!==SYSTEM_ADMIN_USERNAME&&String(target.role||"").toLowerCase()!=="admin"&&Number(target.is_active)===1;
}
function recoveryMode(value){return value===undefined?"reenroll":(["unlock","reenroll"].includes(value)?value:null);}
module.exports={RECOVERY_WINDOW_SQL,recoveryAllowed,recoveryMode};
