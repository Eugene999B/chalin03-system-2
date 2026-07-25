const test = require("node:test");
const assert = require("node:assert/strict");

const { getSslConfig } = require("../config/db");
const { auditStartupSecurity } = require("../config/startupSecurity");

function strongSecret(prefix) {
  return `${prefix}-Aa1!Bb2@Cc3#Dd4$Ee5%Ff6^Gg7&Hh8*Ii9(Jj0)Kk1_Ll2+Mm3=Nn4?`;
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    FRONTEND_URL: "https://www.chalin03.com",
    FRONTEND_URL_ALT: "https://chalin03.com",
    TRUSTED_API_HOSTS: "api.chalin03.com",
    ENFORCE_TRUSTED_API_HOSTS: "true",
    ENFORCE_PRODUCTION_SECURITY_SECRETS: "true",
    DB_SSL: "true",
    MYSQLHOST: "mysql.railway.internal",
    JWT_SECRET: strongSecret("jwt"),
    ACCOUNT_RECOVERY_OTP_SECRET: strongSecret("otp"),
    CLOUDFLARE_ORIGIN_SECRET: strongSecret("origin"),
    OWNER_MFA_ENCRYPTION_KEY: strongSecret("mfa"),
    BACKUP_SIGNING_SECRET: strongSecret("backup"),
    ...overrides,
  };
}

test("MySQL TLS verifies certificates by default", () => {
  assert.deepEqual(getSslConfig({ DB_SSL: "true" }), {
    rejectUnauthorized: true,
  });
});

test("Railway-compatible MySQL TLS can keep encryption with self-signed certificates", () => {
  assert.deepEqual(
    getSslConfig({
      DB_SSL: "true",
      DB_SSL_REJECT_UNAUTHORIZED: "false",
    }),
    { rejectUnauthorized: false }
  );
});

test("a configured CA always enables certificate verification", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
  assert.deepEqual(
    getSslConfig({
      DB_SSL: "true",
      DB_SSL_REJECT_UNAUTHORIZED: "false",
      DB_SSL_CA_BASE64: Buffer.from(ca, "utf8").toString("base64"),
    }),
    { ca, rejectUnauthorized: true }
  );
});

test("production permits disabled certificate-chain verification only on Railway private MySQL", () => {
  const result = auditStartupSecurity({
    env: productionEnv({ DB_SSL_REJECT_UNAUTHORIZED: "false" }),
    allowedOrigins: ["https://www.chalin03.com", "https://chalin03.com"],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(
    result.warnings.some((warning) =>
      warning.includes("Railway private-network identity protection")
    ),
    true
  );
});

test("production rejects disabled certificate verification for external MySQL hosts", () => {
  const result = auditStartupSecurity({
    env: productionEnv({
      DB_HOST: "public-mysql.example.net",
      MYSQLHOST: "",
      DB_SSL_REJECT_UNAUTHORIZED: "false",
    }),
    allowedOrigins: ["https://www.chalin03.com", "https://chalin03.com"],
  });

  assert.equal(
    result.errors.includes(
      "DB_SSL_REJECT_UNAUTHORIZED may be false only for a Railway private *.railway.internal MySQL host"
    ),
    true
  );
});
