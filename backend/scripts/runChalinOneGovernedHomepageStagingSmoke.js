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

const EXPECTED_NAVIGATION_HIERARCHY = Object.freeze([
  Object.freeze({
    key: "header_division_spare_parts",
    parent_key: "header_divisions",
    location: "header",
  }),
  Object.freeze({
    key: "header_division_mining",
    parent_key: "header_divisions",
    location: "header",
  }),
  Object.freeze({
    key: "header_division_hire",
    parent_key: "header_divisions",
    location: "header",
  }),
  Object.freeze({
    key: "header_division_sales",
    parent_key: "header_divisions",
    location: "header",
  }),
  Object.freeze({
    key: "header_division_finance",
    parent_key: "header_divisions",
    location: "header",
  }),
  Object.freeze({
    key: "footer_company_leadership",
    parent_key: "footer_about",
    location: "footer",
  }),
  Object.freeze({
    key: "footer_company_news",
    parent_key: "footer_about",
    location: "footer",
  }),
]);

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

function verifyPublishedNavigationHierarchy(navigation) {
  const items = Array.isArray(navigation) ? navigation : [];
  const byKey = new Map(items.map((item) => [String(item?.key || ""), item]));
  const failures = [];

  for (const expected of EXPECTED_NAVIGATION_HIERARCHY) {
    const item = byKey.get(expected.key);
    if (
      !item ||
      item.parent_key !== expected.parent_key ||
      item.location !== expected.location
    ) {
      failures.push({ expected, actual: item || null });
    }
  }

  for (const parentKey of ["header_divisions", "footer_about"]) {
    if (!byKey.has(parentKey)) {
      failures.push({ expected_parent: parentKey, actual: null });
    }
  }

  if (failures.length > 0) {
    fail(
      "The published staging navigation hierarchy is incomplete or linked to the wrong parent.",
      "CHALIN_ONE_STAGING_NAVIGATION_HIERARCHY_FAILED",
      failures
    );
  }

  return Object.freeze({
    child_count: EXPECTED_NAVIGATION_HIERARCHY.length,
    header_child_count: EXPECTED_NAVIGATION_HIERARCHY.filter(
      (item) => item.location === "header"
    ).length,
    footer_child_count: EXPECTED_NAVIGATION_HIERARCHY.filter(
      (item) => item.location === "footer"
    ).length,
    parent_keys: ["header_divisions", "footer_about"],
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

  const bootstrap = await request(`${api}/public/content/bootstrap`);
  if (!bootstrap.ok || bootstrap.body?.status !== "success") {
    fail(
      "The staging public bootstrap is unavailable for hierarchy verification.",
      "CHALIN_ONE_STAGING_NAVIGATION_BOOTSTRAP_FAILED",
      bootstrap
    );
  }
  const bootstrapPrivateFindings = scanPrivateKeys(bootstrap.body);
  if (bootstrapPrivateFindings.length > 0) {
    fail(
      "The staging public bootstrap exposed private fields during hierarchy verification.",
      "CHALIN_ONE_STAGING_NAVIGATION_PRIVATE_FIELD_EXPOSED",
      bootstrapPrivateFindings
    );
  }
  const hierarchy = verifyPublishedNavigationHierarchy(
    dataOf(bootstrap)?.navigation
  );

  const checks = baseReport.checks
    .map((check) =>
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
    )
    .concat({
      name: "Published navigation hierarchy",
      passed: true,
      status: bootstrap.status,
      ...hierarchy,
      private_findings: bootstrapPrivateFindings,
    });

  const report = Object.freeze({
    ...baseReport,
    governed_homepage_discovery: true,
    governed_navigation_hierarchy: true,
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
        `CHALIN ONE staging smoke passed ${report.checks.length} checks, including governed homepage and navigation hierarchy discovery.`
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
  EXPECTED_NAVIGATION_HIERARCHY,
  runGovernedHomepageStagingSmoke,
  verifyPublishedNavigationHierarchy,
  writeReport,
};
