"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_ROOT = path.resolve(__dirname, "../artifacts");
const DEFAULT_RELEASE_EVIDENCE = path.join(
  ARTIFACT_ROOT,
  "chalin-one-release-evidence.json"
);
const DEFAULT_SMOKE_EVIDENCE = path.join(
  ARTIFACT_ROOT,
  "chalin-one-staging-smoke.json"
);
const DEFAULT_BROWSER_EVIDENCE = path.join(
  ARTIFACT_ROOT,
  "chalin-one-browser-acceptance.json"
);
const DEFAULT_OUTPUT = path.join(
  ARTIFACT_ROOT,
  "chalin-one-staging-acceptance.json"
);

const ACCEPTANCE_DATABASE_PATTERN = /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i;
const STAGING_DATABASE_PATTERN = /^chalin_one_staging(?:_[a-z0-9_]+)?$/i;
const STAGING_HOST_PATTERN = /(?:^|[.-])(staging|preview|test)(?:[.-]|$)/i;
const PRODUCTION_HOSTS = new Set([
  "chalin03.com",
  "www.chalin03.com",
  "staff.chalin03.com",
  "api.chalin03.com",
]);

const REQUIRED_SMOKE_CHECKS = Object.freeze([
  "API health",
  "Public feature boundary",
  "Staff feature authentication",
  "Content Studio authentication",
  "Published bootstrap privacy",
  "Unpublished page privacy",
  "Published homepage",
  "Published contact form",
  "Published contact form submission",
  "Public website frontend",
  "Public website deep link",
  "Content Studio deep link",
]);

const REQUIRED_BROWSER_GATES = Object.freeze([
  "public_desktop",
  "public_tablet",
  "public_mobile_360",
  "public_mobile_430",
  "keyboard_navigation",
  "public_form_and_enquiry_desk",
  "content_studio_author",
  "content_studio_reviewer",
  "content_studio_publisher",
  "permission_boundaries",
  "private_content_boundary",
  "deep_route_refreshes",
  "existing_staff_regression",
]);

class ChalinOneStagingAcceptanceError extends Error {
  constructor(
    message,
    code = "CHALIN_ONE_STAGING_ACCEPTANCE_FAILED",
    details = null
  ) {
    super(message);
    this.name = "ChalinOneStagingAcceptanceError";
    this.code = code;
    this.details = details;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function readJson(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} could not be read from ${filePath}.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_FILE_MISSING",
      { file: filePath, cause: error.message }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} is not valid JSON.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_INVALID_JSON",
      { file: filePath, cause: error.message }
    );
  }
}

function normalizeCommitSha(value, label = "Commit SHA") {
  const sha = clean(value).toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} must be a full 40- or 64-character hexadecimal commit SHA.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_COMMIT_INVALID",
      { label, value: clean(value) || null }
    );
  }
  return sha;
}

function evidenceHostSafe(value) {
  const hostname = clean(value).toLowerCase();
  return Boolean(
    hostname &&
      !PRODUCTION_HOSTS.has(hostname) &&
      (hostname === "localhost" || STAGING_HOST_PATTERN.test(hostname))
  );
}

function safeStagingUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(clean(value));
  } catch {
    throw new ChalinOneStagingAcceptanceError(
      `${label} must be a valid staging URL.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_URL_INVALID",
      { label, value: clean(value) || null }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname)) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} points to a production CHALIN 03 host.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_PRODUCTION_HOST_BLOCKED",
      { label, hostname }
    );
  }
  if (parsed.username || parsed.password) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} may not contain URL credentials.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_URL_CREDENTIALS_BLOCKED",
      { label, hostname }
    );
  }
  if (parsed.protocol !== "https:" && hostname !== "localhost") {
    throw new ChalinOneStagingAcceptanceError(
      `${label} must use HTTPS except for localhost.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_HTTPS_REQUIRED",
      { label, hostname, protocol: parsed.protocol }
    );
  }
  if (!evidenceHostSafe(hostname)) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} must visibly identify an isolated staging or preview host.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_HOST_NOT_ISOLATED",
      { label, hostname }
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function releaseEnvironmentEvidence(value) {
  const environment =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = clean(environment.mode).toLowerCase();
  const databaseName = clean(environment.database_name);
  const databaseSafe =
    (mode === "acceptance" && ACCEPTANCE_DATABASE_PATTERN.test(databaseName)) ||
    (mode === "staging" && STAGING_DATABASE_PATTERN.test(databaseName));

  return {
    passed: environment.safe === true && databaseSafe,
    safe: environment.safe === true,
    mode: mode || null,
    database_name: databaseName || null,
    database_name_safe: databaseSafe,
  };
}

