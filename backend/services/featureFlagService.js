"use strict";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const FEATURE_DEFINITIONS = Object.freeze({
  aiEnabled: Object.freeze({
    envKey: "FEATURE_AI_ENABLED",
    defaultValue: false,
    audience: "staff",
    description: "Master emergency switch for every CHALIN ONE AI capability.",
  }),
  publicWebsite: Object.freeze({
    envKey: "FEATURE_PUBLIC_WEBSITE",
    defaultValue: false,
    audience: "public",
    description: "Public Chalin 03 corporate website APIs and interface.",
  }),
  contentStudio: Object.freeze({
    envKey: "FEATURE_CONTENT_STUDIO",
    defaultValue: false,
    audience: "staff",
    description: "Protected website content management and publishing tools.",
  }),
  chalinCopilot: Object.freeze({
    envKey: "FEATURE_CHALIN_COPILOT",
    defaultValue: false,
    audience: "staff",
    requires: ["aiEnabled"],
    description: "Permission-scoped staff intelligence assistant.",
  }),
  chalinExecutive: Object.freeze({
    envKey: "FEATURE_CHALIN_EXECUTIVE",
    defaultValue: false,
    audience: "staff",
    requires: ["aiEnabled"],
    description: "Private executive intelligence command centre.",
  }),
  chalinGuide: Object.freeze({
    envKey: "FEATURE_CHALIN_GUIDE",
    defaultValue: false,
    audience: "public",
    requires: ["aiEnabled", "publicWebsite"],
    description: "Public company and enquiry assistant.",
  }),
  customerPortal: Object.freeze({
    envKey: "FEATURE_CUSTOMER_PORTAL",
    defaultValue: false,
    audience: "public",
    description: "External customer self-service portal.",
  }),
  supplierPortal: Object.freeze({
    envKey: "FEATURE_SUPPLIER_PORTAL",
    defaultValue: false,
    audience: "public",
    description: "External supplier portal.",
  }),
  applicantPortal: Object.freeze({
    envKey: "FEATURE_APPLICANT_PORTAL",
    defaultValue: false,
    audience: "public",
    description: "External job applicant portal.",
  }),
  aiActions: Object.freeze({
    envKey: "FEATURE_AI_ACTIONS",
    defaultValue: false,
    audience: "staff",
    requires: ["aiEnabled"],
    description: "Approval-controlled AI write actions.",
  }),
  aiScheduledJobs: Object.freeze({
    envKey: "FEATURE_AI_SCHEDULED_JOBS",
    defaultValue: false,
    audience: "staff",
    requires: ["aiEnabled"],
    description: "Scheduled AI briefs, monitoring and approved automations.",
  }),
});

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

function getFeatureDefinition(featureKey) {
  const definition = FEATURE_DEFINITIONS[featureKey];
  if (!definition) {
    const error = new Error(`Unknown CHALIN ONE feature flag: ${featureKey}`);
    error.code = "UNKNOWN_FEATURE_FLAG";
    throw error;
  }
  return definition;
}

function getConfiguredValue(featureKey, env = process.env) {
  const definition = getFeatureDefinition(featureKey);
  return parseBoolean(env[definition.envKey], definition.defaultValue);
}

function isFeatureEnabled(featureKey, env = process.env, trail = new Set()) {
  const definition = getFeatureDefinition(featureKey);

  if (trail.has(featureKey)) {
    const error = new Error(`Circular CHALIN ONE feature dependency: ${featureKey}`);
    error.code = "FEATURE_DEPENDENCY_CYCLE";
    throw error;
  }

  if (!getConfiguredValue(featureKey, env)) return false;
  if (!definition.requires?.length) return true;

  const nextTrail = new Set(trail);
  nextTrail.add(featureKey);
  return definition.requires.every((dependency) =>
    isFeatureEnabled(dependency, env, nextTrail)
  );
}

function getFeatureState(featureKey, env = process.env) {
  const definition = getFeatureDefinition(featureKey);
  return Object.freeze({
    key: featureKey,
    envKey: definition.envKey,
    audience: definition.audience,
    description: definition.description,
    configured: getConfiguredValue(featureKey, env),
    enabled: isFeatureEnabled(featureKey, env),
    requires: [...(definition.requires || [])],
  });
}

function getFeatureSnapshot({ audience = "staff", env = process.env } = {}) {
  const snapshot = {};

  for (const featureKey of Object.keys(FEATURE_DEFINITIONS)) {
    const state = getFeatureState(featureKey, env);
    if (audience === "public" && state.audience !== "public") continue;
    snapshot[featureKey] = state.enabled;
  }

  return Object.freeze(snapshot);
}

function getPublicFeatureSnapshot(env = process.env) {
  return getFeatureSnapshot({ audience: "public", env });
}

function requireFeature(featureKey, options = {}) {
  // Validate at route registration time instead of discovering a typo in production.
  getFeatureDefinition(featureKey);

  const statusCode = Number(options.statusCode) || 404;
  const message =
    options.message || "This CHALIN ONE feature is not currently available.";

  return function featureFlagMiddleware(req, res, next) {
    if (isFeatureEnabled(featureKey)) return next();

    return res.status(statusCode).json({
      status: "error",
      code: "FEATURE_DISABLED",
      feature: featureKey,
      message,
      requestId: req?.requestId || null,
    });
  };
}

module.exports = {
  FEATURE_DEFINITIONS,
  parseBoolean,
  getFeatureDefinition,
  getFeatureState,
  getFeatureSnapshot,
  getPublicFeatureSnapshot,
  isFeatureEnabled,
  requireFeature,
};
