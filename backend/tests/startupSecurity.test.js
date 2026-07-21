const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  StartupSecurityError,
  auditStartupSecurity,
  validateStartupSecurity,
} = require("../config/startupSecurity");

function strongSecret() {
  return crypto.randomBytes(64).toString("hex");
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    JWT_SECRET: strongSecret(),
    ACCOUNT_RECOVERY_OTP_SECRET: strongSecret(),
    CLOUDFLARE_ORIGIN_SECRET: strongSecret(),
    ENFORCE_TRUSTED_API_HOSTS: "true",
    ENFORCE_PRODUCTION_SECURITY_SECRETS: "true",
    ...overrides,
  };
}

const officialOrigins = [
  "https://chalin03.com",
  "https://www.chalin03.com",
];

test("development remains usable while warning about weak local secrets", () => {
  const result = validateStartupSecurity({
    env: {
      NODE_ENV: "development",
      JWT_SECRET: "change_this_local_secret",
    },
    allowedOrigins: ["http://localhost:5173"],
  });

  assert.equal(result.production, false);
  assert.ok(result.warnings.length >= 1);
});

test("production accepts separate strong secrets in strict mode", () => {
  const result = validateStartupSecurity({
    env: productionEnv(),
    allowedOrigins: officialOrigins,
  });

  assert.equal(result.production, true);
  assert.equal(result.strictProductionSecurity, true);
  assert.deepEqual(result.warnings, []);
});

test("production warning mode reports missing origin protection without outage", () => {
  const result = validateStartupSecurity({
    env: productionEnv({
      CLOUDFLARE_ORIGIN_SECRET: "",
      ENFORCE_PRODUCTION_SECURITY_SECRETS: "false",
    }),
    allowedOrigins: officialOrigins,
  });

  assert.equal(result.errors.length, 0);
  assert.match(
    result.warnings.join(" "),
    /CLOUDFLARE_ORIGIN_SECRET is missing/
  );
});

test("strict production mode rejects missing Cloudflare origin protection", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          CLOUDFLARE_ORIGIN_SECRET: "",
        }),
        allowedOrigins: officialOrigins,
      }),
    (error) => {
      assert.ok(error instanceof StartupSecurityError);
      assert.match(
        error.message,
        /CLOUDFLARE_ORIGIN_SECRET is missing/
      );
      return true;
    }
  );
});

test("strict production mode rejects reused and placeholder secrets", () => {
  const repeatedSecret = "replace_with_a_long_random_secret";

  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          JWT_SECRET: repeatedSecret,
          ACCOUNT_RECOVERY_OTP_SECRET: repeatedSecret,
        }),
        allowedOrigins: officialOrigins,
      }),
    (error) => {
      assert.match(error.message, /JWT_SECRET/);
      assert.match(error.message, /placeholder/);
      assert.match(error.message, /must be different/);
      return true;
    }
  );
});

test("strict production mode refuses disabled trusted-host enforcement", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          ENFORCE_TRUSTED_API_HOSTS: "false",
        }),
        allowedOrigins: officialOrigins,
      }),
    /ENFORCE_TRUSTED_API_HOSTS cannot be false/
  );
});

test("audit function never returns duplicate findings", () => {
  const result = auditStartupSecurity({
    env: productionEnv({
      JWT_SECRET: "",
      ENFORCE_PRODUCTION_SECURITY_SECRETS: "false",
    }),
    allowedOrigins: officialOrigins,
  });

  assert.equal(
    result.errors.length,
    new Set(result.errors).size
  );
  assert.equal(
    result.warnings.length,
    new Set(result.warnings).size
  );
});
