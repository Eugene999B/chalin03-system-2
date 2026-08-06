import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const apiSource = fs.readFileSync(
  path.join(root, "contentStudioNewsroomApi.js"),
  "utf8"
);
const managerSource = fs.readFileSync(
  path.join(root, "ContentStudioNewsroomManager.jsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(root, "contentStudioNewsroomManager.css"),
  "utf8"
);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("Newsroom API rejects unsupported kinds before sending requests", () => {
  assert.match(apiSource, /const NEWSROOM_KINDS = new Set\(\["article", "announcement"\]\)/);
  assert.match(apiSource, /Unsupported Newsroom manager/);
  assert.match(apiSource, /safeKind\(kind\)/);
});

check("Newsroom API covers the complete exact-version workflow", () => {
  for (const fragment of [
    "/content-studio/newsroom/",
    "/versions",
    "/submit",
    "/approvals/",
    "/decision",
    "/publish",
    "/restore",
    "/archive",
    "/categories",
  ]) {
    assert.match(apiSource, new RegExp(fragment.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage|Bearer|fetch\(/);
  assert.doesNotMatch(apiSource, /axiosClient\.delete/);
});

check("manager exposes articles, announcements and categories as separate tabs", () => {
  assert.match(managerSource, /\["article", "Articles"\]/);
  assert.match(managerSource, /\["announcement", "Announcements"\]/);
  assert.match(managerSource, /\["categories", "Categories"\]/);
  assert.match(managerSource, /role="tablist"/);
  assert.match(managerSource, /aria-selected/);
});

check("all governed actions use their exact Content Studio permissions", () => {
  for (const permission of [
    "create",
    "edit",
    "submit",
    "approve",
    "publish",
    "restore",
    "archive",
  ]) {
    assert.match(
      managerSource,
      new RegExp(`CONTENT_STUDIO_PERMISSIONS\\.${permission}`)
    );
  }
});

check("article editor preserves structured body data until intentionally replaced", () => {
  assert.match(managerSource, /original_body/);
  assert.match(managerSource, /has_structured_body/);
  assert.match(managerSource, /form\.has_structured_body && form\.body_text === ""/);
  assert.match(managerSource, /return form\.original_body/);
  assert.match(managerSource, /typeof form\.original_body\?\.text === "string"/);
  assert.doesNotMatch(managerSource, /dangerouslySetInnerHTML|contentEditable|eval\(/);
});

check("announcement editor exposes only backend-approved styles and safe link guidance", () => {
  for (const style of ["info", "success", "warning", "urgent", "promotion"]) {
    assert.match(managerSource, new RegExp(`value=\\"${style}\\"`));
  }
  assert.doesNotMatch(managerSource, /value="error"|value="danger"/);
  assert.match(managerSource, /Use \/relative-path or an HTTPS address without credentials/);
  assert.match(managerSource, /Supply both a label and URL/);
});

check("approval and publishing target the selected content version ID", () => {
  assert.match(managerSource, /selectedVersionId/);
  assert.match(managerSource, /content_version_id/);
  assert.match(managerSource, /pendingApproval/);
  assert.match(managerSource, /approvedApproval/);
  assert.match(managerSource, /submitNewsroomVersion\(kind, selectedId, selectedVersionId/);
  assert.match(managerSource, /publishNewsroomVersion\(kind, selectedId, selectedVersionId/);
});

check("non-draft Newsroom versions cannot be edited in place", () => {
  assert.match(managerSource, /selectedVersion\?\.version_status === "draft"/);
  assert.match(managerSource, /Create new draft/);
  assert.match(managerSource, /disabled=\{!editable\}/);
});

check("category manager displays usage and confirms protected archival", () => {
  assert.match(managerSource, /active_article_count/);
  assert.match(managerSource, /Active and draft articles must already use another category/);
  assert.match(managerSource, /window\.confirm/);
  assert.match(managerSource, /Archive category/);
});

check("failed category saves preserve the editor and entered form data", () => {
  assert.match(managerSource, /const saved = await onSave\(mode, selectedId, form\)/);
  assert.match(managerSource, /if \(!saved\) return/);
  assert.match(managerSource, /setNotice\("The news category was saved safely\."\);\s+return true/);
  assert.match(managerSource, /setError\(contentStudioErrorMessage\(categoryError\)\);\s+return false/);
});

check("requests are abortable and errors use the shared safe formatter", () => {
  assert.match(managerSource, /new AbortController\(\)/);
  assert.match(managerSource, /controller\.abort\(\)/);
  assert.match(managerSource, /contentStudioErrorMessage/);
});

check("Newsroom layout covers tablet and narrow-phone breakpoints", () => {
  assert.match(cssSource, /@media \(max-width: 980px\)/);
  assert.match(cssSource, /@media \(max-width: 620px\)/);
  assert.match(cssSource, /@media \(max-width: 430px\)/);
  assert.match(cssSource, /cs-news-category-layout/);
  assert.match(cssSource, /overflow-x: auto/);
});

console.log(`\nContent Studio Newsroom Manager: ${passed}/12 checks passed.`);
