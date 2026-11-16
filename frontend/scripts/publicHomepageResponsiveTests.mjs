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
assert.match(page, /images\.unsplash\.com\/photo-/);
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
assert.match(headers, /img-src[^;]*https:\/\/images\.unsplash\.com/);

console.log("CHALIN03 public homepage: responsive copy, photos, links and menu source checks passed.");
