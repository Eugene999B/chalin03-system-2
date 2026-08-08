import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const editorial = read("src/chalin-one/public-site/PublicEditorialFinish.jsx");
const editorialCss = read("src/chalin-one/public-site/publicEditorialFinish.css");
const technical = read("src/chalin-one/public-site/PublicTechnicalFinish.jsx");
const technicalCss = read("src/chalin-one/public-site/publicTechnicalFinish.css");
const standalone = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");

for (const marker of [
  "EDITORIAL_TYPES",
  "editorialContext",
  "readingMinutes",
  "safeMediaUrl",
  "imageEntries",
  "factPairs",
  "useEditorialTargets",
  "StoryDossier",
  "EditorialGallery",
]) {
  assert.match(editorial, new RegExp(marker));
}
assert.match(editorial, /news: \{/);
assert.match(editorial, /projects: \{/);
assert.match(editorial, /getPublicResource/);
assert.match(editorial, /item\?\.division\?\.name/);
assert.match(editorial, /item\?\.category\?\.name/);
assert.match(editorial, /item\?\.published_at/);
assert.match(editorial, /item\?\.status/);
assert.match(editorial, /locationText/);
assert.match(editorial, /navigator\.share/);
assert.match(editorial, /navigator\.clipboard\.writeText/);
assert.match(editorial, /window\.print\(\)/);
assert.match(editorial, /ArrowRight/);
assert.match(editorial, /ArrowLeft/);
assert.match(editorial, /Escape/);
assert.match(editorial, /media\.media_type !== "image"/);
assert.match(editorial, /\["http:", "https:"\]/);
assert.doesNotMatch(editorial, /dangerouslySetInnerHTML|eval\(|localStorage|sessionStorage|Bearer|Authorization/);

assert.match(editorialCss, /data-c1-legacy-editorial-gallery/);
assert.match(editorialCss, /\.c1-story-dossier/);
assert.match(editorialCss, /\.c1-editorial-gallery-grid/);
assert.match(editorialCss, /\.c1-editorial-lightbox/);
assert.match(editorialCss, /@media \(max-width: 760px\)/);
assert.match(editorialCss, /safe-area-inset-bottom/);
assert.match(editorialCss, /@media print/);
assert.match(editorialCss, /prefers-reduced-motion/);

for (const marker of [
  "RECOVERY_PATHS",
  "isStagingHost",
  "syncTechnicalMetadata",
  "currentSocialImage",
  "useRecoveryTarget",
  "RecoveryPanel",
]) {
  assert.match(technical, new RegExp(marker));
}
assert.match(technical, /\.pages\.dev/);
assert.match(technical, /\.up\.railway\.app/);
assert.match(technical, /noindex,nofollow,noarchive/);
assert.match(technical, /index,follow,max-image-preview:large/);
assert.match(technical, /og:site_name/);
assert.match(technical, /twitter:url/);
assert.match(technical, /og:image/);
assert.match(technical, /application\/ld\+json/);
assert.match(technical, /"@type": "Organization"/);
assert.match(technical, /"@type": "WebSite"/);
assert.match(technical, /Chalin 03 Company Limited/);
assert.match(technical, /CHALIN ONE/);
assert.doesNotMatch(technical, /streetAddress|postalCode|telephone|sameAs|foundingDate/);
assert.match(technical, /main\.setAttribute\("tabindex", "-1"\)/);
assert.match(technical, /main\.focus\(\{ preventScroll: true \}\)/);
assert.match(technical, /press <kbd>\/</);
assert.doesNotMatch(technical, /localStorage|sessionStorage|Bearer|Authorization/);

assert.match(technicalCss, /\.c1-recovery-panel/);
assert.match(technicalCss, /\.c1-state\.c1-state-error/);
assert.match(technicalCss, /:focus-visible/);
assert.match(technicalCss, /@media \(max-width: 760px\)/);
assert.match(technicalCss, /@media \(max-width: 390px\)/);
assert.match(technicalCss, /prefers-reduced-motion/);

for (const marker of [
  "PublicEditorialFinish",
  "PublicTechnicalFinish",
  "<PublicEditorialFinish />",
  "<PublicTechnicalFinish />",
]) {
  assert.match(standalone, new RegExp(marker.replace(/[<>/]/g, (value) => `\\${value}`)));
}
const publicEntryIndex = standalone.indexOf("function PublicWebsiteEntry");
const staffShellIndex = standalone.indexOf("function StaffStandaloneShell");
const editorialMountIndex = standalone.indexOf("<PublicEditorialFinish />");
const technicalMountIndex = standalone.indexOf("<PublicTechnicalFinish />");
assert.ok(publicEntryIndex >= 0 && editorialMountIndex > publicEntryIndex && editorialMountIndex < staffShellIndex);
assert.ok(publicEntryIndex >= 0 && technicalMountIndex > publicEntryIndex && technicalMountIndex < staffShellIndex);

console.log(
  "✅ CHALIN ONE final Phase 1C contracts passed: governed editorial reading, approved-image galleries, staging no-index protection, structured data, route focus and 404 recovery remain public-only and protected."
);
