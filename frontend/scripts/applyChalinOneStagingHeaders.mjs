import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function clean(value) {
  return String(value || "").trim();
}

const branch = clean(
  process.env.CF_PAGES_BRANCH || process.env.CHALIN_ONE_STAGING_BRANCH
).toLowerCase();
const apiUrl = clean(process.env.VITE_API_URL);

if (branch !== "chalin-one" || !apiUrl) {
  console.log("CHALIN ONE staging CSP rewrite skipped for this build.");
  process.exit(0);
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

const here = path.dirname(fileURLToPath(import.meta.url));
const headersPath = path.resolve(here, "..", "dist", "_headers");
assert.ok(
  fs.existsSync(headersPath),
  "The built dist/_headers file is required before applying CHALIN ONE staging CSP."
);

const productionApiOrigin = "https://api.chalin03.com";
const stagingApiOrigin = parsed.origin;
const original = fs.readFileSync(headersPath, "utf8");

assert.ok(
  original.includes(
    `connect-src 'self' ${productionApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`
  ),
  "Expected production connect-src baseline was not found in dist/_headers."
);
assert.ok(
  original.includes(`img-src 'self' data: blob: ${productionApiOrigin};`),
  "Expected production img-src baseline was not found in dist/_headers."
);

const rewritten = original
  .replace(
    `connect-src 'self' ${productionApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`,
    `connect-src 'self' ${stagingApiOrigin} https://cloudflareinsights.com https://static.cloudflareinsights.com`
  )
  .replace(
    `img-src 'self' data: blob: ${productionApiOrigin};`,
    `img-src 'self' data: blob: ${stagingApiOrigin};`
  );

assert.notEqual(rewritten, original, "CHALIN ONE staging CSP rewrite made no changes.");
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
