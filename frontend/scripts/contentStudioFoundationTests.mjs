import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const moduleRoot = path.join(
  frontendRoot,
  "src/chalin-one/content-studio"
);

const model = await import(
  pathToFileURL(path.join(moduleRoot, "contentStudioModel.js")).href
);
const modelSource = fs.readFileSync(path.join(moduleRoot, "contentStudioModel.js"), "utf8");
const apiSource = fs.readFileSync(path.join(moduleRoot, "contentStudioApi.js"), "utf8");
const analyticsApiSource = fs.readFileSync(
  path.join(moduleRoot, "contentStudioAnalyticsApi.js"),
  "utf8"
);
const launchReadinessApiSource = fs.readFileSync(
  path.join(moduleRoot, "contentStudioLaunchReadinessApi.js"),
  "utf8"
);
const workspaceSource = fs.readFileSync(
  path.join(moduleRoot, "ContentStudioWorkspace.jsx"),
  "utf8"
);
const dashboardSource = fs.readFileSync(
  path.join(moduleRoot, "ContentStudioDashboard.jsx"),
  "utf8"
);
const cssSource = fs.readFileSync(path.join(moduleRoot, "contentStudio.css"), "utf8");
const indexSource = fs.readFileSync(path.join(moduleRoot, "index.js"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("model contains every governed Content Studio manager", () => {
  const keys = model.CONTENT_STUDIO_SECTIONS.map((section) => section.key);
  assert.deepEqual(keys, [
    "visual-builder",
    "pages",
    "newsroom",
    "leadership",
    "projects",
    "equipment",
    "company-info",
    "media",
    "media-cleanup",
    "media-reference",
    "forms",
    "submissions",
    "approvals",
    "publisher-command",
    "public-analytics",
    "launch-readiness",
    "website-control",
    "redirects",
    "navigation",
    "settings",
  ]);
  const visualBuilder = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "visual-builder"
  );
  assert.equal(visualBuilder.permission, "public_content.view");
  assert.equal(visualBuilder.endpoint, "/content-studio/pages");
  const cleanup = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "media-cleanup"
  );
  assert.equal(cleanup.permission, "public_media.manage");
  assert.equal(cleanup.group, "Assets");
  const reference = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "media-reference"
  );
  assert.equal(reference.permission, "public_media.manage");
  assert.equal(reference.group, "Assets");
  const publisher = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "publisher-command"
  );
  assert.equal(publisher.permission, "public_content.publish");
  assert.equal(publisher.group, "Governance");
  const publicAnalytics = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "public-analytics"
  );
  assert.equal(publicAnalytics.permission, "public_content.view");
  assert.equal(publicAnalytics.endpoint, "/content-studio/dashboard/analytics/summary");
  assert.equal(publicAnalytics.group, "Website");
  const launchReadiness = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "launch-readiness"
  );
  assert.equal(launchReadiness.permission, "public_content.view");
  assert.equal(launchReadiness.endpoint, "/readiness");
  assert.equal(launchReadiness.group, "Website");
  const websiteControl = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "website-control"
  );
  assert.equal(websiteControl.permission, "public_content.view");
  assert.equal(websiteControl.endpoint, "/content-studio/pages/website-control");
  assert.equal(websiteControl.group, "Website");
  const redirects = model.CONTENT_STUDIO_SECTIONS.find(
    (section) => section.key === "redirects"
  );
  assert.equal(redirects.permission, "public_navigation.view");
  assert.equal(redirects.endpoint, "/content-studio/navigation/redirects");
  assert.equal(redirects.group, "Website");
});

