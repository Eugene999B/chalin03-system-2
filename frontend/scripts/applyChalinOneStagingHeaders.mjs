import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function clean(value) {
  return String(value || "").trim();
}

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const branch = clean(
  process.env.CF_PAGES_BRANCH || process.env.CHALIN_ONE_STAGING_BRANCH
).toLowerCase();
const apiUrl = clean(process.env.VITE_API_URL);

function applyStagingCspRewrite() {
  if (branch !== "chalin-one" || !apiUrl) {
    console.log("CHALIN ONE staging CSP rewrite skipped for this build.");
    return;
  }

  const parsed = new URL(apiUrl);
  const productionHosts = new Set([
    "api.chalin03.com",
    "chalin03.com",
    "www.chalin03.com",
    "staff.chalin03.com",
  ]);

  assert.equal(parsed.protocol, "https:", "Staging CSP API origin must use HTTPS.");
  assert.ok(
    !productionHosts.has(parsed.hostname.toLowerCase()),
    "CHALIN ONE staging CSP must never allow a production Chalin 03 host as its API origin."
  );
  assert.ok(
    /staging|preview|railway\.app/i.test(parsed.hostname),
    "CHALIN ONE staging CSP API hostname must clearly identify staging/preview infrastructure."
  );

  const headersPath = path.resolve(frontendRoot, "dist", "_headers");
  assert.ok(
    fs.existsSync(headersPath),
    "The built dist/_headers file is required before applying CHALIN ONE staging CSP."
  );

  const productionApiOrigin = "https://api.chalin03.com";
  const stagingApiOrigin = parsed.origin;
  const original = fs.readFileSync(headersPath, "utf8");

  const connectTarget =
    `connect-src 'self' ${stagingApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`;
  const connectBaselines = [
    `connect-src 'self' ${productionApiOrigin} ${stagingApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`,
    `connect-src 'self' ${productionApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`,
    connectTarget,
  ];
  const matchedConnectBaseline = connectBaselines.find((candidate) =>
    original.includes(candidate)
  );

  assert.ok(
    matchedConnectBaseline,
    "Expected CHALIN ONE connect-src baseline was not found in dist/_headers."
  );
  assert.ok(
    original.includes(`img-src 'self' data: blob: ${productionApiOrigin};`) ||
      original.includes(`img-src 'self' data: blob: ${stagingApiOrigin};`),
    "Expected CHALIN ONE img-src baseline was not found in dist/_headers."
  );

  let rewritten = original.replace(matchedConnectBaseline, connectTarget);
  rewritten = rewritten.replace(
    `img-src 'self' data: blob: ${productionApiOrigin};`,
    `img-src 'self' data: blob: ${stagingApiOrigin};`
  );

  assert.ok(
    rewritten.includes(`connect-src 'self' ${stagingApiOrigin}`),
    "Staging API origin was not added to connect-src."
  );
  assert.ok(
    rewritten.includes(`img-src 'self' data: blob: ${stagingApiOrigin};`),
    "Staging API origin was not added to img-src."
  );
  assert.ok(
    !rewritten.includes(productionApiOrigin),
    "Production API origin must not remain in the CHALIN ONE staging CSP output."
  );

  fs.writeFileSync(headersPath, rewritten, "utf8");
  console.log(`CHALIN ONE staging CSP now allows ${stagingApiOrigin}.`);
}

function runPostbuildGate(scriptName) {
  const result = spawnSync(process.execPath, [path.join(here, scriptName)], {
    cwd: frontendRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `CHALIN ONE postbuild gate failed: ${scriptName}`
  );
}

applyStagingCspRewrite();

// These gates intentionally run for every production build, including CI and
// Cloudflare staging. The source contract runs first; the byte-budget verifier
// then consumes Vite's temporary manifest and removes it before deployment.
runPostbuildGate("chalinOnePublicPerformanceReadinessTests.mjs");
runPostbuildGate("verifyChalinOnePerformanceBudgets.mjs");
