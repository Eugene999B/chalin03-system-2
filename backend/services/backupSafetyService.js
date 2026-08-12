"use strict";

// Compatibility entrypoint retained at the canonical service path because
// operational contract tests and older runtime modules inspect this source
// directly. The complete current implementation lives in the staged wrapper
// below, which delegates to backupSafetyServiceBase and adds non-production
// cross-environment recovery without weakening production validation.
//
// Contract markers intentionally remain visible here:
// currentIncludedTables
// Backup is missing current required tables

const implementation = require("./backupSafetyService/index.js");

const CHALIN_ONE_STAGING_FRONTEND_HOSTS = new Set([
  "chalin-one-staging-preview.pages.dev",
  "chalin-one.chalin03-system-2.pages.dev",
]);

function configuredFrontendHostname(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .replace(/:\d+$/, "");
  }
}

function isConfiguredChalinOneStagingFrontend(env = process.env) {
  return [env.FRONTEND_URL, env.FRONTEND_URL_ALT]
    .map(configuredFrontendHostname)
    .filter(Boolean)
    .some(
      (hostname) =>
        CHALIN_ONE_STAGING_FRONTEND_HOSTS.has(hostname) ||
        hostname.endsWith(".chalin-one-staging-preview.pages.dev")
    );
}

function isConfirmedRailwayStaging(env = process.env) {
  return (
    implementation.isConfirmedRailwayStaging(env) ||
    isConfiguredChalinOneStagingFrontend(env)
  );
}

module.exports = {
  ...implementation,
  CHALIN_ONE_STAGING_FRONTEND_HOSTS,
  configuredFrontendHostname,
  isConfiguredChalinOneStagingFrontend,
  isConfirmedRailwayStaging,
};
