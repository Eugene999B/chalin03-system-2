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
    OWNER_MFA_ENCRYPTION_KEY: strongSecret(),
    BACKUP_SIGNING_SECRET: strongSecret(),
    TRUSTED_API_HOSTS: "api.chalin03.com",
    ENFORCE_TRUSTED_API_HOSTS: "true",
    ENFORCE_PRODUCTION_SECURITY_SECRETS: "true",
    DB_SSL: "true",
    ...overrides,
  };
}

const officialOrigins = [
  "https://chalin03.com",
  "https://www.chalin03.com",
];

test("development remains usable while warning about missing production controls", () => {
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

test("production accepts all independent strong controls", () => {
  const result = validateStartupSecurity({
    env: productionEnv(),
    allowedOrigins: officialOrigins,
  });
  assert.equal(result.production, true);
  assert.equal(result.strictProductionSecurity, true);
  assert.deepEqual(result.warnings, []);
});

test("production cannot fall back to warning mode", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          CLOUDFLARE_ORIGIN_SECRET: "",
          ENFORCE_PRODUCTION_SECURITY_SECRETS: "false",
        }),
        allowedOrigins: officialOrigins,
      }),
    (error) => {
      assert.ok(error instanceof StartupSecurityError);
      assert.match(error.message, /CLOUDFLARE_ORIGIN_SECRET is missing/);
      assert.match(error.message, /cannot be false in production/);
      return true;
    }
  );
});

test("production requires backup signing, owner MFA and database TLS", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          BACKUP_SIGNING_SECRET: "",
          OWNER_MFA_ENCRYPTION_KEY: "",
          DB_SSL: "false",
        }),
        allowedOrigins: officialOrigins,
      }),
    (error) => {
      assert.match(error.message, /BACKUP_SIGNING_SECRET is missing/);
      assert.match(error.message, /OWNER_MFA_ENCRYPTION_KEY is missing/);
      assert.match(error.message, /DB_SSL must be true/);
      return true;
    }
  );
});

test("production rejects reused and placeholder secrets", () => {
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
      assert.match(error.message, /must use different secrets/);
      return true;
    }
  );
});

test("production requires the official API host and rejects Railway hosts", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          TRUSTED_API_HOSTS: "example.up.railway.app",
        }),
        allowedOrigins: officialOrigins,
      }),
    /must include api\.chalin03\.com|must not include Railway/
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
  assert.equal(result.errors.length, new Set(result.errors).size);
  assert.equal(result.warnings.length, new Set(result.warnings).size);
});
