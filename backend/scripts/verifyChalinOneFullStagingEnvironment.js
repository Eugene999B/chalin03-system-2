"use strict";

const {
  STAGING_CONFIRMATION,
  STAGING_DATABASE_PATTERN,
  PRODUCTION_HOSTS,
  booleanValue,
  hostname,
  isPlaceholderSecret,
  positiveId,
} = require("./verifyChalinOneStagingEnvironment");

const REQUIRED_ENABLED_FLAGS = Object.freeze([
  "FEATURE_PUBLIC_WEBSITE",
  "FEATURE_CONTENT_STUDIO",
  "FEATURE_AI_ENABLED",
  "FEATURE_CHALIN_COPILOT",
  "FEATURE_CHALIN_EXECUTIVE",
  "FEATURE_CHALIN_GUIDE",
]);

const REQUIRED_DISABLED_FLAGS = Object.freeze([
  "FEATURE_CUSTOMER_PORTAL",
  "FEATURE_SUPPLIER_PORTAL",
  "FEATURE_APPLICANT_PORTAL",
  "FEATURE_AI_ACTIONS",
  "FEATURE_AI_SCHEDULED_JOBS",
]);

const RAILWAY_DEFAULT_DATABASE_NAME = "railway";
const RAILWAY_STAGING_ISOLATION_CONFIRMATION = "RAILWAY_DEDICATED_STAGING_MYSQL";

class ChalinOneFullStagingSafetyError extends Error {
  constructor(message, code = "CHALIN_ONE_FULL_STAGING_UNSAFE") {
    super(message);
    this.name = "ChalinOneFullStagingSafetyError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function unsafe(message, code) {
  throw new ChalinOneFullStagingSafetyError(message, code);
}

function requireNonProductionEndpoint(name, value) {
  const host = hostname(value);
  if (!host) {
    unsafe(`${name} must be configured.`, "CHALIN_ONE_FULL_STAGING_ENDPOINT_MISSING");
  }
  if (PRODUCTION_HOSTS.has(host)) {
    unsafe(
      `${name} points to the live Chalin 03 host ${host}.`,
      "CHALIN_ONE_FULL_STAGING_PRODUCTION_HOST_BLOCKED"
    );
  }
  return host;
}

function assertUsers(env) {
  const users = [
    positiveId(env.CHALIN_ONE_STAGING_AUTHOR_USER_ID),
    positiveId(env.CHALIN_ONE_STAGING_REVIEWER_USER_ID),
    positiveId(env.CHALIN_ONE_STAGING_PUBLISHER_USER_ID),
  ];
  if (users.some((value) => !value)) {
    unsafe(
      "Staging author, reviewer and publisher user IDs must be configured.",
      "CHALIN_ONE_FULL_STAGING_USERS_REQUIRED"
    );
  }
  if (new Set(users).size !== 3) {
    unsafe(
      "Staging author, reviewer and publisher must be three different users.",
      "CHALIN_ONE_FULL_STAGING_INDEPENDENT_REVIEW_REQUIRED"
    );
  }
}

function assertFeatures(env) {
  for (const flag of REQUIRED_ENABLED_FLAGS) {
    if (!booleanValue(env[flag])) {
      unsafe(`${flag} must be enabled in full CHALIN ONE staging.`, "CHALIN_ONE_FULL_STAGING_FEATURE_REQUIRED");
    }
  }
  for (const flag of REQUIRED_DISABLED_FLAGS) {
    if (booleanValue(env[flag])) {
      unsafe(`${flag} must remain disabled during the first full staging trial.`, "CHALIN_ONE_FULL_STAGING_RISKY_FEATURE_BLOCKED");
    }
  }
}

function assertProvider(env, mode) {
  const provider = clean(env.AI_PROVIDER || "disabled").toLowerCase();
  if (booleanValue(env.AI_ALLOW_MOCK_PROVIDER)) {
    unsafe(
      "AI_ALLOW_MOCK_PROVIDER must remain false in external staging.",
      "CHALIN_ONE_FULL_STAGING_MOCK_PROVIDER_BLOCKED"
    );
  }
  if (mode === "provider" && (!provider || provider === "disabled" || provider === "mock")) {
    unsafe(
      "Provider acceptance mode requires a real configured AI provider.",
      "CHALIN_ONE_FULL_STAGING_PROVIDER_REQUIRED"
    );
  }
  return provider;
}

function assertMigrationGatesClosed(env) {
  const openKeys = Object.entries(env)
    .filter(([key, value]) =>
      key.startsWith("CHALIN_ONE_ALLOW_") && booleanValue(value)
    )
    .map(([key]) => key);
  if (openKeys.length > 0) {
    unsafe(
      `Migration gates must be closed during normal staging runtime: ${openKeys.join(", ")}`,
      "CHALIN_ONE_FULL_STAGING_MIGRATION_GATE_OPEN"
    );
  }
}

function validateFullStagingEnvironment(env = process.env, options = {}) {
  const mode = clean(options.mode || "runtime").toLowerCase();
  if (!["runtime", "provider"].includes(mode)) {
    unsafe("Unknown full staging validation mode.", "CHALIN_ONE_FULL_STAGING_MODE_INVALID");
  }

  if (clean(env.NODE_ENV).toLowerCase() !== "staging") {
    unsafe("NODE_ENV must equal staging.", "CHALIN_ONE_FULL_STAGING_NODE_ENV_REQUIRED");
  }
  if (clean(env.CHALIN_ONE_STAGING_CONFIRM) !== STAGING_CONFIRMATION) {
    unsafe(
      "The exact CHALIN ONE staging confirmation token is required.",
      "CHALIN_ONE_FULL_STAGING_CONFIRMATION_REQUIRED"
    );
  }

  const railwayEnvironment = clean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT).toLowerCase();
  if (railwayEnvironment === "production") {
    unsafe(
      "The full staging verifier refuses a Railway environment named production.",
      "CHALIN_ONE_FULL_STAGING_RAILWAY_PRODUCTION_BLOCKED"
    );
  }

