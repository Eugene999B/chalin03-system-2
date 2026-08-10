"use strict";

const { cleanProviderKey } = require("./aiProviderService");

const MIN_PROVIDER_SECRET_LENGTH = 20;
const PLACEHOLDER_MARKERS = Object.freeze([
  "replace_with",
  "replace-me",
  "replace_me",
  "your_",
  "example",
  "placeholder",
]);

function clean(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function isConfiguredProviderSecret(value) {
  const secret = clean(value, 1000);
  const lowered = secret.toLowerCase();
  if (secret.length < MIN_PROVIDER_SECRET_LENGTH) return false;
  return !PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

function getAiProviderReadiness(env = process.env) {
  const key = cleanProviderKey(env.AI_PROVIDER || "disabled") || "disabled";
  const selected = key !== "disabled";
  let credentialConfigured = false;
  let reasonCode = "AI_PROVIDER_DISABLED";
  let ready = false;
  let credentialRequired = false;
  let externalNetwork = false;
  let billingRequired = false;

  if (key === "local") {
    ready = true;
    reasonCode = "AI_LOCAL_GOVERNED_PROVIDER_READY";
  } else if (key === "openai") {
    credentialRequired = true;
    externalNetwork = true;
    billingRequired = true;
    credentialConfigured = isConfiguredProviderSecret(env.OPENAI_API_KEY);
    ready = credentialConfigured;
    reasonCode = credentialConfigured
      ? "AI_PROVIDER_READY"
      : "AI_OPENAI_API_KEY_REQUIRED";
  } else if (key === "mock") {
    reasonCode = "AI_MOCK_PROVIDER_NOT_LIVE_READY";
  } else if (selected) {
    reasonCode = "AI_PROVIDER_READINESS_UNKNOWN";
  }

  return Object.freeze({
    key,
    selected,
    configured: ready,
    ready,
    credential_required: credentialRequired,
    secret_configured: credentialConfigured,
    external_network_required: externalNetwork,
    billing_required: billingRequired,
    provider_side_storage_enabled: false,
    secret_values_exposed: false,
    reason_code: reasonCode,
  });
}

module.exports = {
  MIN_PROVIDER_SECRET_LENGTH,
  PLACEHOLDER_MARKERS,
  getAiProviderReadiness,
  isConfiguredProviderSecret,
};
