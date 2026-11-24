"use strict";
const s=require("./staffPasswordlessCrypto");
// Reuses the existing encrypted challenge store with a domain-separated,
// session-bound marker. Only the authenticated rotation endpoints can redeem it.
function rotationBinding(token,user,env=process.env){
 return s.digestChallenge("authenticator-rotation:"+user.id+":"+user.session_id+":"+user.token_version+":"+token,env);
}
async function liveRotationRow(conn,user){
 const [rows]=await conn.query("SELECT id,token_version,is_active,is_login_locked FROM users WHERE id=? FOR UPDATE",[user.id]);
 if(!rows[0]||!Number(rows[0].is_active)||Number(rows[0].is_login_locked)||Number(rows[0].token_version||0)!==Number(user.token_version||0))return false;
 const [identities]=await conn.query("SELECT user_id FROM staff_passwordless_identities WHERE user_id=? FOR UPDATE",[user.id]);
 const [sessions]=await conn.query("SELECT session_id FROM auth_sessions WHERE user_id=? AND session_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",[user.id,user.session_id]);
 return identities.length===1&&sessions.length===1;
}
async function retireAuthenticatorAccess(conn,userId,reason){
 await conn.query("UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?",[userId]);
 await conn.query("UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(),revocation_reason=? WHERE user_id=? AND revoked_at IS NULL",[reason,userId]);
 await conn.query("UPDATE protected_action_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL",[userId]);
 await conn.query("UPDATE staff_passwordless_challenges SET consumed_at=COALESCE(consumed_at,UTC_TIMESTAMP()),pending_ciphertext=NULL,pending_iv=NULL,pending_tag=NULL WHERE user_id=?",[userId]);
 await conn.query("UPDATE staff_passwordless_google_links SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL",[userId]);
 await conn.query("DELETE FROM staff_passwordless_backup_codes WHERE user_id=?",[userId]);
}
module.exports={rotationBinding,liveRotationRow,retireAuthenticatorAccess};
