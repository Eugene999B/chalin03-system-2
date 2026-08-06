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
  if (!/^[a-f0-9]{7,64}$/.test(sha)) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} is missing or invalid.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_COMMIT_INVALID",
      { label, value: clean(value) || null }
    );
  }
  return sha;
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
  if (
    hostname !== "localhost" &&
    !/(?:^|[.-])(staging|preview|test)(?:[.-]|$)/i.test(hostname)
  ) {
    throw new ChalinOneStagingAcceptanceError(
      `${label} must visibly identify an isolated staging or preview host.`,
      "CHALIN_ONE_STAGING_ACCEPTANCE_HOST_NOT_ISOLATED",
      { label, hostname }
    );
  }

  return parsed.toString().replace(/\/$/, "");
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

  return {
    passed:
      report?.passed === true &&
      report?.require_published_content === true &&
      report?.contact_form_submission_enabled === true &&
      report?.staging?.safe === true &&
      missing.length === 0 &&
      /^WEB-\d{8}-[A-F0-9]{12}$/.test(referenceCode),
    missing_checks: missing,
    reference_code: referenceCode || null,
    check_count: checks.length,
    require_published_content: report?.require_published_content === true,
    contact_form_submission_enabled:
      report?.contact_form_submission_enabled === true,
    staging_safe: report?.staging?.safe === true,
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
  const releaseEnvironment = clean(release?.environment).toLowerCase();
  const releaseGate = {
    passed:
      release?.release_ready === true &&
      releaseEnvironment !== "production" &&
      Array.isArray(release?.gates) &&
      release.gates.every((gate) => gate?.passed === true),
    environment: releaseEnvironment || null,
    gate_count: Array.isArray(release?.gates) ? release.gates.length : 0,
  };
  const smokeGate = smokeEvidence(smoke);
  const browserGate = browserEvidence(browser);
  const frontendUrl = safeStagingUrl(
    browser?.frontend_url,
    "Browser frontend URL"
  );
  const apiUrl = safeStagingUrl(browser?.api_url, "Browser API URL");
  const failures = [];

  if (!commitMatch) failures.push("commit_identity");
  if (!releaseGate.passed) failures.push("automated_release_evidence");
  if (!smokeGate.passed) failures.push("final_staging_smoke");
  if (!browserGate.passed) failures.push("browser_acceptance");

  return Object.freeze({
    staging_ready: failures.length === 0,
    commit_sha: releaseSha,
    commit_match: commitMatch,
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
  ChalinOneStagingAcceptanceError,
  DEFAULT_BROWSER_EVIDENCE,
  DEFAULT_OUTPUT,
  DEFAULT_RELEASE_EVIDENCE,
  DEFAULT_SMOKE_EVIDENCE,
  PRODUCTION_HOSTS,
  REQUIRED_BROWSER_GATES,
  REQUIRED_SMOKE_CHECKS,
  argumentValue,
  browserEvidence,
  commandOptions,
  evaluateStagingAcceptance,
  generateStagingAcceptanceEvidence,
  normalizeCommitSha,
  readJson,
  safeStagingUrl,
  smokeEvidence,
};
