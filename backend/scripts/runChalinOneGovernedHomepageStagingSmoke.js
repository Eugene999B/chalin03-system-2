"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  ChalinOneStagingSmokeError,
  DEFAULT_OUTPUT,
  apiRoot,
  dataOf,
  outputArgument,
  request,
  runStagingSmokeTests,
  scanPrivateKeys,
} = require("./runChalinOneStagingSmokeTests");

function fail(message, code, details = null) {
  throw new ChalinOneStagingSmokeError(message, code, details);
}

function writeReport(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function runGovernedHomepageStagingSmoke({
  env = process.env,
  outputPath = DEFAULT_OUTPUT,
  writeFile = true,
} = {}) {
  const baseReport = await runStagingSmokeTests({
    env,
    outputPath,
    writeFile: false,
  });

  if (!baseReport.require_published_content) {
    if (writeFile) writeReport(outputPath, baseReport);
    return baseReport;
  }

  const api = apiRoot(env.CHALIN_ONE_STAGING_API_URL);
  const homepage = await request(`${api}/public/content/homepage`);
  if (!homepage.ok || homepage.body?.status !== "success") {
    fail(
      "The governed staging homepage discovery endpoint is unavailable.",
      "CHALIN_ONE_STAGING_GOVERNED_HOMEPAGE_FAILED",
      homepage
    );
  }

  const homepageData = dataOf(homepage) || {};
  if (!homepageData.slug || !homepageData.title) {
    fail(
      "The governed staging homepage does not contain a public slug and title.",
      "CHALIN_ONE_STAGING_GOVERNED_HOMEPAGE_INCOMPLETE",
      homepageData
    );
  }

  const privateFindings = scanPrivateKeys(homepage.body);
  if (privateFindings.length > 0) {
    fail(
      "The governed staging homepage exposed private field names.",
      "CHALIN_ONE_STAGING_GOVERNED_HOMEPAGE_PRIVATE_FIELD_EXPOSED",
      privateFindings
    );
  }

  const resolvedPage = await request(
    `${api}/public/content/pages/${encodeURIComponent(homepageData.slug)}`
  );
  const resolvedData = dataOf(resolvedPage) || {};
  if (
    !resolvedPage.ok ||
    resolvedPage.body?.status !== "success" ||
    resolvedData.slug !== homepageData.slug ||
    resolvedData.title !== homepageData.title ||
    JSON.stringify(resolvedData.sections || []) !==
      JSON.stringify(homepageData.sections || [])
  ) {
    fail(
      "The governed homepage does not resolve to the same safe published page payload.",
      "CHALIN_ONE_STAGING_GOVERNED_HOMEPAGE_MISMATCH",
      { homepage, resolvedPage }
    );
  }

  if (!/public/i.test(homepage.cache_control)) {
    fail(
      "The governed homepage is missing its public cache boundary.",
      "CHALIN_ONE_STAGING_GOVERNED_HOMEPAGE_CACHE_MISSING",
      homepage
    );
  }

  const checks = baseReport.checks.map((check) =>
    check.name === "Published homepage"
      ? {
          name: "Published homepage",
          passed: true,
          status: homepage.status,
          slug: homepageData.slug,
          title: homepageData.title,
          section_count: Array.isArray(homepageData.sections)
            ? homepageData.sections.length
            : 0,
          discovery_endpoint: "/api/public/content/homepage",
          resolved_page_matches: true,
          private_findings: privateFindings,
        }
      : check
  );

  const report = Object.freeze({
    ...baseReport,
    governed_homepage_discovery: true,
    checks,
  });

  if (writeFile) writeReport(outputPath, report);
  return report;
}

if (require.main === module) {
  const outputPath = outputArgument();
  runGovernedHomepageStagingSmoke({ outputPath })
    .then((report) => {
      console.log(
        `CHALIN ONE staging smoke passed ${report.checks.length} checks, including governed homepage discovery.`
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
  runGovernedHomepageStagingSmoke,
  writeReport,
};
