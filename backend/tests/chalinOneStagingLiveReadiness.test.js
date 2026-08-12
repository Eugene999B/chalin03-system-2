"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_STAGING_ORIGIN,
  assertDedicatedStagingOrigin,
  assertExpectedCommitSha,
  assertHealth,
  assertPublicFeatures,
  assertReadiness,
} = require("../scripts/checkChalinOneStagingLiveReadiness");

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("live readiness is hard-locked to the dedicated staging origin", () => {
  assert.equal(assertDedicatedStagingOrigin(DEFAULT_STAGING_ORIGIN), DEFAULT_STAGING_ORIGIN);
  assert.throws(
    () => assertDedicatedStagingOrigin("https://api.chalin03.com"),
    /Refusing live-readiness check outside dedicated CHALIN ONE staging/
  );
});

test("live readiness requires a full exact commit SHA", () => {
  assert.equal(assertExpectedCommitSha(SHA), SHA);
  assert.throws(() => assertExpectedCommitSha("0123456"), /40-character Git commit SHA/);
});

test("health and readiness must match the exact deployed commit", () => {
  assert.equal(
    assertHealth({ status: "success", deployment: { commit_sha: SHA } }, SHA),
    true
  );
  assert.equal(
    assertReadiness(
      {
        status: "success",
        ready: true,
        deployment: { commit_sha: SHA },
        checks: {
          database: "ready",
          schema: "ready",
          configuration: "ready",
        },
      },
      SHA
    ),
    true
  );
  assert.throws(
    () =>
      assertHealth(
        { status: "success", deployment: { commit_sha: "f".repeat(40) } },
        SHA
      ),
    /not on the expected commit yet/
  );
});

test("public feature route must remain available without private data", () => {
  assert.equal(
    assertPublicFeatures({ status: "success", audience: "public", flags: {} }),
    true
  );
  assert.throws(
    () => assertPublicFeatures({ status: "success", audience: "staff", flags: {} }),
    /public feature snapshot/
  );
});