function smokeEvidence(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const checksByName = new Map(
    checks.map((check) => [clean(check?.name), check])
  );
  const missing = REQUIRED_SMOKE_CHECKS.filter((name) => {
    const check = checksByName.get(name);
    return !check || check.passed !== true;
  });
  const submission = checksByName.get("Published contact form submission");
  const referenceCode = clean(submission?.reference_code);
  const databaseName = clean(report?.staging?.database_name);
  const databaseSafe = STAGING_DATABASE_PATTERN.test(databaseName);
  const frontendHost = clean(report?.staging?.frontend_host).toLowerCase();
  const apiHost = clean(report?.staging?.api_host).toLowerCase();
  const frontendHostSafe = evidenceHostSafe(frontendHost);
  const apiHostSafe = evidenceHostSafe(apiHost);
  const hostsSeparate =
    Boolean(frontendHost && apiHost) && frontendHost !== apiHost;

  return {
    passed:
      report?.passed === true &&
      report?.require_published_content === true &&
      report?.contact_form_submission_enabled === true &&
      report?.staging?.safe === true &&
      databaseSafe &&
      frontendHostSafe &&
      apiHostSafe &&
      hostsSeparate &&
      missing.length === 0 &&
      /^WEB-\d{8}-[A-F0-9]{12}$/.test(referenceCode),
    missing_checks: missing,
    reference_code: referenceCode || null,
    check_count: checks.length,
    require_published_content: report?.require_published_content === true,
    contact_form_submission_enabled:
      report?.contact_form_submission_enabled === true,
    staging_safe: report?.staging?.safe === true,
    database_name: databaseName || null,
    database_name_safe: databaseSafe,
    frontend_host: frontendHost || null,
    frontend_host_safe: frontendHostSafe,
    api_host: apiHost || null,
    api_host_safe: apiHostSafe,
    hosts_separate: hostsSeparate,
  };
}

function browserGatePassed(gate) {
  return (
    gate?.passed === true &&
    Array.isArray(gate?.evidence) &&
    gate.evidence.some((item) => clean(item))
  );
}

function browserEvidence(report) {
  const gates =
    report?.gates && typeof report.gates === "object" ? report.gates : {};
  const missing = REQUIRED_BROWSER_GATES.filter(
    (key) => !browserGatePassed(gates[key])
  );
  const screenshots = Array.isArray(report?.screenshots)
    ? report.screenshots.filter(
        (item) => clean(item?.name) && clean(item?.path)
      )
    : [];
  const reviewer = clean(report?.sign_off?.reviewer);
  const publisher = clean(report?.sign_off?.publisher);
  const acceptedAt = clean(report?.sign_off?.accepted_at);
  const acceptedDate = new Date(acceptedAt);
  const signOffValid =
    Boolean(reviewer) &&
    Boolean(publisher) &&
    reviewer.toLowerCase() !== publisher.toLowerCase() &&
    Boolean(acceptedAt) &&
    !Number.isNaN(acceptedDate.getTime());

  return {
    passed:
      report?.passed === true &&
      missing.length === 0 &&
      screenshots.length >= 4 &&
      signOffValid,
    missing_gates: missing,
    screenshot_count: screenshots.length,
    sign_off_valid: signOffValid,
    reviewer: reviewer || null,
    publisher: publisher || null,
    accepted_at: acceptedAt || null,
  };
}