  const databaseName = clean(env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE);
  const databaseHost = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);
  const usesNamedStagingDatabase = STAGING_DATABASE_PATTERN.test(databaseName);
  const usesDedicatedRailwayStagingDatabase =
    Boolean(databaseName) &&
    railwayEnvironment === "staging" &&
    clean(env.CHALIN_ONE_STAGING_DATABASE_ISOLATION) === RAILWAY_STAGING_ISOLATION_CONFIRMATION &&
    /\.railway\.internal$/i.test(databaseHost);

  if (!usesNamedStagingDatabase && !usesDedicatedRailwayStagingDatabase) {
    unsafe(
      "Staging must use a chalin_one_staging database, or a dedicated Railway MySQL database only when the Railway environment is staging, the database host is internal (*.railway.internal), and the exact isolation confirmation is set.",
      "CHALIN_ONE_FULL_STAGING_DATABASE_NOT_ISOLATED"
    );
  }
  if (!databaseHost) {
    unsafe("A staging database host is required.", "CHALIN_ONE_FULL_STAGING_DATABASE_HOST_REQUIRED");
  }

  const frontendHost = requireNonProductionEndpoint("FRONTEND_URL", env.FRONTEND_URL);
  const apiHost = requireNonProductionEndpoint("CHALIN_ONE_STAGING_API_URL", env.CHALIN_ONE_STAGING_API_URL);
  if (frontendHost === apiHost) {
    unsafe(
      "Staging frontend and API must use separate hosts.",
      "CHALIN_ONE_FULL_STAGING_HOST_SEPARATION_REQUIRED"
    );
  }

  assertFeatures(env);
  assertUsers(env);
  assertMigrationGatesClosed(env);

  for (const secretName of [
    "JWT_SECRET",
    "BACKUP_SIGNING_SECRET",
    "ACCOUNT_RECOVERY_OTP_SECRET",
    "OWNER_MFA_ENCRYPTION_KEY",
    "PUBLIC_FORM_IP_HASH_SECRET",
  ]) {
    if (isPlaceholderSecret(env[secretName])) {
      unsafe(
        `${secretName} must be a unique staging-only secret of at least 64 characters.`,
        "CHALIN_ONE_FULL_STAGING_SECRET_WEAK"
      );
    }
  }

  if (booleanValue(env.SMS_ENABLED) && clean(env.SMS_PROVIDER).toLowerCase() !== "mock") {
    unsafe(
      "External staging must not send live SMS. Disable SMS or use the mock provider.",
      "CHALIN_ONE_FULL_STAGING_LIVE_SMS_BLOCKED"
    );
  }
  if (booleanValue(env.INSTALLMENT_SMS_REMINDERS_ENABLED)) {
    unsafe(
      "Installment SMS reminders must remain disabled in staging.",
      "CHALIN_ONE_FULL_STAGING_REMINDERS_BLOCKED"
    );
  }

  const mediaProvider = clean(env.PUBLIC_MEDIA_STORAGE_PROVIDER || "local").toLowerCase();
  if (mediaProvider === "r2") {
    const bucket = clean(env.CLOUDFLARE_R2_BUCKET);
    if (!/staging/i.test(bucket)) {
      unsafe(
        "The staging R2 bucket name must contain staging.",
        "CHALIN_ONE_FULL_STAGING_R2_NOT_ISOLATED"
      );
    }
  } else if (mediaProvider === "local") {
    const localRoot = clean(env.PUBLIC_MEDIA_LOCAL_ROOT);
    if (!/staging/i.test(localRoot)) {
      unsafe(
        "Local staging media path must contain staging.",
        "CHALIN_ONE_FULL_STAGING_MEDIA_NOT_ISOLATED"
      );
    }
  } else {
    unsafe(
      "PUBLIC_MEDIA_STORAGE_PROVIDER must be local or r2 for staging.",
      "CHALIN_ONE_FULL_STAGING_MEDIA_PROVIDER_INVALID"
    );
  }

  const provider = assertProvider(env, mode);

  return Object.freeze({
    safe: true,
    mode,
    database_name: databaseName,
    frontend_host: frontendHost,
    api_host: apiHost,
    ai_provider: provider,
    enabled_features: [...REQUIRED_ENABLED_FLAGS],
    disabled_features: [...REQUIRED_DISABLED_FLAGS],
  });
}

function parseMode(argv = process.argv.slice(2)) {
  const item = argv.find((value) => value.startsWith("--mode="));
  return item ? item.slice("--mode=".length) : "runtime";
}

if (require.main === module) {
  try {
    const result = validateFullStagingEnvironment(process.env, { mode: parseMode() });
    console.log("CHALIN ONE full staging environment verified safely.");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`CHALIN ONE full staging verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ChalinOneFullStagingSafetyError,
  REQUIRED_DISABLED_FLAGS,
  REQUIRED_ENABLED_FLAGS,
  RAILWAY_DEFAULT_DATABASE_NAME,
  RAILWAY_STAGING_ISOLATION_CONFIRMATION,
  assertFeatures,
  assertMigrationGatesClosed,
  assertProvider,
  validateFullStagingEnvironment,
};
