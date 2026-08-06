"use strict";

const STAGING_CONFIRMATION = "CHALIN_ONE_STAGING_PREVIEW_ONLY";
const MIGRATION_CONFIRMATION =
  "20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION";
const STAGING_DATABASE_PATTERN =
  /^chalin_one_staging(?:_[a-z0-9_]+)?$/i;
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const PRODUCTION_HOSTS = new Set([
  "chalin03.com",
  "www.chalin03.com",
  "staff.chalin03.com",
  "api.chalin03.com",
]);
const REQUIRED_ENABLED_FLAGS = Object.freeze([
  "FEATURE_PUBLIC_WEBSITE",
  "FEATURE_CONTENT_STUDIO",
]);
const REQUIRED_DISABLED_FLAGS = Object.freeze([
  "FEATURE_AI_ENABLED",
  "FEATURE_CHALIN_COPILOT",
  "FEATURE_CHALIN_EXECUTIVE",
  "FEATURE_CHALIN_GUIDE",
  "FEATURE_CUSTOMER_PORTAL",
  "FEATURE_SUPPLIER_PORTAL",
  "FEATURE_APPLICANT_PORTAL",
  "FEATURE_AI_ACTIONS",
  "FEATURE_AI_SCHEDULED_JOBS",
]);

class ChalinOneStagingSafetyError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_UNSAFE") {
    super(message);
    this.name = "ChalinOneStagingSafetyError";
    this.code = code;
  }
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function clean(value) {
  return String(value || "").trim();
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function hostname(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .split(/[/:]/)[0]
      .trim()
      .toLowerCase() || null;
  }
}

function isPlaceholderSecret(value) {
  const secret = clean(value).toLowerCase();
  return (
    !secret ||
    secret.length < 64 ||
    secret.includes("replace_with") ||
    secret.includes("your_") ||
    secret.includes("example")
  );
}

function unsafe(message, code) {
  throw new ChalinOneStagingSafetyError(message, code);
}

function assertSafePublicEndpoint(name, value) {
  const host = hostname(value);
  if (!host) {
    unsafe(`${name} must be configured for the staging preview.`,
      "CHALIN_ONE_STAGING_ENDPOINT_MISSING");
  }
  if (PRODUCTION_HOSTS.has(host)) {
    unsafe(`${name} points to the live Chalin 03 host ${host}.`,
      "CHALIN_ONE_STAGING_PRODUCTION_HOST_BLOCKED");
  }
  return host;
}

function assertDistinctUsers(env) {
  const users = {
    author: positiveId(env.CHALIN_ONE_STAGING_AUTHOR_USER_ID),
    reviewer: positiveId(env.CHALIN_ONE_STAGING_REVIEWER_USER_ID),
    publisher: positiveId(env.CHALIN_ONE_STAGING_PUBLISHER_USER_ID),
  };
  if (!users.author || !users.reviewer || !users.publisher) {
    unsafe(
      "Staging author, reviewer and publisher user IDs must be positive integers.",
      "CHALIN_ONE_STAGING_USERS_REQUIRED"
    );
  }
  if (new Set(Object.values(users)).size !== 3) {
    unsafe(
      "Staging author, reviewer and publisher must be three different users.",
      "CHALIN_ONE_STAGING_INDEPENDENT_REVIEW_REQUIRED"
    );
  }
  return users;
}

function assertFeatureBoundary(env) {
  for (const flag of REQUIRED_ENABLED_FLAGS) {
    if (!booleanValue(env[flag])) {
      unsafe(`${flag} must be enabled in the isolated staging preview.`,
        "CHALIN_ONE_STAGING_REQUIRED_FEATURE_DISABLED");
    }
  }
  for (const flag of REQUIRED_DISABLED_FLAGS) {
    if (booleanValue(env[flag])) {
      unsafe(`${flag} must remain disabled during Release B staging acceptance.`,
        "CHALIN_ONE_STAGING_FUTURE_FEATURE_ENABLED");
    }
  }
}

function assertMediaIsolation(env) {
  const provider = clean(env.PUBLIC_MEDIA_STORAGE_PROVIDER || "local")
    .toLowerCase();
  if (provider === "local") {
    const root = clean(env.PUBLIC_MEDIA_LOCAL_ROOT);
    if (!root || !/staging/i.test(root)) {
      unsafe(
        "Local staging media must use a dedicated path containing the word staging.",
        "CHALIN_ONE_STAGING_MEDIA_NOT_ISOLATED"
      );
    }
    return { provider, location: root };
  }

  if (provider !== "r2") {
    unsafe(
      "Staging media provider must be local or r2.",
      "CHALIN_ONE_STAGING_MEDIA_PROVIDER_INVALID"
    );
  }

  const bucket = clean(env.CLOUDFLARE_R2_BUCKET);
  if (!bucket || !/staging/i.test(bucket)) {
    unsafe(
      "The staging R2 bucket name must contain the word staging.",
      "CHALIN_ONE_STAGING_R2_BUCKET_NOT_ISOLATED"
    );
  }
  for (const key of [
    "CLOUDFLARE_R2_ACCOUNT_ID",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "PUBLIC_MEDIA_PUBLIC_BASE_URL",
  ]) {
    if (!clean(env[key])) {
      unsafe(`${key} is required when staging uses R2.`,
        "CHALIN_ONE_STAGING_R2_CONFIGURATION_INCOMPLETE");
    }
  }
  assertSafePublicEndpoint(
    "PUBLIC_MEDIA_PUBLIC_BASE_URL",
    env.PUBLIC_MEDIA_PUBLIC_BASE_URL
  );
  return { provider, location: bucket };
}

