"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  StartupSecurityError,
  productionSecretNames,
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

test("public form privacy secret is conditional on the public website flag", () => {
  assert.equal(
    productionSecretNames({ FEATURE_PUBLIC_WEBSITE: "false" }).includes(
      "PUBLIC_FORM_IP_HASH_SECRET"
    ),
    false
  );
  assert.equal(
    productionSecretNames({ FEATURE_PUBLIC_WEBSITE: "true" }).includes(
      "PUBLIC_FORM_IP_HASH_SECRET"
    ),
    true
  );
});

test("production refuses to enable the public website without its privacy secret", () => {
  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          FEATURE_PUBLIC_WEBSITE: "true",
          PUBLIC_FORM_IP_HASH_SECRET: "",
        }),
        allowedOrigins: officialOrigins,
      }),
    (error) => {
      assert.ok(error instanceof StartupSecurityError);
      assert.match(error.message, /PUBLIC_FORM_IP_HASH_SECRET is missing/);
      return true;
    }
  );
});

test("production accepts a distinct strong public form privacy secret", () => {
  const result = validateStartupSecurity({
    env: productionEnv({
      FEATURE_PUBLIC_WEBSITE: "true",
      PUBLIC_FORM_IP_HASH_SECRET: strongSecret(),
    }),
    allowedOrigins: officialOrigins,
  });

  assert.equal(result.production, true);
  assert.deepEqual(result.errors, []);
});

test("public form privacy secret cannot reuse another production secret", () => {
  const repeated = strongSecret();

  assert.throws(
    () =>
      validateStartupSecurity({
        env: productionEnv({
          FEATURE_PUBLIC_WEBSITE: "true",
          JWT_SECRET: repeated,
          PUBLIC_FORM_IP_HASH_SECRET: repeated,
        }),
        allowedOrigins: officialOrigins,
      }),
    /must use different secrets/
  );
});
