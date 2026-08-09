import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edgePath = path.join(frontendRoot, "functions/[[path]].js");
const routesPath = path.join(frontendRoot, "public/_routes.json");
const edge = await import(pathToFileURL(edgePath).href);
const edgeSource = fs.readFileSync(edgePath, "utf8");
const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));

let passed = 0;
async function check(name, callback) {
  await callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

await check("staging robots.txt is a hard crawl and indexing lock", async () => {
  const response = edge.stagingRobotsResponse("GET");
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/plain/);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Disallow: \//);
  assert.doesNotMatch(body, /Sitemap:/i);

  const head = edge.stagingRobotsResponse("HEAD");
  assert.equal(await head.text(), "");
});

await check("sitemap XML escapes output, drops unsafe paths and uses staging origin", async () => {
  assert.equal(edge.escapeXml("A&B<>'\""), "A&amp;B&lt;&gt;&apos;&quot;");
  assert.equal(edge.safeSitemapPath("//evil.example/x"), "");
  assert.equal(edge.safeSitemapPath("/news/update?x=1"), "");
  assert.equal(edge.safeSitemapPath("/news/update#top"), "");
  assert.equal(edge.safeSitemapPath("/news/update/"), "/news/update");

  const xml = edge.buildSitemapXml(
    [
      { path: "/about", last_modified: null },
      { path: "/news/company-update", last_modified: "2026-08-09T12:00:00Z" },
      { path: "/news/company-update", last_modified: "2026-08-08T12:00:00Z" },
      { path: "//evil.example/steal", last_modified: null },
    ],
    "https://chalin-one-staging-preview.pages.dev"
  );
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /https:\/\/chalin-one-staging-preview\.pages\.dev\/about/);
  assert.match(xml, /https:\/\/chalin-one-staging-preview\.pages\.dev\/news\/company-update/);
  assert.match(xml, /<lastmod>2026-08-09T12:00:00\.000Z<\/lastmod>/);
  assert.equal((xml.match(/company-update/g) || []).length, 1);
  assert.doesNotMatch(xml, /evil\.example/);
});

await check("sitemap response is XML and remains noindex in staging", async () => {
  const xml = edge.buildSitemapXml(
    [{ path: "/", last_modified: null }],
    "https://chalin-one-staging-preview.pages.dev"
  );
  const response = edge.stagingSitemapResponse(xml, "GET");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/xml/);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.match(await response.text(), /<urlset/);

  const unavailable = edge.stagingSitemapResponse("", "GET");
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.headers.get("Content-Type"), /text\/plain/);
});

await check("technical SEO edge paths are handled before generic txt/xml bypass", async () => {
  assert.equal(edge.TECHNICAL_SEO_PATHS.has("/robots.txt"), true);
  assert.equal(edge.TECHNICAL_SEO_PATHS.has("/sitemap.xml"), true);
  assert.equal(edge.shouldBypass("/robots.txt", "GET"), true);
  assert.equal(edge.shouldBypass("/sitemap.xml", "GET"), true);
  assert.match(edgeSource, /if \(TECHNICAL_SEO_PATHS\.has\(incoming\.pathname\)\)[\s\S]*if \(shouldBypass\(incoming\.pathname, context\.request\.method\)\)/);
  assert.match(edgeSource, /handleTechnicalSeoRequest/);
});

await check("edge inventory stays staging-only and uses the read-only backend endpoint", async () => {
  assert.equal(edge.SEO_INVENTORY_PATH, "/api/public/redirects/seo/inventory");
  assert.equal(
    edge.seoInventoryUrl(),
    "https://chalin03-system-2-staging.up.railway.app/api/public/redirects/seo/inventory"
  );
  assert.equal(edge.isApprovedStagingHost("chalin-one-staging-preview.pages.dev"), true);
  assert.equal(edge.isApprovedStagingHost("chalin03.com"), false);
  assert.doesNotMatch(edgeSource, /https:\/\/chalin03\.com|https:\/\/www\.chalin03\.com|https:\/\/staff\.chalin03\.com/);
});

await check("Pages routes keep sitemap and robots inside Functions while static assets are excluded", async () => {
  assert.deepEqual(routes.include, ["/*"]);
  assert.equal(routes.exclude.includes("/robots.txt"), false);
  assert.equal(routes.exclude.includes("/sitemap.xml"), false);
  assert.equal(routes.exclude.includes("/assets/*"), true);
});

await check("redirect edge protections remain intact beside technical SEO delivery", async () => {
  assert.match(edgeSource, /governedRedirectResponse/);
  assert.match(edgeSource, /REDIRECT_STATUS_CODES/);
  assert.match(edgeSource, /RESERVED_PLATFORM_PREFIXES/);
  assert.match(edgeSource, /return context\.next\(\)/);
  assert.doesNotMatch(edgeSource, /window\.location\.reload|location\.reload|setInterval/);
});

console.log(`\nCHALIN ONE Technical SEO Delivery: ${passed}/7 checks passed.`);