function assertMigrationMode(env, mode) {
  const allowMigration = booleanValue(env.CHALIN_ONE_ALLOW_SCHEMA_MIGRATION);
  const confirmation = clean(
    env.CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM
  );

  if (mode === "migration") {
    if (!allowMigration || confirmation !== MIGRATION_CONFIRMATION) {
      unsafe(
        "Migration validation requires the one-time schema gate and exact migration confirmation.",
        "CHALIN_ONE_STAGING_MIGRATION_GATE_REQUIRED"
      );
    }
    return;
  }

  if (allowMigration || confirmation) {
    unsafe(
      "Schema migration gates must be disabled during normal staging runtime and content seeding.",
      "CHALIN_ONE_STAGING_MIGRATION_GATE_LEFT_OPEN"
    );
  }
}

function validateStagingEnvironment(env = process.env, options = {}) {
  const mode = clean(options.mode || "runtime").toLowerCase();
  if (!["runtime", "migration", "seed"].includes(mode)) {
    unsafe("Unknown staging validation mode.",
      "CHALIN_ONE_STAGING_MODE_INVALID");
  }

  const nodeEnvironment = clean(env.NODE_ENV).toLowerCase();
  if (nodeEnvironment !== "staging") {
    unsafe(
      "CHALIN ONE staging commands require NODE_ENV=staging.",
      "CHALIN_ONE_STAGING_NODE_ENV_REQUIRED"
    );
  }
  if (clean(env.CHALIN_ONE_STAGING_CONFIRM) !== STAGING_CONFIRMATION) {
    unsafe(
      "The exact CHALIN ONE staging confirmation token is required.",
      "CHALIN_ONE_STAGING_CONFIRMATION_REQUIRED"
    );
  }

  const railwayEnvironment = clean(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  ).toLowerCase();
  if (railwayEnvironment === "production") {
    unsafe(
      "The staging verifier refuses the Railway production environment.",
      "CHALIN_ONE_STAGING_RAILWAY_PRODUCTION_BLOCKED"
    );
  }

  const databaseName = clean(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE
  );
  if (!STAGING_DATABASE_PATTERN.test(databaseName)) {
    unsafe(
      "The database name must match chalin_one_staging or chalin_one_staging_<name>.",
      "CHALIN_ONE_STAGING_DATABASE_NOT_ISOLATED"
    );
  }
  if (!clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST)) {
    unsafe("A staging database host is required.",
      "CHALIN_ONE_STAGING_DATABASE_HOST_REQUIRED");
  }

  const frontendHost = assertSafePublicEndpoint(
    "FRONTEND_URL",
    env.FRONTEND_URL
  );
  const apiHost = assertSafePublicEndpoint(
    "CHALIN_ONE_STAGING_API_URL",
    env.CHALIN_ONE_STAGING_API_URL
  );
  if (frontendHost === apiHost) {
    unsafe(
      "Staging frontend and API must use separate hosts.",
      "CHALIN_ONE_STAGING_HOST_SEPARATION_REQUIRED"
    );
  }

  assertFeatureBoundary(env);
  assertMigrationMode(env, mode);
  const media = assertMediaIsolation(env);
  const users = assertDistinctUsers(env);

  if (isPlaceholderSecret(env.PUBLIC_FORM_IP_HASH_SECRET)) {
    unsafe(
      "PUBLIC_FORM_IP_HASH_SECRET must be a unique staging-only value of at least 64 characters.",
      "CHALIN_ONE_STAGING_PUBLIC_FORM_SECRET_WEAK"
    );
  }

  return Object.freeze({
    safe: true,
    mode,
    node_environment: nodeEnvironment,
    database_name: databaseName,
    frontend_host: frontendHost,
    api_host: apiHost,
    media,
    users,
    enabled_features: [...REQUIRED_ENABLED_FLAGS],
    disabled_future_features: [...REQUIRED_DISABLED_FLAGS],
  });
}

function parseMode(argv = process.argv.slice(2)) {
  const item = argv.find((value) => value.startsWith("--mode="));
  return item ? item.slice("--mode=".length) : "runtime";
}

if (require.main === module) {
  try {
    const result = validateStagingEnvironment(process.env, {
      mode: parseMode(),
    });
    console.log("CHALIN ONE staging environment verified safely.");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`CHALIN ONE staging verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ChalinOneStagingSafetyError,
  MIGRATION_CONFIRMATION,
  PRODUCTION_HOSTS,
  REQUIRED_DISABLED_FLAGS,
  REQUIRED_ENABLED_FLAGS,
  STAGING_CONFIRMATION,
  STAGING_DATABASE_PATTERN,
  assertDistinctUsers,
  assertFeatureBoundary,
  assertMediaIsolation,
  assertMigrationMode,
  booleanValue,
  hostname,
  isPlaceholderSecret,
  parseMode,
  positiveId,
  validateStagingEnvironment,
};