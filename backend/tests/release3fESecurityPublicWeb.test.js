const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ORIGIN_SECRET_HEADER,
  getTrustedApiHosts,
  isTrustedApiHost,
  normalizeHost,
  safeSecretEquals,
} = require("../middleware/securityMiddleware");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("trusted API host normalization accepts the official API domain", () => {
  assert.equal(normalizeHost("api.chalin03.com:443"), "api.chalin03.com");
  assert.equal(normalizeHost("https://api.chalin03.com/path"), "api.chalin03.com");
  assert.equal(isTrustedApiHost("api.chalin03.com"), true);
  assert.equal(getTrustedApiHosts().has("api.chalin03.com"), true);
});

test("Railway default domains are not trusted by default", () => {
  assert.equal(
    isTrustedApiHost("distinguished-compassion-production.up.railway.app"),
    false
  );
});

test("origin secret comparison is timing-safe and rejects altered values", () => {
  assert.equal(ORIGIN_SECRET_HEADER, "x-chalin-origin-key");
  assert.equal(safeSecretEquals("release-secret", "release-secret"), true);
  assert.equal(safeSecretEquals("release-secret", "release-secrex"), false);
  assert.equal(safeSecretEquals("release-secret", ""), false);
});

test("security middleware enables CSP, HSTS and private API caching rules", () => {
  const source = read("backend/middleware/securityMiddleware.js");

  assert.match(source, /contentSecurityPolicy/);
  assert.match(source, /frameAncestors/);
  assert.match(source, /strictTransportSecurity/);
  assert.match(source, /Cache-Control", "no-store, max-age=0/);
  assert.match(source, /X-Robots-Tag", "noindex, nofollow, noarchive/);
  assert.match(source, /CLOUDFLARE_ORIGIN_SECRET/);
  assert.match(source, /ENFORCE_TRUSTED_API_HOSTS/);
});

test("production CORS retains both official frontend domains", () => {
  const server = read("backend/server.js");

  assert.match(server, /https:\/\/chalin03\.com/);
  assert.match(server, /https:\/\/www\.chalin03\.com/);
});
