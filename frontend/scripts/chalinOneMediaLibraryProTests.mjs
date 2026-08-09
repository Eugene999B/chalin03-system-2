import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const model = await import(
  pathToFileURL(path.join(root, "contentStudioMediaProModel.js")).href
);
const component = fs.readFileSync(path.join(root, "ContentStudioMediaManagerPro.jsx"), "utf8");
const api = fs.readFileSync(path.join(root, "contentStudioMediaProApi.js"), "utf8");
const css = fs.readFileSync(path.join(root, "contentStudioMediaPro.css"), "utf8");
const workspace = fs.readFileSync(path.join(root, "ContentStudioWorkspace.jsx"), "utf8");
const studioModel = fs.readFileSync(path.join(root, "contentStudioModel.js"), "utf8");
const cleanup = fs.readFileSync(path.join(root, "ContentStudioMediaCleanupManager.jsx"), "utf8");
const cleanupCss = fs.readFileSync(path.join(root, "contentStudioMediaCleanup.css"), "utf8");
const picker = fs.readFileSync(path.join(root, "ContentStudioMediaPickerField.jsx"), "utf8");
const pickerCss = fs.readFileSync(path.join(root, "contentStudioMediaPickerField.css"), "utf8");
const governedManager = fs.readFileSync(path.join(root, "ContentStudioGovernedManager.jsx"), "utf8");
const leadership = fs.readFileSync(path.join(root, "ContentStudioLeadershipManager.jsx"), "utf8");
const newsroom = fs.readFileSync(path.join(root, "ContentStudioNewsroomManager.jsx"), "utf8");
const pageManager = fs.readFileSync(path.join(root, "ContentStudioPageManager.jsx"), "utf8");
const visualBuilder = fs.readFileSync(path.join(root, "ContentStudioVisualBuilder.jsx"), "utf8");
const portfolioManagers = fs.readFileSync(path.join(root, "ContentStudioPortfolioManagers.jsx"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("media helpers format storage dimensions readiness and variants safely", () => {
  assert.equal(model.formatMediaBytes(1024), "1.0 KB");
  assert.equal(model.mediaDimensions({ width: 1600, height: 900 }), "1600 × 900");
  assert.equal(model.mediaDimensions({}), "No dimensions");
  assert.deepEqual(
    model.mediaReadinessIssues({
      media_type: "image",
      processing_status: "ready",
      public_url: "https://media.example.com/x.webp",
      alt_text: "Excavator",
    }),
    []
  );
  assert.equal(
    model.mediaReadinessIssues({ media_type: "image", processing_status: "pending", public_url: "", alt_text: "" }).length,
    3
  );
  assert.deepEqual(
    model.mediaVariantList({ metadata: { variants: [{ name: "w480", width: 480, height: 270, size: 1234 }] } }),
    [{ key: "w480", name: "w480", width: 480, height: 270, size: 1234, public_url: "" }]
  );
});

check("intelligence normalization fails closed to empty queues and numeric counts", () => {
  const result = model.normalizeMediaIntelligence({
    summary: { total: "9", public_ready: "5", missing_alt: "2", total_bytes: "1000" },
    queues: { missing_alt: [{ id: 1 }] },
  });
  assert.equal(result.summary.total, 9);
  assert.equal(result.summary.publicReady, 5);
  assert.equal(result.summary.missingAlt, 2);
  assert.equal(result.summary.totalBytes, 1000);
  assert.equal(result.queues.missingAlt.length, 1);
  assert.deepEqual(result.queues.duplicates, []);
});

check("Media Library Pro API reuses authenticated Axios and exposes no direct token transport", () => {
  assert.match(api, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.match(api, /\/content-studio\/media\/intelligence/);
  assert.match(api, /\/content-studio\/media/);
  assert.doesNotMatch(api, /localStorage|sessionStorage|Bearer|fetch\(/);
});

check("workspace switches the media section to Media Library Pro without changing its permission scope", () => {
  assert.match(workspace, /ContentStudioMediaManager from "\.\/ContentStudioMediaManagerPro"/);
  assert.match(workspace, /media: "media"/);
  assert.match(workspace, /media: ContentStudioMediaManager/);
});

check("Media Library Pro exposes grid table advanced filters and intelligence queues", () => {
  for (const marker of [
    "Grid",
    "Table",
    "Public ready",
    "Needs attention",
    "Unused",
    "Duplicates",
    "Any orientation",
    "Missing alternative text",
    "Largest assets",
    "Duplicate checksums",
    "Exact website usage",
    "Generated image variants",
  ]) assert.match(component, new RegExp(marker));
  assert.match(component, /listMediaPro/);
  assert.match(component, /getMediaLibraryIntelligence/);
  assert.match(component, /usage\.length > 0/);
  assert.match(component, /backend will re-check all references/);
});

check("Media Library Pro preserves governed uploads folders metadata and permission separation", () => {
  for (const marker of [
    "uploadMediaImage",
    "registerMediaVideo",
    "createMediaFolder",
    "updateMediaFolder",
    "archiveMediaFolder",
    "updateMediaAsset",
    "archiveMediaAsset",
    "CONTENT_STUDIO_PERMISSIONS.mediaManage",
  ]) assert.match(component, new RegExp(marker.replace(".", "\\.")));
  assert.match(component, /image\/jpeg,image\/png,image\/webp/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|localStorage|sessionStorage|Bearer/);
});

check("Media Library Pro has responsive desktop tablet phone and reduced-motion layouts", () => {
  assert.match(css, /@media \(max-width:1280px\)/);
  assert.match(css, /@media \(max-width:980px\)/);
  assert.match(css, /@media \(max-width:680px\)/);
  assert.match(css, /@media \(max-width:430px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /scroll-snap-type/);
  assert.match(css, /cs-media-pro-inspector/);
});

check("governed media picker is permission scoped and only offers public publication-ready assets", () => {
  assert.match(picker, /CONTENT_STUDIO_PERMISSIONS\.mediaView/);
  assert.match(picker, /visibility:\s*"public"/);
  assert.match(picker, /readiness:\s*"public_ready"/);
  assert.match(picker, /listMediaPro/);
  assert.match(picker, /AbortController/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(picker, /triggerRef\.current\?\.focus/);
  assert.doesNotMatch(picker, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML/);
  assert.match(pickerCss, /@media\(max-width:680px\)/);
  assert.match(pickerCss, /scroll-snap-type:x mandatory/);
});

check("Projects Equipment Newsroom and Leadership replace raw media-ID authoring with governed picker fields", () => {
  assert.match(governedManager, /ContentStudioMediaPickerField/);
  assert.match(governedManager, /mediaAcceptForLabel/);
  assert.match(portfolioManagers, /Featured media asset ID/);
  assert.match(portfolioManagers, /Media asset ID/);
  assert.match(newsroom, /ContentStudioMediaPickerField/);
  assert.match(newsroom, /Featured image asset ID/);
  assert.match(leadership, /ContentStudioMediaPickerField/);
  assert.match(leadership, /Portrait media asset ID/);
  assert.match(leadership, /Signature media asset ID/);
});

check("advanced Pages Manager routes its primary media field through the governed picker without changing payload semantics", () => {
  assert.match(pageManager, /import ContentStudioMediaPickerField from "\.\/ContentStudioMediaPickerField"/);
  assert.match(pageManager, /\/media asset id\/i/);
  assert.match(pageManager, /<ContentStudioMediaPickerField/);
  assert.match(pageManager, /label="Primary media asset ID"/);
  assert.match(pageManager, /primary_media_asset_id:\s*cleanId\(form\.primary_media_asset_id\)/);
  assert.match(pageManager, /onChange=\{\(value\) => children\.props\.onChange\?\.\(\{ target: \{ value \} \}\)\}/);
  assert.doesNotMatch(pageManager, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML/);
});

check("Media Cleanup is management-only and uses governed atomic bulk endpoints", () => {
  assert.match(studioModel, /key:\s*"media-cleanup"/);
  assert.match(studioModel, /permission:\s*CONTENT_STUDIO_PERMISSIONS\.mediaManage/);
  assert.match(workspace, /ContentStudioMediaCleanupManager/);
  assert.match(workspace, /"media-cleanup":\s*"media"/);
  assert.match(api, /\/content-studio\/media\/bulk\/update/);
  assert.match(api, /\/content-studio\/media\/bulk\/archive/);
  assert.match(cleanup, /MAX_SELECTION = 50/);
  assert.match(cleanup, /selectedUsed\.length/);
  assert.match(cleanup, /selectedNotPublicReady\.length/);
  assert.match(cleanup, /backend will re-check every website reference first/i);
  assert.doesNotMatch(cleanup, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML/);
});

check("Media Cleanup remains responsive and keeps destructive controls explicit", () => {
  assert.match(cleanup, /Apply atomic metadata change/);
  assert.match(cleanup, /Archive selected unused assets/);
  assert.match(cleanup, /window\.confirm/);
  assert.match(cleanupCss, /@media\(max-width:1100px\)/);
  assert.match(cleanupCss, /@media\(max-width:760px\)/);
  assert.match(cleanupCss, /@media\(max-width:480px\)/);
  assert.match(cleanupCss, /prefers-reduced-motion/);
});

check("Visual Builder retains visual media selection instead of exposing section media IDs as ordinary inputs", () => {
  assert.match(visualBuilder, /function MediaPicker/);
  assert.match(visualBuilder, /Choose approved media/);
  assert.match(visualBuilder, /Choose primary media/);
  assert.match(visualBuilder, /Choose background/);
  assert.match(visualBuilder, /visibility:\s*"public"/);
  assert.doesNotMatch(visualBuilder, /label="Primary media asset ID"/);
  assert.doesNotMatch(visualBuilder, /label="Background media asset ID"/);
});

console.log(`\nMedia Library Pro: ${passed}/13 checks passed.`);
