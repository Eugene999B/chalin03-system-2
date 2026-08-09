import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studioRoot = path.join(frontendRoot, "src/chalin-one/content-studio");
const publicRoot = path.join(frontendRoot, "src/chalin-one/public-site");
const functionsRoot = path.join(frontendRoot, "functions");

const studioModel = await import(
  pathToFileURL(path.join(studioRoot, "contentStudioModel.js")).href
);
const redirectRuntime = await import(
  pathToFileURL(path.join(publicRoot, "publicRedirectRuntime.js")).href
);
const edgeRedirect = await import(
  pathToFileURL(path.join(functionsRoot, "[[path]].js")).href
);

const manager = fs.readFileSync(path.join(studioRoot, "ContentStudioRedirectManager.jsx"), "utf8");
const api = fs.readFileSync(path.join(studioRoot, "contentStudioRedirectApi.js"), "utf8");
const css = fs.readFileSync(path.join(studioRoot, "contentStudioRedirectManager.css"), "utf8");
const workspace = fs.readFileSync(path.join(studioRoot, "ContentStudioWorkspace.jsx"), "utf8");
const controlCenter = fs.readFileSync(path.join(studioRoot, "ContentStudioWebsiteControlCenter.jsx"), "utf8");
const publicApi = fs.readFileSync(path.join(publicRoot, "publicWebsiteApi.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(publicRoot, "publicRedirectRuntime.js"), "utf8");
const edgeSource = fs.readFileSync(path.join(functionsRoot, "[[path]].js"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("Redirect Manager stays inside existing Navigation permission and scope", () => {
  const section = studioModel.CONTENT_STUDIO_SECTIONS.find((item) => item.key === "redirects");
  assert.ok(section);
  assert.equal(section.permission, "public_navigation.view");
  assert.equal(section.endpoint, "/content-studio/navigation/redirects");
  assert.equal(section.group, "Website");
  assert.match(workspace, /redirects: "navigation"/);
  assert.match(workspace, /redirects: ContentStudioRedirectManager/);
});

check("Redirect Manager separates editor changes from publisher activation", () => {
  assert.match(manager, /hasPermission\("public_navigation\.manage"\)/);
  assert.match(manager, /hasPermission\("public_content\.publish"\)/);
  assert.match(manager, /Create redirect draft/);
  assert.match(manager, /A Publisher must activate it/);
  assert.match(manager, /activateRedirectRule/);
  assert.match(manager, /deactivateRedirectRule/);
  assert.match(manager, /archiveRedirectRule/);
  assert.doesNotMatch(manager, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML/);
});

check("authenticated redirect API exposes explicit lifecycle actions only", () => {
  assert.match(api, /import axiosClient from "\.\.\/\.\.\/api\/axiosClient"/);
  assert.match(api, /\/content-studio\/navigation\/redirects/);
  assert.match(api, /\/activate/);
  assert.match(api, /\/deactivate/);
  assert.match(api, /\/archive/);
  assert.doesNotMatch(api, /fetch\(|localStorage|sessionStorage|Bearer/);
});

check("browser redirect runtime accepts only relative or safe HTTPS destinations", () => {
  assert.equal(redirectRuntime.safeRuntimeRedirectDestination("/about?from=old"), "/about?from=old");
  assert.equal(redirectRuntime.safeRuntimeRedirectDestination("//evil.example/x"), "");
  assert.equal(redirectRuntime.safeRuntimeRedirectDestination("http://example.com/x"), "");
  assert.equal(redirectRuntime.safeRuntimeRedirectDestination("https://example.com/x"), "https://example.com/x");
  assert.equal(redirectRuntime.safeRuntimeRedirectDestination("javascript:alert(1)"), "");
});

check("browser fallback resolver is queried only after the existing CHALIN ONE 404 renders", () => {
  assert.match(runtimeSource, /querySelector\?\.\("\.c1-not-found"\)/);
  assert.match(runtimeSource, /resolveRenderedNotFound/);
  assert.match(runtimeSource, /window\.location\.replace\(destination\)/);
  assert.match(runtimeSource, /catch \{/);
  assert.doesNotMatch(runtimeSource, /setInterval|window\.location\.reload|location\.reload/);
  assert.match(publicApi, /get\("\/public\/redirects\/resolve"/);
  assert.match(publicApi, /installPublicRedirectRuntime\(resolvePublicRedirect\)/);
});

check("Cloudflare edge middleware emits the exact governed HTTP redirect status safely", () => {
  assert.equal(edgeRedirect.isApprovedStagingHost("chalin-one-staging-preview.pages.dev"), true);
  assert.equal(edgeRedirect.isApprovedStagingHost("chalin03.com"), false);
  assert.equal(edgeRedirect.shouldBypass("/api/public/content/bootstrap", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/assets/index.js", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/login", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/content-studio/login", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/intelligence", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/mining/sites", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/equipment-hire-operations/contracts", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/equipment-installment-finance/applications", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/group-executive-control", "GET"), true);
  assert.equal(edgeRedirect.shouldBypass("/old-company-page", "POST"), true);
  assert.equal(edgeRedirect.shouldBypass("/old-company-page", "GET"), false);
  assert.equal(edgeRedirect.safeRedirectDestination("http://example.com/x"), "");
  assert.equal(edgeRedirect.safeRedirectDestination("https://example.com/x"), "https://example.com/x");

  const response = edgeRedirect.governedRedirectResponse(
    {
      source_path: "/old-company-page",
      destination_url: "/about",
      redirect_status: 308,
    },
    "/old-company-page"
  );
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("Location"), "/about");
  assert.equal(response.headers.get("X-Chalin-One-Redirect"), "governed-edge-v1");
  assert.equal(edgeRedirect.governedRedirectResponse({ source_path: "/login", destination_url: "/about", redirect_status: 301 }, "/login"), null);
  assert.equal(edgeRedirect.governedRedirectResponse({ source_path: "/old-company-page", destination_url: "/about", redirect_status: 305 }, "/old-company-page"), null);
});

check("edge redirect function is staging-only and fails open to Pages assets/routes", () => {
  assert.match(edgeSource, /chalin-one-staging-preview\.pages\.dev/);
  assert.match(edgeSource, /chalin03-system-2-staging\.up\.railway\.app/);
  assert.match(edgeSource, /\/api\/public\/redirects\/resolve/);
  assert.match(edgeSource, /new Set\(\[301, 302, 307, 308\]\)/);
  assert.match(edgeSource, /RESERVED_PLATFORM_PREFIXES/);
  assert.match(edgeSource, /return context\.next\(\)/);
  assert.match(edgeSource, /catch \{/);
  assert.match(edgeSource, /"GET", "HEAD"/);
  assert.doesNotMatch(edgeSource, /https:\/\/chalin03\.com|https:\/\/www\.chalin03\.com|https:\/\/staff\.chalin03\.com/);
});

check("Website Control Center hands advisory candidates to Redirect Manager", () => {
  assert.match(controlCenter, /Open Redirect Manager/);
  assert.match(controlCenter, /Prepare governed redirect/);
  assert.match(controlCenter, /onOpenSection\?\.\("redirects"\)/);
});

check("Redirect Manager is responsive and exposes safety controls", () => {
  for (const marker of [
    "Exact source paths only",
    "HTTPS external destinations",
    "No active-page collisions",
    "No loops or redirect chains",
  ]) assert.match(manager, new RegExp(marker));
  assert.match(css, /@media\(max-width:1080px\)/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

console.log(`\nCHALIN ONE Redirect Manager: ${passed}/9 checks passed.`);