function evaluateStagingAcceptance({ release, smoke, browser }) {
  const releaseSha = normalizeCommitSha(
    release?.commit_sha,
    "Release evidence commit SHA"
  );
  const smokeSha = normalizeCommitSha(
    smoke?.commit_sha,
    "Smoke evidence commit SHA"
  );
  const browserSha = normalizeCommitSha(
    browser?.commit_sha,
    "Browser evidence commit SHA"
  );
  const commitMatch = releaseSha === smokeSha && smokeSha === browserSha;
  const environmentGate = releaseEnvironmentEvidence(release?.environment);
  const namedReleaseGates =
    release?.gates &&
    typeof release.gates === "object" &&
    !Array.isArray(release.gates)
      ? release.gates
      : {};
  const releaseGateValues = Object.values(namedReleaseGates);
  const releaseGate = {
    passed:
      release?.release_ready === true &&
      environmentGate.passed &&
      releaseGateValues.length > 0 &&
      releaseGateValues.every((passed) => passed === true),
    environment: environmentGate,
    gate_count: Object.keys(namedReleaseGates).length,
  };
  const smokeGate = smokeEvidence(smoke);
  const browserGate = browserEvidence(browser);
  const databaseMatch =
    environmentGate.mode !== "staging" ||
    (Boolean(environmentGate.database_name) &&
      environmentGate.database_name === smokeGate.database_name);
  const frontendUrl = safeStagingUrl(
    browser?.frontend_url,
    "Browser frontend URL"
  );
  const apiUrl = safeStagingUrl(browser?.api_url, "Browser API URL");
  const frontendHostname = new URL(frontendUrl).hostname.toLowerCase();
  const apiHostname = new URL(apiUrl).hostname.toLowerCase();
  const browserHostsSeparate = frontendHostname !== apiHostname;
  const endpointMatch =
    smokeGate.frontend_host === frontendHostname &&
    smokeGate.api_host === apiHostname;
  const failures = [];

  if (!commitMatch) failures.push("commit_identity");
  if (!databaseMatch) failures.push("database_identity");
  if (!browserHostsSeparate) failures.push("browser_host_separation");
  if (!endpointMatch) failures.push("endpoint_identity");
  if (!releaseGate.passed) failures.push("automated_release_evidence");
  if (!smokeGate.passed) failures.push("final_staging_smoke");
  if (!browserGate.passed) failures.push("browser_acceptance");

  return Object.freeze({
    staging_ready: failures.length === 0,
    commit_sha: releaseSha,
    commit_match: commitMatch,
    database_match: databaseMatch,
    endpoint_match: endpointMatch,
    browser_hosts_separate: browserHostsSeparate,
    frontend_url: frontendUrl,
    api_url: apiUrl,
    failures,
    gates: {
      automated_release_evidence: releaseGate,
      final_staging_smoke: smokeGate,
      browser_acceptance: browserGate,
    },
  });
}

function generateStagingAcceptanceEvidence({
  releasePath = DEFAULT_RELEASE_EVIDENCE,
  smokePath = DEFAULT_SMOKE_EVIDENCE,
  browserPath = DEFAULT_BROWSER_EVIDENCE,
  outputPath = DEFAULT_OUTPUT,
  writeFile = true,
} = {}) {
  const release = readJson(releasePath, "Release evidence");
  const smoke = readJson(smokePath, "Staging smoke evidence");
  const browser = readJson(browserPath, "Browser acceptance evidence");
  const result = evaluateStagingAcceptance({ release, smoke, browser });
  const report = Object.freeze({
    report: "CHALIN ONE Staging Acceptance Evidence",
    generated_at: new Date().toISOString(),
    sources: {
      release_evidence: path.resolve(releasePath),
      staging_smoke: path.resolve(smokePath),
      browser_acceptance: path.resolve(browserPath),
    },
    ...result,
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

function argumentValue(argv, name, fallback) {
  const prefix = `--${name}=`;
  const match = argv.find((item) => item.startsWith(prefix));
  return match ? path.resolve(match.slice(prefix.length)) : fallback;
}

function commandOptions(argv = process.argv.slice(2)) {
  return {
    releasePath: argumentValue(
      argv,
      "release",
      DEFAULT_RELEASE_EVIDENCE
    ),
    smokePath: argumentValue(argv, "smoke", DEFAULT_SMOKE_EVIDENCE),
    browserPath: argumentValue(
      argv,
      "browser",
      DEFAULT_BROWSER_EVIDENCE
    ),
    outputPath: argumentValue(argv, "output", DEFAULT_OUTPUT),
  };
}

if (require.main === module) {
  try {
    const options = commandOptions();
    const report = generateStagingAcceptanceEvidence(options);
    console.log(
      report.staging_ready
        ? "CHALIN ONE staging evidence passed every release gate."
        : `CHALIN ONE staging evidence is incomplete or failed: ${report.failures.join(", ")}.`
    );
    console.log(`Staging evidence report: ${options.outputPath}`);
    if (!report.staging_ready) process.exitCode = 2;
  } catch (error) {
    console.error(`CHALIN ONE staging evidence failed: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  ACCEPTANCE_DATABASE_PATTERN,
  ChalinOneStagingAcceptanceError,
  DEFAULT_BROWSER_EVIDENCE,
  DEFAULT_OUTPUT,
  DEFAULT_RELEASE_EVIDENCE,
  DEFAULT_SMOKE_EVIDENCE,
  PRODUCTION_HOSTS,
  REQUIRED_BROWSER_GATES,
  REQUIRED_SMOKE_CHECKS,
  STAGING_DATABASE_PATTERN,
  STAGING_HOST_PATTERN,
  argumentValue,
  browserEvidence,
  commandOptions,
  evaluateStagingAcceptance,
  evidenceHostSafe,
  generateStagingAcceptanceEvidence,
  normalizeCommitSha,
  readJson,
  releaseEnvironmentEvidence,
  safeStagingUrl,
  smokeEvidence,
};
