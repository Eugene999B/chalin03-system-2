const test = require("node:test");
const assert = require("node:assert/strict");

const {
  expiryResponse,
  getEffectiveSessionExpiry,
  getSessionPolicy,
  nextGhanaMidnightAfter,
} = require("../services/sessionExpiryPolicy");

test("sessions opened early in the day expire after eight hours", () => {
  const policy = getSessionPolicy(new Date("2026-07-23T06:00:00.000Z"));

  assert.equal(policy.expiresAt.toISOString(), "2026-07-23T14:00:00.000Z");
  assert.equal(policy.reason, "eight_hour_limit");
  assert.equal(expiryResponse(policy).code, "SESSION_EXPIRED_EIGHT_HOURS");
});

test("sessions cannot cross Ghana midnight", () => {
  const policy = getSessionPolicy(new Date("2026-07-23T20:30:00.000Z"));

  assert.equal(policy.expiresAt.toISOString(), "2026-07-24T00:00:00.000Z");
  assert.equal(policy.reason, "ghana_midnight");
  assert.equal(
    expiryResponse(policy).code,
    "SESSION_EXPIRED_GHANA_MIDNIGHT"
  );
});

test("the exact 4 p.m. boundary ends at Ghana midnight", () => {
  const policy = getSessionPolicy(new Date("2026-07-23T16:00:00.000Z"));

  assert.equal(policy.expiresAt.toISOString(), "2026-07-24T00:00:00.000Z");
  assert.equal(policy.reason, "ghana_midnight");
});

test("legacy seven-day sessions are reduced by the current policy", () => {
  const effective = getEffectiveSessionExpiry({
    createdAt: "2026-07-22T22:00:00.000Z",
    storedExpiresAt: "2026-07-29T22:00:00.000Z",
  });

  assert.equal(effective.expiresAt.toISOString(), "2026-07-23T00:00:00.000Z");
  assert.equal(effective.reason, "ghana_midnight");
});

test("Ghana midnight is calculated independently of the server timezone", () => {
  assert.equal(
    nextGhanaMidnightAfter("2026-12-31T23:59:59.000Z").toISOString(),
    "2027-01-01T00:00:00.000Z"
  );
});
