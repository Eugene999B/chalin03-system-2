"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  booleanValue,
  validateStagingEnvironment,
} = require("./verifyChalinOneStagingEnvironment");

const DEFAULT_OUTPUT = path.resolve(
  __dirname,
  "../artifacts/chalin-one-staging-smoke.json"
);
const PRIVATE_KEYS = new Set([
  "api_key",
  "content_base64",
  "encryption_key",
  "ip_address",
  "ip_hash",
  "jwt",
  "password",
  "private_key",
  "secret",
  "storage_key",
  "token",
  "user_agent",
]);
const PUBLIC_FLAG_KEYS = new Set([
  "publicWebsite",
  "chalinGuide",
  "customerPortal",
  "supplierPortal",
  "applicantPortal",
]);
const SAFE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class ChalinOneStagingSmokeError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_SMOKE_FAILED", details = null) {
    super(message);
    this.name = "ChalinOneStagingSmokeError";
    this.code = code;
    this.details = details;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(value) {
  const raw = clean(value).replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new ChalinOneStagingSmokeError(
      "Staging smoke tests require HTTPS, except for localhost development.",
      "CHALIN_ONE_STAGING_SMOKE_HTTPS_REQUIRED"
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function apiRoot(value) {
  const base = normalizeBaseUrl(value);
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function scanPrivateKeys(value, trail = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanPrivateKeys(item, [...trail, String(index)], findings)
    );
    return findings;
  }
  if (!value || typeof value !== "object") return findings;

  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      PRIVATE_KEYS.has(normalized) ||
      normalized.endsWith("_password") ||
      normalized.endsWith("_secret") ||
      normalized.endsWith("_token")
    ) {
      findings.push([...trail, key].join("."));
    }
    scanPrivateKeys(item, [...trail, key], findings);
  }
  return findings;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: options.accept || "application/json",
        "User-Agent": "CHALIN-ONE-Staging-Smoke/1.0",
        ...(options.headers || {}),
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let body = null;
    if (contentType.includes("application/json") && text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new ChalinOneStagingSmokeError(
          `Invalid JSON returned by ${url}.`,
          "CHALIN_ONE_STAGING_SMOKE_INVALID_JSON"
        );
      }
    }
    return {
      url,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      cache_control: response.headers.get("cache-control") || "",
      location: response.headers.get("location") || "",
      body,
      text: body ? null : text.slice(0, 5000),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ChalinOneStagingSmokeError(
        `Timed out while requesting ${url}.`,
        "CHALIN_ONE_STAGING_SMOKE_TIMEOUT"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeRedirectTarget(currentUrl, result) {
  if (!SAFE_REDIRECT_STATUSES.has(Number(result?.status))) return null;
  const location = clean(result?.location);
  if (!location) {
    throw new ChalinOneStagingSmokeError(
      `Redirect response from ${currentUrl} did not include a Location header.`,
      "CHALIN_ONE_STAGING_SMOKE_REDIRECT_LOCATION_MISSING",
      result
    );
  }

  const current = new URL(currentUrl);
  const next = new URL(location, current);
  if (next.origin !== current.origin) {
    throw new ChalinOneStagingSmokeError(
      `Staging smoke refused a cross-origin redirect from ${current.origin} to ${next.origin}.`,
      "CHALIN_ONE_STAGING_SMOKE_CROSS_ORIGIN_REDIRECT",
      { from: current.toString(), to: next.toString(), status: result.status }
    );
  }
  if (next.protocol !== "https:" && next.hostname !== "localhost") {
    throw new ChalinOneStagingSmokeError(
      `Staging smoke refused an insecure redirect to ${next.toString()}.`,
      "CHALIN_ONE_STAGING_SMOKE_INSECURE_REDIRECT",
      { from: current.toString(), to: next.toString(), status: result.status }
    );
  }
  return next.toString();
}

async function requestWithSafeRedirects(url, options = {}) {
  const maximum = Number.isInteger(Number(options.maxRedirects))
    ? Math.max(0, Math.min(Number(options.maxRedirects), 5))
    : 3;
  const redirects = [];
  let currentUrl = url;

  for (let hop = 0; hop <= maximum; hop += 1) {
    const result = await request(currentUrl, options);
    const nextUrl = safeRedirectTarget(currentUrl, result);
    if (!nextUrl) {
      return {
        ...result,
        requested_url: url,
        redirects,
      };
    }
    if (hop === maximum) {
      throw new ChalinOneStagingSmokeError(
        `Staging smoke exceeded ${maximum} safe redirects for ${url}.`,
        "CHALIN_ONE_STAGING_SMOKE_TOO_MANY_REDIRECTS",
        redirects
      );
    }
    redirects.push({
      from: currentUrl,
      to: nextUrl,
      status: result.status,
    });
    currentUrl = nextUrl;
  }

  throw new ChalinOneStagingSmokeError(
    `Staging smoke could not resolve redirects for ${url}.`,
    "CHALIN_ONE_STAGING_SMOKE_REDIRECT_FAILED",
    redirects
  );
}

function assert(condition, message, code, details = null) {
  if (!condition) {
    throw new ChalinOneStagingSmokeError(message, code, details);
  }
}

function addCheck(checks, name, result, details = {}) {
  checks.push({ name, passed: true, ...details, status: result?.status || null });
}

function dataOf(result) {
  return result?.body?.data ?? result?.body ?? null;
}

async function runStagingSmokeTests({
  env = process.env,
  outputPath = DEFAULT_OUTPUT,
  writeFile = true,
} = {}) {
  const staging = validateStagingEnvironment(env, { mode: "runtime" });
  const api = apiRoot(env.CHALIN_ONE_STAGING_API_URL);
  const frontend = normalizeBaseUrl(env.FRONTEND_URL);
  const requirePublished = booleanValue(
    env.CHALIN_ONE_STAGING_REQUIRE_PUBLISHED
  );
  const checks = [];

  const health = await request(`${api}/health`);
  assert(
    health.ok && health.body?.status === "success",
    "Staging health endpoint is not healthy.",
    "CHALIN_ONE_STAGING_HEALTH_FAILED",
    health
  );
  addCheck(checks, "API health", health, {
    version: health.body?.version || null,
    deployment: health.body?.deployment || null,
  });

  const features = await request(`${api}/features/public`);
  const flags = features.body?.flags || {};
  assert(
    features.ok && features.body?.audience === "public",
    "Public feature endpoint did not return a public snapshot.",
    "CHALIN_ONE_STAGING_PUBLIC_FLAGS_FAILED",
    features
  );
  assert(
    flags.publicWebsite === true,
    "The staging publicWebsite flag is not effective.",
    "CHALIN_ONE_STAGING_PUBLIC_WEBSITE_DISABLED"
  );
  for (const key of Object.keys(flags)) {
    assert(
      PUBLIC_FLAG_KEYS.has(key),
      `The public feature response exposed staff-only flag ${key}.`,
      "CHALIN_ONE_STAGING_STAFF_FLAG_EXPOSED"
    );
  }
  for (const future of [
    "chalinGuide",
    "customerPortal",
    "supplierPortal",
    "applicantPortal",
  ]) {
    assert(
      flags[future] === false,
      `${future} must remain disabled during Release B staging.`,
      "CHALIN_ONE_STAGING_FUTURE_PUBLIC_FEATURE_ENABLED"
    );
  }
  assert(
    /no-store/i.test(features.cache_control),
    "Public feature flags must not be cached.",
    "CHALIN_ONE_STAGING_FEATURE_CACHE_UNSAFE"
  );
  addCheck(checks, "Public feature boundary", features, { flags });

  const staffFeatures = await request(`${api}/features/staff`);
  assert(
    !staffFeatures.ok && [401, 403].includes(staffFeatures.status),
    "Anonymous users can access the staff feature snapshot.",
    "CHALIN_ONE_STAGING_STAFF_FEATURE_AUTH_BYPASS",
    staffFeatures
  );
  addCheck(checks, "Staff feature authentication", staffFeatures);

  const contentStudio = await request(`${api}/content-studio`);
  assert(
    !contentStudio.ok && [401, 403].includes(contentStudio.status),
    "Anonymous users can access Content Studio.",
    "CHALIN_ONE_STAGING_CONTENT_STUDIO_AUTH_BYPASS",
    contentStudio
  );
  addCheck(checks, "Content Studio authentication", contentStudio);

  const bootstrap = await request(`${api}/public/content/bootstrap`);
  assert(
    bootstrap.ok && bootstrap.body?.status === "success",
    "Published public bootstrap could not be loaded.",
    "CHALIN_ONE_STAGING_PUBLIC_BOOTSTRAP_FAILED",
    bootstrap
  );
  assert(
    /public/i.test(bootstrap.cache_control),
    "Published bootstrap is missing its public cache boundary.",
    "CHALIN_ONE_STAGING_PUBLIC_CACHE_MISSING"
  );
  const privateFindings = scanPrivateKeys(bootstrap.body);
  assert(
    privateFindings.length === 0,
    "The public bootstrap exposed private field names.",
    "CHALIN_ONE_STAGING_PRIVATE_FIELD_EXPOSED",
    privateFindings
  );
  const bootstrapData = dataOf(bootstrap) || {};
  addCheck(checks, "Published bootstrap privacy", bootstrap, {
    settings_count: Object.keys(bootstrapData.settings || {}).length,
    navigation_count: Array.isArray(bootstrapData.navigation)
      ? bootstrapData.navigation.length
      : 0,
    private_findings: privateFindings,
  });

  const unpublishedProbe = await request(
    `${api}/public/content/pages/__chalin_one_unpublished_probe__`
  );
  assert(
    unpublishedProbe.status === 404 &&
      unpublishedProbe.body?.code === "PUBLIC_CONTENT_NOT_FOUND",
    "An unpublished page probe did not fail closed.",
    "CHALIN_ONE_STAGING_DRAFT_PAGE_PROBE_FAILED",
    unpublishedProbe
  );
  assert(
    /no-store|private/i.test(unpublishedProbe.cache_control),
    "Unpublished content responses must not be publicly cached.",
    "CHALIN_ONE_STAGING_DRAFT_CACHE_UNSAFE"
  );
  addCheck(checks, "Unpublished page privacy", unpublishedProbe);

  if (requirePublished) {
    const home = await request(`${api}/public/content/pages/home`);
    assert(
      home.ok && home.body?.status === "success",
      "The approved staging homepage is not published.",
      "CHALIN_ONE_STAGING_HOMEPAGE_NOT_PUBLISHED",
      home
    );
    assert(
      scanPrivateKeys(home.body).length === 0,
      "The published homepage exposed private fields.",
      "CHALIN_ONE_STAGING_HOMEPAGE_PRIVATE_FIELD_EXPOSED"
    );
    addCheck(checks, "Published homepage", home);

    const contact = await request(`${api}/public/content/forms/contact`);
    assert(
      contact.ok && contact.body?.status === "success",
      "The approved staging contact form is not published.",
      "CHALIN_ONE_STAGING_CONTACT_FORM_NOT_PUBLISHED",
      contact
    );
    addCheck(checks, "Published contact form", contact);

    assert(
      Array.isArray(bootstrapData.navigation) &&
        bootstrapData.navigation.length > 0,
      "No approved navigation is visible in the public bootstrap.",
      "CHALIN_ONE_STAGING_NAVIGATION_NOT_PUBLISHED"
    );
  }

  const website = await requestWithSafeRedirects(`${frontend}/website`, {
    accept: "text/html,application/xhtml+xml",
    maxRedirects: 3,
  });
  assert(
    website.ok && /text\/html/i.test(website.content_type),
    "The staging public website frontend is unavailable.",
    "CHALIN_ONE_STAGING_FRONTEND_FAILED",
    website
  );
  addCheck(checks, "Public website frontend", website, {
    content_type: website.content_type,
    final_url: website.url,
    redirect_count: website.redirects.length,
  });

  const report = Object.freeze({
    report: "CHALIN ONE Staging Smoke Test",
    generated_at: new Date().toISOString(),
    commit_sha:
      clean(env.RAILWAY_GIT_COMMIT_SHA) ||
      clean(env.GITHUB_SHA) ||
      clean(env.COMMIT_SHA) ||
      null,
    staging,
    require_published_content: requirePublished,
    passed: true,
    checks,
  });

  if (writeFile) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  return report;
}

function outputArgument(argv = process.argv.slice(2)) {
  const value = argv.find((item) => item.startsWith("--output="));
  return value ? path.resolve(value.slice("--output=".length)) : DEFAULT_OUTPUT;
}

if (require.main === module) {
  const outputPath = outputArgument();
  runStagingSmokeTests({ outputPath })
    .then((report) => {
      console.log(
        `CHALIN ONE staging smoke passed ${report.checks.length} checks.`
      );
      console.log(`Smoke report: ${outputPath}`);
    })
    .catch((error) => {
      console.error(`CHALIN ONE staging smoke failed: ${error.message}`);
      if (error.details) console.error(JSON.stringify(error.details, null, 2));
      process.exitCode = 1;
    });
}

module.exports = {
  ChalinOneStagingSmokeError,
  DEFAULT_OUTPUT,
  PRIVATE_KEYS,
  PUBLIC_FLAG_KEYS,
  SAFE_REDIRECT_STATUSES,
  apiRoot,
  dataOf,
  normalizeBaseUrl,
  outputArgument,
  request,
  requestWithSafeRedirects,
  runStagingSmokeTests,
  safeRedirectTarget,
  scanPrivateKeys,
};
