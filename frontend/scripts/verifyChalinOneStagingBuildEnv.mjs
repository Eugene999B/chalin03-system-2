import assert from "node:assert/strict";

const DEFAULT_STAGING_API_URL =
  "https://chalin03-system-2-staging.up.railway.app/api";

function clean(value) {
  return String(value || "").trim();
}

// The browser runtime also pins known CHALIN ONE staging hostnames to the
// isolated Railway staging API. Keep VITE_API_URL as an override/check when
// Cloudflare provides it, but do not make a safe staging build depend on the
// project dashboard injecting that variable correctly.
const apiUrl = clean(process.env.VITE_API_URL) || DEFAULT_STAGING_API_URL;

const parsed = new URL(apiUrl);
assert.equal(parsed.protocol, "https:", "Staging VITE_API_URL must use HTTPS.");
assert.ok(
  !["api.chalin03.com", "chalin03.com", "www.chalin03.com", "staff.chalin03.com"].includes(
    parsed.hostname.toLowerCase()
  ),
  "CHALIN ONE staging must never build against a production Chalin 03 host."
);
assert.ok(
  /staging|preview|railway\.app/i.test(parsed.hostname),
  "Staging API hostname must clearly identify a staging/preview host or Railway preview domain."
);

const branch = clean(
  process.env.CF_PAGES_BRANCH ||
    process.env.CHALIN_ONE_STAGING_BRANCH ||
    "chalin-one"
);
assert.equal(
  branch.toLowerCase(),
  "chalin-one",
  "The dedicated CHALIN ONE staging Pages project must build the chalin-one branch."
);

console.log(`CHALIN ONE Cloudflare staging build verified for ${parsed.origin}.`);
