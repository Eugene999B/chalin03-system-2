import assert from "node:assert/strict";

import {
  calculateSessionExpiry,
  decodeTokenPayload,
} from "../src/security/sessionExpiryGuard.js";

function fakeToken(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), "utf8")
      .toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

const morningIssuedAt = Date.parse("2026-07-23T06:00:00.000Z") / 1000;
const morning = calculateSessionExpiry(
  fakeToken({ iat: morningIssuedAt, exp: morningIssuedAt + 7 * 24 * 60 * 60 })
);
assert.equal(morning.expiresAtMs, Date.parse("2026-07-23T14:00:00.000Z"));
assert.equal(morning.reason, "eight_hour_limit");

const eveningIssuedAt = Date.parse("2026-07-23T20:30:00.000Z") / 1000;
const evening = calculateSessionExpiry(
  fakeToken({ iat: eveningIssuedAt, exp: eveningIssuedAt + 7 * 24 * 60 * 60 })
);
assert.equal(evening.expiresAtMs, Date.parse("2026-07-24T00:00:00.000Z"));
assert.equal(evening.reason, "ghana_midnight");

const shortToken = calculateSessionExpiry(
  fakeToken({ iat: morningIssuedAt, exp: morningIssuedAt + 30 * 60 })
);
assert.equal(shortToken.expiresAtMs, Date.parse("2026-07-23T06:30:00.000Z"));
assert.equal(shortToken.reason, "token_expiry");

const unicodePayload = decodeTokenPayload(
  fakeToken({ iat: morningIssuedAt, full_name: "Kwame Ɛbo" })
);
assert.equal(unicodePayload.full_name, "Kwame Ɛbo");

console.log("Session expiry release tests passed.");
