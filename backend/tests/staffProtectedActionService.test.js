"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { verifyStaffProtectedAction } = require("../services/staffProtectedActionService");
const crypto = require("../services/staffPasswordlessCrypto");
const { totpAt } = require("../services/ownerMfaService");
const env = { STAFF_PASSWORDLESS_PILOT: "true", STAFF_PASSWORDLESS_HMAC_KEY: "A".repeat(48), STAFF_PASSWORDLESS_ENCRYPTION_KEY: "B".repeat(48) };
const now = 1795504800000;
function fixture({ enrolled = true, attempts = 0 } = {}) {
  const secret = crypto.newAuthenticator("test").secret;
  const box = crypto.encryptSecret(secret, env);
  const state = { counter: -1, attempts, committed: 0 };
  const identity = { secret_ciphertext: box.ciphertext, secret_iv: box.iv, secret_tag: box.tag };
  const conn = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() { state.committed++; },
    async query(sql, params) {
      if (sql.includes("FROM staff_passwordless_identities i")) return [enrolled ? [{ ...identity, last_totp_counter: state.counter }] : []];
      if (sql.includes("SUM(attempts)")) return [[{ n: state.attempts }]];
      if (sql.startsWith("INSERT INTO staff_passwordless_challenges")) { state.attempts++; return [{}]; }
      if (sql.startsWith("UPDATE staff_passwordless_identities")) { state.counter = params[0]; return [{}]; }
      throw new Error("Unexpected SQL");
    }
  };
  return { state, input: { userId: 42, code: totpAt(secret, { timestamp: now }), db: { getConnection: async () => conn }, now, env } };
}
test("fresh enrolled authenticator code is accepted once; replay is rejected", async () => {
  const { state, input } = fixture();
  assert.deepEqual(await verifyStaffProtectedAction(input), { ok: true });
  assert.equal(state.counter, Math.floor(now / 30000));
  assert.equal((await verifyStaffProtectedAction(input)).status, 422);
  assert.equal(state.attempts, 1);
});
test("unenrolled users and password-only submissions cannot unlock", async () => {
  const { input } = fixture({ enrolled: false });
  assert.equal((await verifyStaffProtectedAction(input)).code, "AUTHENTICATOR_ENROLLMENT_REQUIRED");
  assert.equal((await verifyStaffProtectedAction({ ...input, code: undefined })).status, 400);
});
test("persistent failure budget prevents even valid code until limit expires", async () => {
  const { input, state } = fixture({ attempts: 10 });
  assert.equal((await verifyStaffProtectedAction(input)).status, 429);
  assert.equal(state.counter, -1);
});
