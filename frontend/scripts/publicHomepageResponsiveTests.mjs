import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = fs.readFileSync(path.join(root, "src/pages/PublicCompanyHomePage.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles/publicCompanyHome.css"), "utf8");
const headers = fs.readFileSync(path.join(root, "public/_headers"), "utf8");

assert.match(page, /PublicPageMeta/);
assert.match(page, /canonicalPath="\/"/);
assert.match(page, /className="ch-home__hero"/);
assert.match(page, /\/images\/home\/v1\/hero-desktop\.webp/);
assert.match(page, /\/images\/home\/v1\/hero-mobile\.webp/);
assert.match(page, /<source media="\(max-width: 760px\)" srcSet=\{PHOTO\.heroMobile\}/);
assert.doesNotMatch(page, /https:\/\/images\.unsplash\.com/);
const photoFiles = [
  "hero-desktop.webp", "hero-mobile.webp",
  "excavators.webp", "parts.webp", "hire.webp",
];
let totalImageBytes = 0;
for (const file of photoFiles) {
  const filePath = path.join(root, "public/images/home/v1", file);
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length > 8000 && bytes.length < 250000, file + " must be an optimized local image");
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", file + " must have WebP RIFF header");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP", file + " must be a real WebP image");
  totalImageBytes += bytes.length;
}
assert.ok(totalImageBytes < 700000, "Combined images must remain under 700 KB");
assert.match(page, /loading="lazy"/);
assert.match(page, /fetchPriority="high"/);
assert.match(page, /aria-expanded=\{menuOpen\}/);
assert.match(page, /aria-controls="ch-home-menu"/);
assert.match(page, /menuOpen \? " is-open" : ""/);
assert.match(page, /onClick=\{closeMenu\}/);
for (const target of ["excavators", "spare-parts", "hire", "contact"]) {
  assert.ok(page.includes('id="' + target + '"') || page.includes('id: "' + target + '"'));
  assert.ok(page.includes('href="#' + target + '"'));
}
assert.match(page, /href="\/login"/);
assert.match(page, /tel:\s*"?\s*\+\s*PHONE|tel:" \+ PHONE/);
assert.match(page, /https:\/\/wa\.me\/233249469080/);
assert.doesNotMatch(page, /href="\/mining-operations"|href="\/equipment-hire"/);
assert.doesNotMatch(page, /GHS \d[\d,.]+/);
assert.match(page, /Photography is illustrative/);

for (const breakpoint of ["1100px", "900px", "760px", "600px"]) {
  assert.ok(css.includes("max-width: " + breakpoint), "Missing breakpoint " + breakpoint);
}
assert.match(css, /\.ch-home__service-grid\s*\{\s*display: grid/);
assert.match(css, /\.ch-home__nav\.is-open\s*\{\s*display: flex/);
assert.match(css, /@media\s*\(prefers-reduced-motion: reduce\)/);
assert.match(css, /focus-visible/);
assert.match(css, /min-height:\s*48px/);
assert.match(headers, /img-src 'self' data: blob: https:\/\/api\.chalin03\.com;/);
assert.doesNotMatch(headers, /images\.unsplash\.com/);
assert.match(headers, /\/images\/home\/v1\/\*\s+Cache-Control: public, max-age=31536000, immutable/);

console.log("CHALIN03 public homepage: responsive copy, photos, links and menu source checks passed.");