check("access helpers fail closed and filter by backend permission", () => {
  assert.equal(model.canAccessContentStudioSection(null, () => true), false);
  assert.equal(
    model.canAccessContentStudioSection(model.CONTENT_STUDIO_SECTIONS[0], null),
    false
  );
  const accessible = model.getAccessibleContentStudioSections(
    (permission) => permission === "public_media.view"
  );
  assert.deepEqual(accessible.map((section) => section.key), ["media"]);
  const mediaManagers = model.getAccessibleContentStudioSections(
    (permission) => ["public_media.view", "public_media.manage"].includes(permission)
  );
  assert.deepEqual(mediaManagers.map((section) => section.key), [
    "media",
    "media-cleanup",
    "media-reference",
  ]);
  const publishOnly = model.getAccessibleContentStudioSections(
    (permission) => permission === "public_content.publish"
  );
  assert.deepEqual(publishOnly.map((section) => section.key), ["publisher-command"]);
  const navigationView = model.getAccessibleContentStudioSections(
    (permission) => permission === "public_navigation.view"
  );
  assert.deepEqual(navigationView.map((section) => section.key), ["redirects", "navigation"]);
});

check("dashboard normalization converts SQL values to safe non-negative numbers", () => {
  const result = model.normalizeContentStudioDashboard({
    pages: { total_pages: "9", published_pages: "4", draft_pages: -1 },
    approvals: { pending_approvals: "2" },
    submissions: { new_submissions: "3" },
    media: { ready_media: "7", quarantined_media: "invalid" },
  });
  assert.equal(result.pages.total, 9);
  assert.equal(result.pages.published, 4);
  assert.equal(result.pages.draft, 0);
  assert.equal(result.approvals.pending, 2);
  assert.equal(result.media.quarantined, 0);
});

