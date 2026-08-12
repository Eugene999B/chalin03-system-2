"use strict";

const DEFAULT_STAGING_ORIGIN =
  "https://chalin03-system-2-staging.up.railway.app";
const ALLOWED_STAGING_HOST = "chalin03-system-2-staging.up.railway.app";

class ChalinOneStagingLiveReadinessError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_LIVE_READINESS_FAILED") {
    super(message);
    this.name = "ChalinOneStagingLiveReadinessError";
    this.code = code;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function assertDedicatedStagingOrigin(value) {
  const origin = clean(value || DEFAULT_STAGING_ORIGIN).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ChalinOneStagingLiveReadinessError(
      "Staging live-readiness origin is not a valid URL.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_ORIGIN_INVALID"
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ALLOWED_STAGING_HOST ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ChalinOneStagingLiveReadinessError(
      `Refusing live-readiness check outside dedicated CHALIN ONE staging: ${origin}`,
      "CHALIN_ONE_STAGING_LIVE_READINESS_ORIGIN_REFUSED"
    );
  }

  return origin;
}

function assertExpectedCommitSha(value) {
  const sha = clean(value);
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new ChalinOneStagingLiveReadinessError(
      "EXPECTED_COMMIT_SHA must be a full 40-character Git commit SHA.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_SHA_INVALID"
    );
  }
  return sha.toLowerCase();
}

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "chalin-one-staging-live-readiness",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ChalinOneStagingLiveReadinessError(
      `Request failed for ${url}: ${error.message}`,
      "CHALIN_ONE_STAGING_LIVE_READINESS_REQUEST_FAILED"
    );
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ChalinOneStagingLiveReadinessError(
      `Expected JSON from ${url}, received HTTP ${response.status}.`,
      "CHALIN_ONE_STAGING_LIVE_READINESS_JSON_INVALID"
    );
  }

  if (!response.ok) {
    const error = new ChalinOneStagingLiveReadinessError(
      `HTTP ${response.status} from ${url}: ${payload?.message || payload?.status || "request failed"}`,
      "CHALIN_ONE_STAGING_LIVE_READINESS_HTTP_FAILED"
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function deploymentCommit(payload) {
  return clean(payload?.deployment?.commit_sha).toLowerCase();
}

function assertHealth(payload, expectedSha) {
  if (payload?.status !== "success") {
    throw new ChalinOneStagingLiveReadinessError(
      "Staging /api/health did not report success.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_HEALTH_FAILED"
    );
  }
  if (deploymentCommit(payload) !== expectedSha) {
    throw new ChalinOneStagingLiveReadinessError(
      `Staging health is not on the expected commit yet (expected ${expectedSha}, got ${deploymentCommit(payload) || "unknown"}).`,
      "CHALIN_ONE_STAGING_LIVE_READINESS_COMMIT_PENDING"
    );
  }
  return true;
}

function assertReadiness(payload, expectedSha) {
  const checks = payload?.checks || {};
  if (
    payload?.status !== "success" ||
    payload?.ready !== true ||
    checks.database !== "ready" ||
    checks.schema !== "ready" ||
    checks.configuration !== "ready"
  ) {
    throw new ChalinOneStagingLiveReadinessError(
      "Staging /api/readiness is not fully ready for database, schema and configuration.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_READINESS_FAILED"
    );
  }
  if (deploymentCommit(payload) !== expectedSha) {
    throw new ChalinOneStagingLiveReadinessError(
      "Staging readiness response does not match the expected deployed commit.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_READINESS_COMMIT_MISMATCH"
    );
  }
  return true;
}

function assertPublicFeatures(payload) {
  if (
    payload?.status !== "success" ||
    payload?.audience !== "public" ||
    !payload?.flags ||
    typeof payload.flags !== "object"
  ) {
    throw new ChalinOneStagingLiveReadinessError(
      "Staging public feature route did not return a valid public feature snapshot.",
      "CHALIN_ONE_STAGING_LIVE_READINESS_FEATURE_ROUTE_FAILED"
    );
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExactDeployment({
  origin,
  expectedSha,
  attempts = 60,
  delayMs = 10000,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await fetchJson(`${origin}/api/health`);
      assertHealth(health, expectedSha);
      console.log(
        `CHALIN ONE staging exact commit is live: ${expectedSha.slice(0, 12)} (attempt ${attempt}/${attempts}).`
      );
      return health;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.log(
        `Waiting for exact CHALIN ONE staging deployment (${attempt}/${attempts}): ${error.message}`
      );
      await sleep(delayMs);
    }
  }

  throw new ChalinOneStagingLiveReadinessError(
    `Exact CHALIN ONE staging deployment did not become healthy in time: ${lastError?.message || "unknown failure"}`,
    "CHALIN_ONE_STAGING_LIVE_READINESS_TIMEOUT"
  );
}

async function checkChalinOneStagingLiveReadiness({
  origin = process.env.STAGING_API_ORIGIN || DEFAULT_STAGING_ORIGIN,
  expectedSha = process.env.EXPECTED_COMMIT_SHA || process.env.GITHUB_SHA,
  attempts = Number(process.env.STAGING_READINESS_ATTEMPTS || 60),
  delayMs = Number(process.env.STAGING_READINESS_DELAY_MS || 10000),
} = {}) {
  const safeOrigin = assertDedicatedStagingOrigin(origin);
  const safeSha = assertExpectedCommitSha(expectedSha);

  await waitForExactDeployment({
    origin: safeOrigin,
    expectedSha: safeSha,
    attempts,
    delayMs,
  });

  const [readiness, publicFeatures] = await Promise.all([
    fetchJson(`${safeOrigin}/api/readiness`),
    fetchJson(`${safeOrigin}/api/features/public`),
  ]);
  assertReadiness(readiness, safeSha);
  assertPublicFeatures(publicFeatures);

  const result = Object.freeze({
    status: "success",
    staging_origin: safeOrigin,
    commit_sha: safeSha,
    readiness: Object.freeze({
      database: readiness.checks.database,
      schema: readiness.checks.schema,
      configuration: readiness.checks.configuration,
    }),
    public_features_route: "ready",
    production_checked: false,
  });

  console.log("CHALIN ONE staging live readiness verified for the exact deployed commit.");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  checkChalinOneStagingLiveReadiness().catch((error) => {
    console.error(`CHALIN ONE staging live-readiness failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_STAGING_HOST,
  DEFAULT_STAGING_ORIGIN,
  ChalinOneStagingLiveReadinessError,
  assertDedicatedStagingOrigin,
  assertExpectedCommitSha,
  assertHealth,
  assertPublicFeatures,
  assertReadiness,
  checkChalinOneStagingLiveReadiness,
  deploymentCommit,
  fetchJson,
  waitForExactDeployment,
};
