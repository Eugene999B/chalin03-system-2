import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const api = fs.readFileSync(path.join(root, "contentStudioOperationsApi.js"), "utf8");
const media = fs.readFileSync(path.join(root, "ContentStudioMediaManager.jsx"), "utf8");
const forms = fs.readFileSync(path.join(root, "ContentStudioFormManager.jsx"), "utf8");
const operational = fs.readFileSync(path.join(root, "ContentStudioOperationalManagers.jsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "ContentStudioWorkspace.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "contentStudioOperationalManagers.css"), "utf8");
const navigationRoute = fs.readFileSync(
  path.resolve(frontendRoot, "../backend/routes/contentStudioNavigationRoutes.js"),
  "utf8"
);
const navigationApprovalService = fs.readFileSync(
  path.resolve(frontendRoot, "../backend/services/contentStudioNavigationApprovalService.js"),
  "utf8"
);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("operational API reuses authenticated Axios and blocks unsupported direct transport", () => {
  assert.match(api, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.doesNotMatch(api, /localStorage|sessionStorage|Bearer|fetch\(|axiosClient\.delete/);
  assert.match(api, /transformRequest: \[\(body\) => body\]/);
  assert.match(api, /Content-Type/);
  assert.match(api, /x-media-alt-text/);
});

check("Media Library covers assets folders image processing video usage metadata and archive", () => {
  for (const marker of [
    "listMedia",
    "listMediaFolders",
    "uploadMediaImage",
    "registerMediaVideo",
    "getMediaUsage",
    "updateMediaAsset",
    "archiveMediaAsset",
    "archiveMediaFolder",
  ]) assert.match(media, new RegExp(marker));
  assert.match(media, /image\/jpeg,image\/png,image\/webp/);
  assert.match(media, /processing_status/);
  assert.match(media, /CONTENT_STUDIO_PERMISSIONS\.mediaManage/);
  assert.match(media, /window\.confirm/);
});

check("Form Builder exposes only backend-supported safe no-code field types", () => {
  for (const type of [
    "text",
    "textarea",
    "email",
    "tel",
    "number",
    "select",
    "radio",
    "multiselect",
    "checkbox_group",
    "checkbox",
    "boolean",
  ]) assert.match(forms, new RegExp(`"${type}"`));
  assert.doesNotMatch(forms, /"file"|"html"|"script"|dangerouslySetInnerHTML|contentEditable/);
  assert.match(forms, /current\.fields\.length >= 60/);
  assert.match(forms, /maximum 100/);
  assert.match(forms, /CONTENT_STUDIO_PERMISSIONS\.formsManage/);
});

check("Form Builder targets exact versions and preserves submissions on archive", () => {
  assert.match(forms, /content_version_id/);
  assert.match(forms, /selectedVersionId/);
  assert.match(forms, /submitFormVersion\(selectedId, selectedVersionId/);
  assert.match(forms, /publishFormVersion\(selectedId, selectedVersionId/);
  assert.match(forms, /Existing customer submissions will be preserved/);
  assert.doesNotMatch(api, /DELETE FROM|axiosClient\.delete/);
});

check("Enquiry Desk separates view respond and manage permissions", () => {
  assert.match(operational, /CONTENT_STUDIO_PERMISSIONS\.submissionsRespond/);
  assert.match(operational, /CONTENT_STUDIO_PERMISSIONS\.submissionsManage/);
  assert.match(operational, /assignSubmission/);
  assert.match(operational, /reviewSubmission/);
  assert.match(operational, /changeSubmissionStatus/);
  assert.doesNotMatch(operational, /ip_hash|user_agent|storage_key|download/i);
});

check("Enquiry Desk displays file metadata and controlled status options", () => {
  for (const status of [
    "new",
    "in_review",
    "awaiting_customer",
    "resolved",
    "rejected",
    "spam",
    "archived",
  ]) assert.match(operational, new RegExp(`"${status}"`));
  assert.match(operational, /security_status/);
  assert.match(operational, /file_size_bytes/);
  assert.match(operational, /Audit history/);
});

check("Approval Inbox aggregates all six governed approval sources", () => {
  for (const source of [
    "page",
    "portfolio",
    "newsroom",
    "company_info",
    "form",
    "navigation",
  ]) assert.match(api, new RegExp(`source: "${source}"`));
  assert.match(operational, /Exact saved snapshot/);
  assert.match(operational, /CONTENT_STUDIO_PERMISSIONS\.approve/);
  assert.match(api, /Unsupported Content Studio approval source/);
});

check("approval decisions route to the correct backend manager endpoints", () => {
  for (const path of [
    "/content-studio/approvals/",
    "/content-studio/portfolio/",
    "/content-studio/newsroom/",
    "/content-studio/company-info/",
    "/content-studio/forms/approvals/",
    "/content-studio/navigation/approvals/",
  ]) assert.match(api, new RegExp(path.replaceAll("/", "\\/")));
});

check("Navigation manager uses safe locations hierarchy IDs exact versions and archive confirmation", () => {
  for (const location of ["header", "footer", "mobile", "utility"]) {
    assert.match(operational, new RegExp(`"${location}"`));
  }
  assert.match(operational, /CONTENT_STUDIO_PERMISSIONS\.navigationManage/);
  assert.match(operational, /latest_version_id/);
  assert.match(operational, /content_version_id/);
  assert.match(operational, /Active children will block unsafe archival/);
});

check("Navigation approval list is now exposed through protected backend routes", () => {
  assert.match(navigationRoute, /listNavigationApprovals/);
  assert.match(navigationRoute, /router\.get\(\s*"\/approvals"/s);
  assert.match(navigationRoute, /public_content\.review/);
  assert.match(navigationApprovalService, /entity_type = 'navigation_item'/);
  assert.match(navigationApprovalService, /approval_status = 'pending'/);
  assert.match(navigationApprovalService, /snapshot: parseJson/);
});

check("Website Settings enforces the public allowlist and JSON values", () => {
  assert.match(operational, /PUBLIC_SETTING_KEYS/);
  assert.match(operational, /JSON\.parse\(form\.value_text\)/);
  assert.match(operational, /CONTENT_STUDIO_PERMISSIONS\.settingsManage/);
  assert.match(operational, /Expose through approved public API/);
  assert.match(operational, /Deactivate this website setting/);
});

check("workspace contains real managers for every Content Studio section", () => {
  for (const key of [
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
  ]) assert.match(workspace, new RegExp(`(?:"${key}"|${key}):`));
  assert.doesNotMatch(workspace, /Read-only foundation|Editor interface next/);
});

check("operational design remains responsive on tablet and phone", () => {
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /cs-ops-tabs/);
  assert.match(css, /cs-contact-grid/);
  assert.match(css, /cs-form-field-card/);
});

console.log(`\nContent Studio operational managers: ${passed}/13 checks passed.`);
