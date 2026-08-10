import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(frontendRoot, "src/chalin-one/public-site");
const runtimePath = path.join(publicRoot, "publicMetadataRuntime.js");
const runtime = await import(pathToFileURL(runtimePath).href);
const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const apiSource = fs.readFileSync(path.join(publicRoot, "publicWebsiteApi.js"), "utf8");
const indexSource = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("metadata URLs fail closed to HTTPS values without credentials or fragments", () => {
  assert.equal(runtime.safeHttpsMetadataUrl("http://example.com/about"), "");
  assert.equal(runtime.safeHttpsMetadataUrl("javascript:alert(1)"), "");
  assert.equal(runtime.safeHttpsMetadataUrl("https://user:pass@example.com/about"), "");
  assert.equal(runtime.safeHttpsMetadataUrl("https://example.com/about#team"), "https://example.com/about");
});

check("production metadata uses governed canonical robots social image and article type", () => {
  const snapshot = runtime.buildPublicMetadataSnapshot(
    {
      title: "Project Alpha",
      description: "Published project summary",
      canonicalUrl: "https://chalin03.com/projects/project-alpha",
      robots: "index,follow,max-image-preview:large",
      imageUrl: "https://media.chalin03.com/project.webp",
      imageAlt: "Project Alpha site",
      type: "article",
    },
    {
      origin: "https://chalin03.com",
      pathname: "/projects/project-alpha",
      baselineRobots: "index,follow",
    }
  );
  assert.equal(snapshot.canonicalUrl, "https://chalin03.com/projects/project-alpha");
  assert.equal(snapshot.robots, "index,follow,max-image-preview:large");
  assert.equal(snapshot.imageUrl, "https://media.chalin03.com/project.webp");
  assert.equal(snapshot.type, "article");
  assert.equal(snapshot.robotsLocked, false);
});

check("unsafe governed canonical and image values fall back safely instead of being rendered", () => {
  const snapshot = runtime.buildPublicMetadataSnapshot(
    {
      title: "About",
      canonicalUrl: "http://unsafe.example/about",
      imageUrl: "data:image/svg+xml,bad",
    },
    {
      origin: "https://chalin03.com",
      pathname: "/about",
      baselineRobots: "index,follow",
    }
  );
  assert.equal(snapshot.canonicalUrl, "https://chalin03.com/about");
  assert.equal(snapshot.imageUrl, "");
});

check("staging noindex baseline is a hard robots lock", () => {
  const snapshot = runtime.buildPublicMetadataSnapshot(
    {
      title: "About",
      robots: "index,follow",
    },
    {
      origin: "https://chalin-one-staging-preview.pages.dev",
      pathname: "/about",
      baselineRobots: "noindex, nofollow, noarchive",
    }
  );
  assert.equal(snapshot.robotsLocked, true);
  assert.equal(snapshot.robots, "noindex,nofollow,noarchive");
  assert.equal(runtime.isNoIndexDirective(snapshot.robots), true);
});

check("runtime creates canonical robots Open Graph and Twitter metadata without unsafe HTML APIs", () => {
  for (const marker of [
    'link[rel="canonical"]',
    'meta[name="robots"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:card"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image"]',
    "MutationObserver",
    'wrapHistory("pushState")',
    'wrapHistory("replaceState")',
  ]) assert.match(runtimeSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(runtimeSource, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|localStorage|sessionStorage/);
});

check("published detail APIs use combined route SEO enrichment while list feeds remain metadata-neutral", () => {
  assert.match(apiSource, /function applyPublishedRouteSeo\(data, options = \{\}\)/);
  assert.match(apiSource, /applyPublishedPublicMetadata\(data, options\)/);
  assert.match(apiSource, /applyPublishedPublicStructuredData\(data, options\)/);
  assert.match(apiSource, /getPublicHomepage[\s\S]*applyPublishedRouteSeo\(page\)/);
  assert.match(apiSource, /getPublicPage[\s\S]*applyPublishedRouteSeo\(page\)/);
  assert.match(apiSource, /getPublicResource[\s\S]*applyPublishedRouteSeo\(item/);
  assert.match(apiSource, /getPublicForm[\s\S]*applyPublishedPublicMetadata\(form\)/);
  const listBlock = apiSource.match(/export async function listPublicResource[\s\S]*?export async function getPublicResource/)?.[0] || "";
  assert.ok(listBlock);
  assert.doesNotMatch(listBlock, /applyPublishedRouteSeo|applyPublishedPublicMetadata|applyPublishedPublicStructuredData/);
});

check("staging HTML baseline remains noindex while default social metadata stays available before hydration", () => {
  assert.match(indexSource, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(indexSource, /property="og:title"/);
  assert.match(indexSource, /name="twitter:card" content="summary_large_image"/);
});

console.log(`\nPublic metadata renderer: ${passed}/7 checks passed.`);