check("foundation APIs reuse authenticated Axios and have no token or raw fetch logic", () => {
  assert.match(apiSource, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage|Bearer|fetch\(/);
  assert.match(apiSource, /Unsupported Content Studio resource path/);
  for (const pathValue of [
    "/content-studio/dashboard",
    "/content-studio/pages",
    "/content-studio/newsroom/article",
    "/content-studio/portfolio/leadership",
    "/content-studio/company-info/division",
    "/content-studio/media",
    "/content-studio/forms",
    "/content-studio/submissions",
    "/content-studio/navigation",
    "/content-studio/settings",
  ]) {
    assert.match(apiSource, new RegExp(pathValue.replaceAll("/", "\\/")));
  }
  assert.match(analyticsApiSource, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.match(analyticsApiSource, /\/content-studio\/dashboard\/analytics\/summary/);
  assert.doesNotMatch(analyticsApiSource, /localStorage|sessionStorage|Bearer|fetch\(/);
  assert.match(launchReadinessApiSource, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.match(launchReadinessApiSource, /\/readiness/);
  assert.doesNotMatch(launchReadinessApiSource, /axiosClient\.(?:post|put|patch|delete)|localStorage|sessionStorage|Bearer|fetch\(/);
});

check("workspace enforces isolated Studio session, role permission and scoped managers", () => {
  assert.match(workspaceSource, /useAuth/);
  assert.match(workspaceSource, /isContentStudioWorkspace/);
  assert.match(workspaceSource, /contentStudioScopes/);
  assert.match(workspaceSource, /SECTION_SCOPES/);
  assert.match(workspaceSource, /"visual-builder": "pages"/);
  assert.match(workspaceSource, /"media-cleanup": "media"/);
  assert.match(workspaceSource, /"media-reference": "media"/);
  assert.match(workspaceSource, /"publisher-command": "pages"/);
  assert.match(workspaceSource, /"public-analytics": "dashboard"/);
  assert.match(workspaceSource, /"launch-readiness": "dashboard"/);
  assert.match(workspaceSource, /"website-control": "pages"/);
  assert.match(workspaceSource, /redirects: "navigation"/);
  assert.match(workspaceSource, /isContentStudioOwner/);
  assert.match(modelSource, /public_content\.view/);
  assert.match(modelSource, /permission: CONTENT_STUDIO_PERMISSIONS\.mediaManage/);
  assert.match(modelSource, /permission: CONTENT_STUDIO_PERMISSIONS\.publish/);
  assert.match(workspaceSource, /CONTENT_STUDIO_PERMISSIONS\.view/);
  assert.match(workspaceSource, /Content Studio sign-in required/);
  assert.match(workspaceSource, /Studio role required/);
  assert.doesNotMatch(workspaceSource, /useFeatureFlags|isFeatureEnabled\("contentStudio"\)/);
  assert.doesNotMatch(workspaceSource, /dangerouslySetInnerHTML/);
});

check("requests are abortable and permission changes reset inaccessible modules", () => {
  assert.match(workspaceSource, /new AbortController\(\)/);
  assert.match(workspaceSource, /controller\.abort\(\)/);
  assert.match(workspaceSource, /sections\.some/);
});

check("workspace maps every manager without direct routing or token bypass", () => {
  for (const manager of [
    "ContentStudioVisualBuilder",
    "ContentStudioPageManager",
    "ContentStudioNewsroomManager",
    "ContentStudioLeadershipManager",
    "ContentStudioProjectManager",
    "ContentStudioEquipmentManager",
    "ContentStudioCompanyInfoManager",
    "ContentStudioMediaManager",
    "ContentStudioMediaCleanupManager",
    "ContentStudioMediaReferenceDesk",
    "ContentStudioFormManager",
    "ContentStudioEnquiryDesk",
    "ContentStudioApprovalInbox",
    "ContentStudioPublisherCommandCenter",
    "ContentStudioPublicAnalytics",
    "ContentStudioLaunchReadiness",
    "ContentStudioWebsiteControlCenter",
    "ContentStudioRedirectManager",
    "ContentStudioNavigationManager",
    "ContentStudioSettingsManager",
    "ContentStudioAccessManager",
  ]) assert.match(workspaceSource, new RegExp(manager));
  assert.match(workspaceSource, /const MANAGERS/);
  assert.match(workspaceSource, /<ActiveManager onOpenSection=\{openSection\} \/>/);
  assert.doesNotMatch(workspaceSource, /window\.location\.href|localStorage|Bearer/);
});

check("dashboard communicates protected governance and operational queues", () => {
  assert.match(dashboardSource, /Protected workspace/);
  assert.match(dashboardSource, /Pending approvals/);
  assert.match(dashboardSource, /New enquiries/);
  assert.match(dashboardSource, /Quarantined media/);
  assert.match(dashboardSource, /onOpenSection/);
});

check("responsive CSS covers tablet, phone and narrow phone layouts", () => {
  assert.match(cssSource, /@media \(max-width: 820px\)/);
  assert.match(cssSource, /@media \(max-width: 540px\)/);
  assert.match(cssSource, /@media \(max-width: 390px\)/);
  assert.match(cssSource, /cs-mobile-backdrop/);
  assert.match(cssSource, /cs-sidebar\[data-open="true"\]/);
});

check("design system includes required professional status colors", () => {
  assert.match(cssSource, /--cs-navy-900/);
  assert.match(cssSource, /--cs-white/);
  assert.match(cssSource, /--cs-success/);
  assert.match(cssSource, /--cs-warning/);
  assert.match(cssSource, /--cs-danger/);
});

check("package barrel exposes the complete Content Studio package", () => {
  assert.match(indexSource, /ContentStudioWorkspace/);
  assert.match(indexSource, /ContentStudioVisualBuilder/);
  assert.match(indexSource, /ContentStudioMediaManager/);
  assert.match(indexSource, /ContentStudioFormManager/);
  assert.match(indexSource, /ContentStudioApprovalInbox/);
  assert.match(indexSource, /contentStudioOperationsApi/);
  assert.match(indexSource, /contentStudioVisualBuilderModel/);
  assert.match(indexSource, /contentStudioModel/);
});

console.log(`\nContent Studio foundation: ${passed}/11 checks passed.`);
