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

check("model contains every first-release Content Studio manager", () => {
  const keys = model.CONTENT_STUDIO_SECTIONS.map((section) => section.key);
  assert.deepEqual(keys, [
    "pages",
    "newsroom",
    "leadership",
    "projects",
    "equipment",
    "company-info",
    "media",
    "forms",
    "submissions",
    "approvals",
    "navigation",
    "settings",
  ]);
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

check("foundation API reuses authenticated Axios and has no token or raw fetch logic", () => {
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
});

check("workspace enforces isolated Studio session, role permission and scoped managers", () => {
  assert.match(workspaceSource, /useAuth/);
  assert.match(workspaceSource, /isContentStudioWorkspace/);
  assert.match(workspaceSource, /contentStudioScopes/);
  assert.match(workspaceSource, /SECTION_SCOPES/);
  assert.match(workspaceSource, /isContentStudioOwner/);
  assert.match(modelSource, /public_content\.view/);
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
    "ContentStudioPageManager",
    "ContentStudioNewsroomManager",
    "ContentStudioLeadershipManager",
    "ContentStudioProjectManager",
    "ContentStudioEquipmentManager",
    "ContentStudioCompanyInfoManager",
    "ContentStudioMediaManager",
    "ContentStudioFormManager",
    "ContentStudioEnquiryDesk",
    "ContentStudioApprovalInbox",
    "ContentStudioNavigationManager",
    "ContentStudioSettingsManager",
    "ContentStudioAccessManager",
  ]) assert.match(workspaceSource, new RegExp(manager));
  assert.match(workspaceSource, /const MANAGERS/);
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
  assert.match(indexSource, /ContentStudioMediaManager/);
  assert.match(indexSource, /ContentStudioFormManager/);
  assert.match(indexSource, /ContentStudioApprovalInbox/);
  assert.match(indexSource, /contentStudioOperationsApi/);
  assert.match(indexSource, /contentStudioModel/);
});

console.log(`\nContent Studio foundation: ${passed}/11 checks passed.`);
