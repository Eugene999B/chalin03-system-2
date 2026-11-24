"use strict";

// Step-up verification for an already authenticated staff member. The login
// credential's replay counter and rolling failure budget are shared with login.
// No permission, user identity, enrollment or recovery state is changed.
const { pool } = require("../config/db");
const crypto = require("./staffPasswordlessCrypto");
const WINDOW_MINUTES = 15;
const MAX_FAILURES = 10;
function failure(status, code, message) { return { ok: false, status, code, message }; }
async function verifyStaffProtectedAction({ userId, code, db = pool, now = Date.now(), env = process.env }) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0)
    return failure(403, "AUTHENTICATION_REQUIRED", "Sign in again before confirming this action.");
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim()))
    return failure(400, "AUTHENTICATOR_CODE_REQUIRED", "Enter the six-digit code from your Authenticator.");
  if (!crypto.assertConfigured(env))
    return failure(503, "AUTHENTICATOR_UNAVAILABLE", "Authenticator confirmation is not configured.");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT i.secret_ciphertext, i.secret_iv, i.secret_tag, i.last_totp_counter FROM staff_passwordless_identities i INNER JOIN users u ON u.id=i.user_id WHERE i.user_id=? AND u.is_active=TRUE AND COALESCE(u.is_login_locked,FALSE)=FALSE FOR UPDATE",
      [userId]
    );
    const identity = rows[0];
    if (!identity) {
      await conn.rollback();
      return failure(403, "AUTHENTICATOR_ENROLLMENT_REQUIRED", "An active enrolled Authenticator is required. Contact your administrator.");
    }
    const [attempts] = await conn.query(
      "SELECT COALESCE(SUM(attempts),0) AS n FROM staff_passwordless_challenges WHERE user_id=? AND purpose='totp_login' AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)",
      [userId, WINDOW_MINUTES]
    );
    if (Number(attempts[0]?.n || 0) >= MAX_FAILURES) {
      await conn.rollback();
      return failure(429, "RATE_LIMITED", "Too many recent verification attempts. Try again after 15 minutes.");
    }
    const secret = crypto.decryptSecret({ ciphertext: identity.secret_ciphertext, iv: identity.secret_iv, tag: identity.secret_tag }, env);
    const counter = crypto.matchedCounter(secret, code.trim(), now);
    if (counter === null || counter <= Number(identity.last_totp_counter)) {
      // Persist only a consumed, non-redeemable failure marker; no code is stored.
      await conn.query(
        "INSERT INTO staff_passwordless_challenges (token_digest,user_id,purpose,attempts,expires_at,consumed_at) VALUES (?,?,'totp_login',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())",
        [crypto.digestChallenge(crypto.newChallenge(), env), userId]
      );
      await conn.commit();
      return failure(422, "SECURITY_CODE_INCORRECT", "Incorrect, expired or previously used code. Wait for a fresh Authenticator code and retry.");
    }
    await conn.query("UPDATE staff_passwordless_identities SET last_totp_counter=? WHERE user_id=?", [counter, userId]);
    await conn.commit();
    return { ok: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
module.exports = { verifyStaffProtectedAction };
