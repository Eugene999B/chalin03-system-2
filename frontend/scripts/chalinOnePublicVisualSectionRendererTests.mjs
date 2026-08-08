import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");

const renderer = read("src/chalin-one/public-site/PublicVisualSectionRenderer.jsx");
const css = read("src/chalin-one/public-site/publicVisualSections.css");
const app = read("src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx");
const api = read("src/chalin-one/public-site/publicWebsiteApi.js");

for (const resource of ["divisions", "leadership", "projects", "equipment", "news"]) {
  assert.match(renderer, new RegExp(`${resource}: "${resource}"`), `${resource} public collection mapping missing`);
}

for (const semantic of [
  'type === "statistics"',
  'type === "testimonials"',
  'type === "faq"',
  'type === "cta"',
  'type === "contact"',
  'type === "form"',
  'type === "hero"',
  '"image", "video", "gallery"',
  'type === "split"',
]) {
  assert.match(renderer, new RegExp(semantic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `semantic renderer branch missing: ${semantic}`);
}

assert.match(renderer, /<details/);
assert.match(renderer, /c1-vsr-metrics/);
assert.match(renderer, /c1-vsr-testimonials/);
assert.match(renderer, /c1-vsr-collection-rail/);
assert.match(renderer, /c1-vsr-action-band/);
assert.match(renderer, /c1-vsr-form-placement/);
assert.match(renderer, /primary_media/);
assert.match(renderer, /background_media/);
assert.match(renderer, /section\?\.is_enabled !== false/);
assert.match(renderer, /excludeTypes/);

assert.match(renderer, /safePublicVisualActionUrl/);
assert.match(renderer, /raw\.startsWith\("\/"\)/);
assert.match(renderer, /!raw\.startsWith\("\/\/"\)/);
assert.match(renderer, /parsed\.protocol === "https:"/);
assert.match(renderer, /replace\(\/\[\^a-zA-Z0-9_-\]\/g, ""\)/);
assert.match(renderer, /to=\{`\/forms\/\$\{formKey\}`\}/);
assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
assert.doesNotMatch(renderer, /<iframe/i);
assert.doesNotMatch(renderer, /eval\s*\(/);
assert.doesNotMatch(renderer, /new Function/);

assert.match(renderer, /listPublicResource/);
assert.match(renderer, /new AbortController\(\)/);
assert.match(renderer, /controller\.abort\(\)/);
assert.match(renderer, /Promise\.allSettled/);
assert.match(api, /const publicWebsiteClient = axios\.create/);
assert.match(api, /export \{ publicWebsiteClient \}/);
assert.doesNotMatch(api, /Authorization|Bearer|localStorage|sessionStorage/);

assert.match(app, /import PublicVisualSections from "\.\/PublicVisualSectionRenderer"/);
assert.match(app, /<PublicVisualSections sections=\{page\?\.sections \|\| \[\]\} excludeTypes=\{\["hero"\]\}/);
assert.match(app, /seedCollections=\{visualSeedCollections\}/);
assert.match(app, /<PublicVisualSections sections=\{page\?\.sections \|\| \[\]\} seedCollections=/);
assert.match(app, /<PublicVisualSections sections=\{page\.sections \|\| \[\]\} \/>/);
assert.doesNotMatch(app, /c1-governed-sections/);
assert.doesNotMatch(app, /page\.sections\.filter\(\(section\) => section\.type !== "hero"\)\.map/);

assert.match(css, /\.c1-vsr-metrics/);
assert.match(css, /\.c1-vsr-faqs/);
assert.match(css, /\.c1-vsr-testimonials/);
assert.match(css, /\.c1-vsr-collection-rail/);
assert.match(css, /\.c1-vsr-section\.is-hero/);
assert.match(css, /\.c1-vsr-section\.is-cta/);
assert.match(css, /@media \(max-width: 1180px\)/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /scroll-snap-type: x mandatory/);
assert.match(css, /pointer: coarse/);
assert.match(css, /prefers-reduced-motion: reduce/);

console.log("✅ CHALIN ONE public Visual Section Renderer contracts passed: governed section semantics, safe actions, anonymous collection loading, responsive publication layouts and CMS-to-public integration remain protected.");
