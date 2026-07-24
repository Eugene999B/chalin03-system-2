const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ORIGIN_SECRET_HEADER,
  getTrustedApiHosts,
  getTrustedFrontendOrigins,
  isTrustedApiHost,
  isTrustedFrontendOrigin,
  normalizeHost,
  normalizeOrigin,
  safeSecretEquals,
} = require("../middleware/securityMiddleware");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("trusted API host normalization accepts the official API domain", () => {
  assert.equal(normalizeHost("api.chalin03.com:443"), "api.chalin03.com");
  assert.equal(normalizeHost("https://api.chalin03.com/path"), "api.chalin03.com");
  assert.equal(isTrustedApiHost("api.chalin03.com"), true);
  assert.equal(getTrustedApiHosts().has("api.chalin03.com"), true);
});

test("production trusts neither Railway nor localhost API hosts", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      TRUSTED_API_HOSTS: "api.chalin03.com",
    },
    () => {
      assert.equal(
        isTrustedApiHost("distinguished-compassion-production.up.railway.app"),
        false
      );
      assert.equal(isTrustedApiHost("localhost:5000"), false);
      assert.equal(isTrustedApiHost("127.0.0.1:5000"), false);
    }
  );
});

test("production frontend origins are exact and HTTPS", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      FRONTEND_URL: "https://chalin03.com",
      FRONTEND_URL_ALT: "https://www.chalin03.com",
    },
    () => {
      assert.equal(normalizeOrigin("https://chalin03.com/login"), "https://chalin03.com");
      assert.equal(isTrustedFrontendOrigin("https://chalin03.com"), true);
      assert.equal(isTrustedFrontendOrigin("https://www.chalin03.com"), true);
      assert.equal(isTrustedFrontendOrigin("http://localhost:5173"), false);
      assert.equal(isTrustedFrontendOrigin("https://evil.example"), false);
      assert.equal(getTrustedFrontendOrigins().has("http://localhost:5173"), false);
    }
  );
});

test("origin secret comparison is timing-safe and rejects altered values", () => {
  assert.equal(ORIGIN_SECRET_HEADER, "x-chalin-origin-key");
  assert.equal(safeSecretEquals("release-secret", "release-secret"), true);
  assert.equal(safeSecretEquals("release-secret", "release-secrex"), false);
  assert.equal(safeSecretEquals("release-secret", ""), false);
});

test("security middleware fails closed and enables security headers", () => {
  const source = read("backend/middleware/securityMiddleware.js");
  assert.match(source, /contentSecurityPolicy/);
  assert.match(source, /frameAncestors/);
  assert.match(source, /strictTransportSecurity/);
  assert.match(source, /Cache-Control", "no-store, max-age=0/);
  assert.match(source, /X-Robots-Tag", "noindex, nofollow, noarchive/);
  assert.match(source, /ORIGIN_PROTECTION_NOT_CONFIGURED/);
  assert.match(source, /UNTRUSTED_FRONTEND_ORIGIN/);
  assert.doesNotMatch(source, /enforcementDisabled/);
});

test("production CORS retains both official frontend domains", () => {
  const server = read("backend/server.js");
  assert.match(server, /https:\/\/chalin03\.com/);
  assert.match(server, /https:\/\/www\.chalin03\.com/);
});
