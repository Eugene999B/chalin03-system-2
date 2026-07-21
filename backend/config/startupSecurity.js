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

function auditStartupSecurity({
  env = process.env,
  allowedOrigins = [],
} = {}) {
  const production = isProductionEnvironment(env);
  const strictProductionSecurity = booleanValue(
    env.ENFORCE_PRODUCTION_SECURITY_SECRETS,
    false
  );
  const errors = [];
  const warnings = [];
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(cleanValue).filter(Boolean)
    : [];
  const jwtSecret = cleanValue(env.JWT_SECRET);
  const otpSecret = cleanValue(env.ACCOUNT_RECOVERY_OTP_SECRET);
  const originSecret = cleanValue(env.CLOUDFLARE_ORIGIN_SECRET);

  if (!jwtSecret) {
    errors.push("JWT_SECRET is missing");
  }

  if (origins.length === 0) {
    errors.push("No frontend CORS origins are configured");
  }

  if (production) {
    const productionProblems = [
      ...secretProblems("JWT_SECRET", jwtSecret),
      ...secretProblems(
        "ACCOUNT_RECOVERY_OTP_SECRET",
        otpSecret
      ),
      ...secretProblems(
        "CLOUDFLARE_ORIGIN_SECRET",
        originSecret
      ),
    ];

    if (jwtSecret && otpSecret && jwtSecret === otpSecret) {
      productionProblems.push(
        "ACCOUNT_RECOVERY_OTP_SECRET must be different from JWT_SECRET"
      );
    }

    if (
      cleanValue(
        env.ENFORCE_TRUSTED_API_HOSTS || "true"
      ).toLowerCase() === "false"
    ) {
      productionProblems.push(
        "ENFORCE_TRUSTED_API_HOSTS cannot be false in production"
      );
    }

    if (!origins.some((origin) => origin.startsWith("https://"))) {
      productionProblems.push(
        "At least one HTTPS frontend origin is required in production"
      );
    }

    if (strictProductionSecurity) {
      errors.push(...productionProblems);
    } else {
      warnings.push(...productionProblems);
      if (productionProblems.length > 0) {
        warnings.push(
          "Set ENFORCE_PRODUCTION_SECURITY_SECRETS=true only after Railway secrets and the Cloudflare origin-header rule are configured."
        );
      }
    }
  } else {
    const developmentJwtProblems = secretProblems(
      "JWT_SECRET",
      jwtSecret
    );

    if (jwtSecret && developmentJwtProblems.length > 0) {
      warnings.push(
        "Development JWT_SECRET is not production-strength. Do not reuse it in Railway."
      );
    }

    if (!otpSecret) {
      warnings.push(
        "ACCOUNT_RECOVERY_OTP_SECRET is not set, so local OTP hashing falls back to JWT_SECRET."
      );
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
  StartupSecurityError,
  auditStartupSecurity,
  booleanValue,
  isProductionEnvironment,
  looksLikePlaceholder,
  secretProblems,
  validateStartupSecurity,
};
