const MIN_PRODUCTION_SECRET_LENGTH = 64;
const MIN_SECRET_VARIETY = 12;

const PLACEHOLDER_FRAGMENTS = [
  "change_this",
  "replace_with",
  "your_",
  "changeme",
  "example",
  "placeholder",
  "secret_key",
  "random_secret",
  "put_real",
  "<",
  ">",
];

const PRODUCTION_SECRET_NAMES = [
  "JWT_SECRET",
  "ACCOUNT_RECOVERY_OTP_SECRET",
  "CLOUDFLARE_ORIGIN_SECRET",
  "OWNER_MFA_ENCRYPTION_KEY",
  "BACKUP_SIGNING_SECRET",
];

class StartupSecurityError extends Error {
  constructor(problems) {
    super(`Startup security check failed: ${problems.join("; ")}`);
    this.name = "StartupSecurityError";
    this.code = "STARTUP_SECURITY_CHECK_FAILED";
    this.problems = [...problems];
  }
}

function cleanValue(value) {
  return String(value || "").trim();
}

function booleanValue(value, fallback = false) {
  const normalized = cleanValue(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isProductionEnvironment(env = process.env) {
  return cleanValue(env.NODE_ENV).toLowerCase() === "production";
}

function looksLikePlaceholder(value) {
  const normalized = cleanValue(value).toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment)
  );
}

function secretProblems(name, value) {
  const secret = cleanValue(value);
  const problems = [];

  if (!secret) {
    problems.push(`${name} is missing`);
    return problems;
  }

  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    problems.push(
      `${name} must contain at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`
    );
  }

  if (looksLikePlaceholder(secret)) {
    problems.push(`${name} still contains a placeholder value`);
  }

  if (new Set(secret).size < MIN_SECRET_VARIETY) {
    problems.push(`${name} does not contain enough character variety`);
  }

  return problems;
}

function normalizeHostEntry(value) {
  const raw = cleanValue(value);
  if (!raw) return "";

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password) return "";
    if (parsed.pathname && parsed.pathname !== "/") return "";
    if (parsed.search || parsed.hash) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizedHosts(value) {
  return cleanValue(value)
    .split(",")
    .map(normalizeHostEntry)
    .filter(Boolean);
}

function distinctSecretProblems(env) {
  const values = PRODUCTION_SECRET_NAMES.map((name) => [
    name,
    cleanValue(env[name]),
  ]).filter(([, value]) => value);
  const problems = [];

  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (values[left][1] === values[right][1]) {
        problems.push(
          `${values[left][0]} and ${values[right][0]} must use different secrets`
        );
      }
    }
  }

  return problems;
}

function auditStartupSecurity({
  env = process.env,
  allowedOrigins = [],
} = {}) {
  const production = isProductionEnvironment(env);
  // Production is always strict. The legacy flag remains visible only so an
  // explicitly false value is reported as a configuration error.
  const strictProductionSecurity = production
    ? true
    : booleanValue(env.ENFORCE_PRODUCTION_SECURITY_SECRETS, false);
  const errors = [];
  const warnings = [];
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(cleanValue).filter(Boolean)
    : [];
  const jwtSecret = cleanValue(env.JWT_SECRET);

  if (!jwtSecret) {
    errors.push("JWT_SECRET is missing");
  }

  if (origins.length === 0) {
    errors.push("No frontend CORS origins are configured");
  }

  if (production) {
    for (const secretName of PRODUCTION_SECRET_NAMES) {
      errors.push(...secretProblems(secretName, env[secretName]));
    }
    errors.push(...distinctSecretProblems(env));

    if (
      cleanValue(env.ENFORCE_PRODUCTION_SECURITY_SECRETS).toLowerCase() ===
      "false"
    ) {
      errors.push(
        "ENFORCE_PRODUCTION_SECURITY_SECRETS cannot be false in production"
      );
    }

    if (
      cleanValue(env.ENFORCE_TRUSTED_API_HOSTS || "true").toLowerCase() ===
      "false"
    ) {
      errors.push("ENFORCE_TRUSTED_API_HOSTS cannot be false in production");
    }

    const trustedHostSet = new Set(normalizedHosts(env.TRUSTED_API_HOSTS));
    if (!trustedHostSet.has("api.chalin03.com")) {
      errors.push("TRUSTED_API_HOSTS must include api.chalin03.com in production");
    }
    if ([...trustedHostSet].some((host) => host.endsWith(".railway.app"))) {
      errors.push("TRUSTED_API_HOSTS must not include Railway public hostnames");
    }

    if (!booleanValue(env.DB_SSL, false)) {
      errors.push("DB_SSL must be true in production");
    }

    const httpsOrigins = origins.filter((origin) =>
      origin.startsWith("https://")
    );
    if (httpsOrigins.length === 0) {
      errors.push("At least one HTTPS frontend origin is required in production");
    }
    if (
      httpsOrigins.some(
        (origin) =>
          origin.includes("localhost") || origin.includes("127.0.0.1")
      )
    ) {
      errors.push("Production HTTPS frontend origins cannot use localhost");
    }
  } else {
    const developmentJwtProblems = secretProblems("JWT_SECRET", jwtSecret);
    if (jwtSecret && developmentJwtProblems.length > 0) {
      warnings.push(
        "Development JWT_SECRET is not production-strength. Do not reuse it in Railway."
      );
    }

    for (const secretName of PRODUCTION_SECRET_NAMES.filter(
      (name) => name !== "JWT_SECRET"
    )) {
      if (!cleanValue(env[secretName])) {
        warnings.push(
          `${secretName} is not configured. Production will refuse to start without it.`
        );
      }
    }
  }

  return {
    production,
    strictProductionSecurity,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

function validateStartupSecurity(options = {}) {
  const result = auditStartupSecurity(options);
  if (result.errors.length > 0) {
    throw new StartupSecurityError(result.errors);
  }
  return result;
}

module.exports = {
  MIN_PRODUCTION_SECRET_LENGTH,
  MIN_SECRET_VARIETY,
  PRODUCTION_SECRET_NAMES,
  StartupSecurityError,
  auditStartupSecurity,
  booleanValue,
  distinctSecretProblems,
  isProductionEnvironment,
  looksLikePlaceholder,
  normalizeHostEntry,
  normalizedHosts,
  secretProblems,
  validateStartupSecurity,
};
