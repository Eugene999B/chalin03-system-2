"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FEATURE_DEFINITIONS,
  parseBoolean,
  getFeatureSnapshot,
  getPublicFeatureSnapshot,
  isFeatureEnabled,
  requireFeature,
} = require("../services/featureFlagService");

test("all CHALIN ONE features fail closed by default", () => {
  const snapshot = getFeatureSnapshot({ env: {} });
  assert.equal(Object.keys(snapshot).length, Object.keys(FEATURE_DEFINITIONS).length);
  assert.ok(Object.values(snapshot).every((enabled) => enabled === false));
});

test("boolean environment parsing is explicit and safe", () => {
  for (const value of [true, "1", "true", "TRUE", "yes", "on", "enabled"]) {
    assert.equal(parseBoolean(value, false), true);
  }

  for (const value of [false, "0", "false", "FALSE", "no", "off", "disabled"]) {
    assert.equal(parseBoolean(value, true), false);
  }

  assert.equal(parseBoolean("unexpected", false), false);
  assert.equal(parseBoolean("unexpected", true), true);
  assert.equal(parseBoolean(undefined, false), false);
});

test("AI child features remain disabled when the master AI switch is off", () => {
  const env = {
    FEATURE_AI_ENABLED: "false",
    FEATURE_CHALIN_COPILOT: "true",
    FEATURE_CHALIN_EXECUTIVE: "true",
    FEATURE_AI_ACTIONS: "true",
  };

  assert.equal(isFeatureEnabled("chalinCopilot", env), false);
  assert.equal(isFeatureEnabled("chalinExecutive", env), false);
  assert.equal(isFeatureEnabled("aiActions", env), false);
});

test("AI child features enable only when their dependencies are enabled", () => {
  const env = {
    FEATURE_AI_ENABLED: "true",
    FEATURE_PUBLIC_WEBSITE: "true",
    FEATURE_CHALIN_COPILOT: "true",
    FEATURE_CHALIN_GUIDE: "true",
  };

  assert.equal(isFeatureEnabled("chalinCopilot", env), true);
  assert.equal(isFeatureEnabled("chalinGuide", env), true);
});

test("public snapshot exposes only public-safe flags", () => {
  const env = {
    FEATURE_AI_ENABLED: "true",
    FEATURE_PUBLIC_WEBSITE: "true",
    FEATURE_CONTENT_STUDIO: "true",
    FEATURE_CHALIN_COPILOT: "true",
    FEATURE_CHALIN_GUIDE: "true",
    FEATURE_CUSTOMER_PORTAL: "true",
  };

  const snapshot = getPublicFeatureSnapshot(env);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "applicantPortal",
    "chalinGuide",
    "customerPortal",
    "publicWebsite",
    "supplierPortal",
  ]);
  assert.equal(snapshot.publicWebsite, true);
  assert.equal(snapshot.chalinGuide, true);
  assert.equal(snapshot.customerPortal, true);
  assert.equal("contentStudio" in snapshot, false);
  assert.equal("chalinCopilot" in snapshot, false);
  assert.equal("aiEnabled" in snapshot, false);
});

test("requireFeature blocks disabled routes with a controlled response", () => {
  const previous = process.env.FEATURE_CONTENT_STUDIO;
  delete process.env.FEATURE_CONTENT_STUDIO;

  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const middleware = requireFeature("contentStudio");

  middleware(
    { requestId: "request-123" },
    {
      status(value) {
        statusCode = value;
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    },
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 404);
  assert.equal(payload.code, "FEATURE_DISABLED");
  assert.equal(payload.feature, "contentStudio");
  assert.equal(payload.requestId, "request-123");

  if (previous === undefined) delete process.env.FEATURE_CONTENT_STUDIO;
  else process.env.FEATURE_CONTENT_STUDIO = previous;
});

test("requireFeature allows enabled routes to continue", () => {
  const previous = process.env.FEATURE_CONTENT_STUDIO;
  process.env.FEATURE_CONTENT_STUDIO = "true";

  let nextCalled = false;
  const middleware = requireFeature("contentStudio");
  middleware({}, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);

  if (previous === undefined) delete process.env.FEATURE_CONTENT_STUDIO;
  else process.env.FEATURE_CONTENT_STUDIO = previous;
});

test("unknown feature keys fail immediately", () => {
  assert.throws(
    () => requireFeature("notARealFeature"),
    (error) => error?.code === "UNKNOWN_FEATURE_FLAG"
  );
});
