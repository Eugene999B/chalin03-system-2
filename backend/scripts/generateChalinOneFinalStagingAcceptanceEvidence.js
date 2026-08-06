"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_BROWSER_EVIDENCE,
  DEFAULT_OUTPUT,
  DEFAULT_RELEASE_EVIDENCE,
  DEFAULT_SMOKE_EVIDENCE,
  commandOptions,
  generateStagingAcceptanceEvidence,
} = require("./generateChalinOneStagingAcceptanceEvidence");

function clean(value) {
  return String(value || "").trim();
}

function readJson(filePath, label) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const wrapped = new Error(`${label} could not be read from ${filePath}.`);
    wrapped.code = "CHALIN_ONE_FINAL_STAGING_EVIDENCE_FILE_MISSING";
    wrapped.details = { file: filePath, cause: error.message };
    throw wrapped;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    const wrapped = new Error(`${label} is not valid JSON.`);
    wrapped.code = "CHALIN_ONE_FINAL_STAGING_EVIDENCE_INVALID_JSON";
    wrapped.details = { file: filePath, cause: error.message };
    throw wrapped;
  }
}

function navigationHierarchyEvidence(smoke) {
  const checks = Array.isArray(smoke?.checks) ? smoke.checks : [];
  const check = checks.find(
    (item) => clean(item?.name) === "Published navigation hierarchy"
  );
  const privateFindings = Array.isArray(check?.private_findings)
    ? check.private_findings.filter((item) => clean(item))
    : [];
  const childCount = Number(check?.child_count || 0);
  const headerChildCount = Number(check?.header_child_count || 0);
  const footerChildCount = Number(check?.footer_child_count || 0);
  const parentKeys = Array.isArray(check?.parent_keys)
    ? check.parent_keys.map(clean).filter(Boolean)
    : [];
  const requiredParents = ["header_divisions", "footer_about"];
  const parentsComplete = requiredParents.every((key) =>
    parentKeys.includes(key)
  );

  return Object.freeze({
    passed:
      smoke?.governed_navigation_hierarchy === true &&
      check?.passed === true &&
      childCount >= 7 &&
      headerChildCount >= 5 &&
      footerChildCount >= 2 &&
      parentsComplete &&
      privateFindings.length === 0,
    governed_navigation_hierarchy:
      smoke?.governed_navigation_hierarchy === true,
    smoke_check_present: Boolean(check),
    child_count: childCount,
    header_child_count: headerChildCount,
    footer_child_count: footerChildCount,
    parent_keys: parentKeys,
    parents_complete: parentsComplete,
    private_findings: privateFindings,
  });
}

function writeReport(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function generateFinalStagingAcceptanceEvidence({
  releasePath = DEFAULT_RELEASE_EVIDENCE,
  smokePath = DEFAULT_SMOKE_EVIDENCE,
  browserPath = DEFAULT_BROWSER_EVIDENCE,
  outputPath = DEFAULT_OUTPUT,
  writeFile = true,
} = {}) {
  const base = generateStagingAcceptanceEvidence({
    releasePath,
    smokePath,
    browserPath,
    outputPath,
    writeFile: false,
  });
  const smoke = readJson(smokePath, "Staging smoke evidence");
  const hierarchy = navigationHierarchyEvidence(smoke);
  const failures = [...base.failures];
  if (!hierarchy.passed && !failures.includes("published_navigation_hierarchy")) {
    failures.push("published_navigation_hierarchy");
  }

  const report = Object.freeze({
    ...base,
    report: "CHALIN ONE Final Staging Acceptance Evidence",
    staging_ready: base.staging_ready && hierarchy.passed,
    failures,
    gates: {
      ...base.gates,
      published_navigation_hierarchy: hierarchy,
    },
  });

  if (writeFile) writeReport(outputPath, report);
  return report;
}

if (require.main === module) {
  try {
    const options = commandOptions();
    const report = generateFinalStagingAcceptanceEvidence(options);
    console.log(
      report.staging_ready
        ? "CHALIN ONE final staging evidence passed every release gate, including published navigation hierarchy."
        : `CHALIN ONE final staging evidence is incomplete or failed: ${report.failures.join(", ")}.`
    );
    console.log(`Final staging evidence report: ${options.outputPath}`);
    if (!report.staging_ready) process.exitCode = 2;
  } catch (error) {
    console.error(`CHALIN ONE final staging evidence failed: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  generateFinalStagingAcceptanceEvidence,
  navigationHierarchyEvidence,
  readJson,
  writeReport,
};
