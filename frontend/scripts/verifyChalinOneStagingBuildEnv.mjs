import assert from "node:assert/strict";

function clean(value) {
  return String(value || "").trim();
}

const apiUrl = clean(process.env.VITE_API_URL);
assert.ok(apiUrl, "VITE_API_URL is required for CHALIN ONE staging builds.");

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

const branch = clean(process.env.CF_PAGES_BRANCH || process.env.CHAlIN_ONE_STAGING_BRANCH || "chalin-one");
assert.equal(
  branch.toLowerCase(),
  "chalin-one",
  "The dedicated CHALIN ONE staging Pages project must build the chalin-one branch."
);

console.log(`CHALIN ONE Cloudflare staging build verified for ${parsed.origin}.`);
