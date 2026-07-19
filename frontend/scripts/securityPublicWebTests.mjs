import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const appIndex = read("index.html");
const headers = read("public/_headers");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const companyPage = read("public/company/index.html");
const portalShell = read("src/components/BusinessPortalShell.jsx");
const publicMeta = read("src/components/PublicPageMeta.jsx");

assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /frame-ancestors 'none'/);
assert.match(headers, /X-Frame-Options: DENY/);
assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive/);
assert.match(headers, /\/company\/\*/);
assert.match(headers, /index, follow, max-image-preview:large/);
assert.match(headers, /chalin03-system-2\.pages\.dev/);
assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
assert.match(headers, /\/favicon\.ico/);
assert.match(headers, /\/favicon-192x192\.png/);
assert.match(headers, /\/favicon-512x512\.png/);
assert.match(headers, /max-age=86400, must-revalidate/);

assert.match(appIndex, /<link rel="icon" href="\/favicon\.ico" sizes="any"/);
assert.match(
  appIndex,
  /<link\s+rel="icon"\s+type="image\/png"\s+sizes="192x192"\s+href="\/favicon-192x192\.png"/s
);
assert.match(
  appIndex,
  /<link\s+rel="icon"\s+type="image\/png"\s+sizes="512x512"\s+href="\/favicon-512x512\.png"/s
);
assert.match(appIndex, /rel="apple-touch-icon"/);
assert.match(appIndex, /rel="shortcut icon" href="\/favicon\.ico"/);
assert.match(appIndex, /"logo": "https:\/\/chalin03\.com\/favicon-512x512\.png"/);

assert.equal(fs.existsSync(path.join(frontendRoot, "public/favicon.ico")), true);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/favicon-192x192.png")),
  true
);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/favicon-512x512.png")),
  true
);

assert.match(robots, /Allow: \/company\//);
assert.match(robots, /Allow: \/mining-operations/);
assert.match(robots, /Allow: \/equipment-hire/);
assert.match(robots, /Disallow: \/login/);
assert.match(robots, /Disallow: \/mining\//);
assert.match(robots, /Sitemap: https:\/\/chalin03\.com\/sitemap\.xml/);

assert.match(sitemap, /https:\/\/chalin03\.com\/company\//);
assert.match(sitemap, /https:\/\/chalin03\.com\/mining-operations/);
assert.match(sitemap, /https:\/\/chalin03\.com\/equipment-hire/);
assert.doesNotMatch(sitemap, /www\.chalin03\.com/);

assert.match(companyPage, /<link rel="canonical" href="https:\/\/chalin03\.com\/company\/"/);
assert.match(companyPage, /<link rel="icon" href="\/chalin03-logo\.png"/);
assert.match(companyPage, /"@type": "Organization"/);
assert.match(companyPage, /Chalin 03 Company Limited/);
assert.match(companyPage, /Dunkwa Police Barrier, Ghana/);
assert.match(companyPage, /\+233 24 946 9080/);
assert.match(companyPage, /href="\/login"/);

assert.match(portalShell, /PublicPageMeta/);
assert.match(portalShell, /Chalin 03 business division/);
assert.match(portalShell, /This public page contains company information only/);
assert.doesNotMatch(portalShell, /Operational MVP/);
assert.doesNotMatch(portalShell, /New Chalin 03 business module/);

assert.match(publicMeta, /index, follow, max-image-preview:large/);
assert.match(publicMeta, /noindex, nofollow, noarchive/);
assert.match(publicMeta, /link\[rel="canonical"\]/);

console.log(
  "Release 3F-E public web, favicon and Cloudflare security checks passed."
);
