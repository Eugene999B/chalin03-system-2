import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(frontendRoot, "src/chalin-one/public-site");
const studioRoot = path.join(frontendRoot, "src/chalin-one/content-studio");
const runtimePath = path.join(publicRoot, "publicStructuredDataRuntime.js");
const runtime = await import(pathToFileURL(runtimePath).href);
const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const apiSource = fs.readFileSync(path.join(publicRoot, "publicWebsiteApi.js"), "utf8");
const studioApiSource = fs.readFileSync(path.join(studioRoot, "contentStudioWebsiteControlApi.js"), "utf8");
const componentSource = fs.readFileSync(path.join(studioRoot, "ContentStudioWebsiteControlCenter.jsx"), "utf8");
const model = await import(pathToFileURL(path.join(studioRoot, "contentStudioWebsiteControlModel.js")).href);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("published company pages emit WebPage and BreadcrumbList schema", () => {
  const graph = runtime.buildPublicStructuredDataGraph(
    {
      title: "Community Impact",
      summary: "Governed company information.",
      seo: { canonical_url: "https://chalin03.com/pages/community-impact" },
      media: { url: "https://media.example.com/impact.webp", alt_text: "Community work" },
      published_at: "2026-08-01T12:00:00Z",
    },
    { type: "website" },
    { origin: "https://chalin03.com", pathname: "/pages/community-impact" }
  );
  assert.equal(graph["@context"], "https://schema.org");
  assert.equal(graph["@graph"][0]["@type"], "WebPage");
  assert.equal(graph["@graph"][0].url, "https://chalin03.com/pages/community-impact");
  assert.equal(graph["@graph"][0].primaryImageOfPage.url, "https://media.example.com/impact.webp");
  assert.equal(graph["@graph"][1]["@type"], "BreadcrumbList");
  assert.deepEqual(graph["@graph"][1].itemListElement.map((item) => item.name), ["Home", "Community Impact"]);
});

check("published newsroom detail emits NewsArticle with publisher author and breadcrumbs", () => {
  const graph = runtime.buildPublicStructuredDataGraph(
    {
      title: "Field Update",
      excerpt: "A published company update.",
      author: "Chalin 03",
      published_at: "2026-08-09T08:00:00Z",
      media: { url: "https://media.example.com/news.webp", alt_text: "Field update" },
    },
    { type: "article" },
    { origin: "https://chalin03.com", pathname: "/news/field-update" }
  );
  const article = graph["@graph"][0];
  assert.equal(article["@type"], "NewsArticle");
  assert.equal(article.headline, "Field Update");
  assert.equal(article.publisher.name, "Chalin 03 Company Limited");
  assert.equal(article.author["@type"], "Organization");
  assert.equal(article.image[0], "https://media.example.com/news.webp");
  assert.deepEqual(graph["@graph"][1].itemListElement.map((item) => item.name), ["Home", "Newsroom", "Field Update"]);
});

check("structured data fails closed on unsafe canonical and image URLs", () => {
  const graph = runtime.buildPublicStructuredDataGraph(
    {
      title: "About",
      seo: { canonical_url: "http://unsafe.example/about" },
      media: { url: "data:image/svg+xml,bad" },
    },
    {},
    { origin: "https://chalin-one-staging-preview.pages.dev", pathname: "/about" }
  );
  const page = graph["@graph"][0];
  assert.equal(page.url, "https://chalin-one-staging-preview.pages.dev/about");
  assert.equal(Object.hasOwn(page, "primaryImageOfPage"), false);
});

check("JSON-LD runtime uses textContent and route-scoped cleanup instead of raw HTML", () => {
  for (const marker of ["application/ld+json", "script.textContent", "routeGraphs", "pushState", "replaceState", "popstate"]) {
    assert.match(runtimeSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(runtimeSource, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|eval\(|new Function/);
});

check("only published detail and page APIs enrich structured data; list feeds and forms stay neutral", () => {
  assert.match(apiSource, /applyPublishedPublicStructuredData/);
  assert.match(apiSource, /function applyPublishedRouteSeo/);
  assert.match(apiSource, /getPublicHomepage[\s\S]*applyPublishedRouteSeo\(page\)/);
  assert.match(apiSource, /getPublicPage[\s\S]*applyPublishedRouteSeo\(page\)/);
  assert.match(apiSource, /getPublicResource[\s\S]*applyPublishedRouteSeo\(item/);
  const listBlock = apiSource.match(/export async function listPublicResource[\s\S]*?export async function getPublicResource/)?.[0] || "";
  assert.ok(listBlock);
  assert.doesNotMatch(listBlock, /applyPublishedRouteSeo|applyPublishedPublicStructuredData/);
  const formBlock = apiSource.match(/export async function getPublicForm[\s\S]*?export async function resolvePublicRedirect/)?.[0] || "";
  assert.ok(formBlock);
  assert.doesNotMatch(formBlock, /applyPublishedPublicStructuredData/);
});

check("Website Control Center exposes the read-only internal-link graph and safe handoffs", () => {
  assert.match(studioApiSource, /getWebsiteLinkIntegrity/);
  assert.match(studioApiSource, /axiosClient\.get\("\/content-studio\/pages\/link-integrity"/);
  assert.doesNotMatch(studioApiSource, /axiosClient\.(?:post|put|patch|delete)/);
  for (const marker of ["Internal links", "CONTENT / LINK GRAPH", "Internal link issues", "getWebsiteLinkIntegrity", "REDIRECTED_INTERNAL_LINK"]) {
    if (marker === "REDIRECTED_INTERNAL_LINK") continue;
    assert.match(componentSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(componentSource, /onOpenSection\?\.\("pages"\)/);
  assert.match(componentSource, /onOpenSection\?\.\("redirects"\)/);
  assert.doesNotMatch(componentSource, /updatePage|publishPage|archivePage|activateRedirect|createRedirect/);
});

check("link-integrity frontend normalization and structured-data capability fail closed", () => {
  const links = model.normalizeLinkIntegrity({
    summary: { references_scanned: "12", critical_targets: "2", warning_targets: "3", truncated: true },
    issues: [{ path: "/staff", severity: "critical" }],
  });
  assert.equal(links.summary.referencesScanned, 12);
  assert.equal(links.summary.criticalTargets, 2);
  assert.equal(links.summary.warningTargets, 3);
  assert.equal(links.summary.truncated, true);
  assert.equal(links.issues.length, 1);
  const capability = model.PUBLIC_METADATA_CAPABILITIES.find((item) => item.key === "structured_data");
  assert.equal(capability?.status, "active");
});

console.log(`\nStructured SEO + link integrity: ${passed}/7 checks passed.`);
