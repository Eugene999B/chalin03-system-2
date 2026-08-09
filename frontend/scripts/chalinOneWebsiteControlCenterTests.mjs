import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const model = await import(pathToFileURL(path.join(root, "contentStudioWebsiteControlModel.js")).href);
const studioModel = await import(pathToFileURL(path.join(root, "contentStudioModel.js")).href);
const component = fs.readFileSync(path.join(root, "ContentStudioWebsiteControlCenter.jsx"), "utf8");
const api = fs.readFileSync(path.join(root, "contentStudioWebsiteControlApi.js"), "utf8");
const css = fs.readFileSync(path.join(root, "contentStudioWebsiteControlCenter.css"), "utf8");
const workspace = fs.readFileSync(path.join(root, "ContentStudioWorkspace.jsx"), "utf8");
const publicApp = fs.readFileSync(path.join(frontendRoot, "src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("website-control normalization fails closed to safe numeric and list defaults", () => {
  const result = model.normalizeWebsiteControl({
    summary: { health_score: "91", total_pages: "7", page_issues: { warning: "2" } },
    pages: [{ id: 1 }],
  });
  assert.equal(result.summary.healthScore, 91);
  assert.equal(result.summary.totalPages, 7);
  assert.equal(result.summary.pageIssues.warning, 2);
  assert.equal(result.summary.navigationItems, 0);
  assert.equal(result.pages.length, 1);
  assert.deepEqual(result.redirectCandidates, []);
});

check("website-control search severity and renderer capability models are deterministic", () => {
  const row = { title: "About CHALIN", slug: "about", issues: [{ severity: "warning", code: "CANONICAL_MISSING", message: "Missing canonical" }] };
  assert.equal(model.matchesWebsiteControlQuery(row, "canonical"), true);
  assert.equal(model.matchesWebsiteControlQuery(row, "equipment"), false);
  assert.equal(model.rowHasSeverity(row, "warning"), true);
  assert.equal(model.rowHasSeverity(row, "critical"), false);
  assert.equal(model.PUBLIC_METADATA_CAPABILITIES.filter((item) => item.status === "active").length, 2);
  assert.equal(model.PUBLIC_METADATA_CAPABILITIES.find((item) => item.key === "canonical").status, "pending");
});

check("Website Control API uses authenticated Axios and exposes one read-only endpoint", () => {
  assert.match(api, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.match(api, /axiosClient\.get\("\/content-studio\/pages\/website-control"/);
  assert.doesNotMatch(api, /axiosClient\.(?:post|put|patch|delete)|fetch\(|localStorage|sessionStorage|Bearer/);
});

check("Website Control Center exposes SEO navigation orphan redirect and platform-capability views", () => {
  for (const marker of ["Website Control Center", "SEO health", "Navigation", "Orphan pages", "Redirect intelligence", "Metadata capability coverage", "Read-only control plane"]) {
    assert.match(component, new RegExp(marker));
  }
  assert.match(component, /getWebsiteControlIntelligence/);
  assert.match(component, /AbortController/);
  assert.match(component, /onOpenSection\?\.\("pages"\)/);
  assert.match(component, /onOpenSection\?\.\("navigation"\)/);
  assert.doesNotMatch(component, /createPage|updatePage|publishPage|archivePage|createNavigation|updateNavigation|publishNavigation|archiveNavigation/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML/);
});

check("Studio catalogue and workspace keep Website Control Center in the existing Pages scope", () => {
  const section = studioModel.CONTENT_STUDIO_SECTIONS.find((item) => item.key === "website-control");
  assert.ok(section);
  assert.equal(section.permission, "public_content.view");
  assert.equal(section.endpoint, "/content-studio/pages/website-control");
  assert.equal(section.group, "Website");
  assert.match(workspace, /ContentStudioWebsiteControlCenter/);
  assert.match(workspace, /"website-control": "pages"/);
  assert.match(workspace, /"website-control": ContentStudioWebsiteControlCenter/);
});

check("Control Center has responsive desktop tablet phone and reduced-motion treatment", () => {
  assert.match(css, /@media\(max-width:1180px\)/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /scroll-snap-type:x mandatory/);
});

check("platform capability card matches the current public metadata renderer before Phase 2H renderer upgrade", () => {
  assert.match(publicApp, /function useMetadata\(title, description = ""\)/);
  assert.match(publicApp, /document\.title = title/);
  assert.match(publicApp, /meta\[name="description"\]/);
  assert.doesNotMatch(publicApp, /rel=["']canonical["']/);
  assert.doesNotMatch(publicApp, /property=["']og:title["']/);
});

console.log(`\nWebsite Control Center: ${passed}/7 checks passed.`);
