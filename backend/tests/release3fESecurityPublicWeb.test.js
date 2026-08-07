const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ORIGIN_SECRET_HEADER,
  TRUSTED_BROWSER_METHODS,
  getTrustedApiHosts,
  getTrustedFrontendOrigins,
  isTrustedApiHost,
  isTrustedFrontendOrigin,
  normalizeHost,
  normalizeOrigin,
  safeSecretEquals,
  trustedBrowserCorsBoundary,
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

function mockRequest({ method = "GET", path = "/api/auth/me", headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    method,
    path,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()];
    },
  };
}

function mockResponse() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    vary(value) {
      headers.vary = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
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

test("trusted production preflight returns CORS headers before downstream security", () => {
  withEnvironment({ NODE_ENV: "production" }, () => {
    const request = mockRequest({
      method: "OPTIONS",
      path: "/api/equipment-catalogue/sales/professional/completion-documents/options",
      headers: {
        origin: "https://chalin03.com",
        "access-control-request-method": "GET",
        "access-control-request-headers":
          "authorization,x-chalin03-workspace,x-chalin03-division",
      },
    });
    const response = mockResponse();
    let nextCalled = false;

    trustedBrowserCorsBoundary(request, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 204);
    assert.equal(response.ended, true);
    assert.equal(response.headers["access-control-allow-origin"], "https://chalin03.com");
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.equal(response.headers["access-control-allow-methods"], TRUSTED_BROWSER_METHODS);
    assert.equal(
      response.headers["access-control-allow-headers"],
      "authorization,x-chalin03-workspace,x-chalin03-division"
    );
    assert.equal(response.headers["access-control-max-age"], "86400");
  });
});

test("trusted production browser requests keep CORS headers even when a later security gate rejects", () => {
  withEnvironment({ NODE_ENV: "production" }, () => {
    const request = mockRequest({
      method: "GET",
      path: "/api/auth/me",
      headers: { origin: "https://www.chalin03.com" },
    });
    const response = mockResponse();
    let nextCalled = false;

    trustedBrowserCorsBoundary(request, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(response.ended, false);
    assert.equal(response.headers["access-control-allow-origin"], "https://www.chalin03.com");
    assert.equal(response.headers["access-control-allow-credentials"], "true");
  });
});

test("untrusted origins do not receive trusted CORS headers", () => {
  withEnvironment({ NODE_ENV: "production" }, () => {
    const request = mockRequest({
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    const response = mockResponse();
    let nextCalled = false;

    trustedBrowserCorsBoundary(request, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  });
});

test("security middleware fails closed and enables security headers", () => {
  const source = read("backend/middleware/securityMiddleware.js");
  assert.match(source, /trustedBrowserCorsBoundary/);
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