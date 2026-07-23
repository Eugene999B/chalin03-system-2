const GHANA_TIME_ZONE = "Africa/Accra";
const MAX_SESSION_HOURS = 8;
const MAX_SESSION_MS = MAX_SESSION_HOURS * 60 * 60 * 1000;

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextGhanaMidnightAfter(value = new Date()) {
  const date = validDate(value) || new Date();

  // Ghana uses GMT/UTC throughout the year. Building the boundary in UTC keeps
  // the policy independent of the Railway server or browser's local timezone.
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
}

function getSessionPolicy(createdAt = new Date()) {
  const created = validDate(createdAt) || new Date();
  const eightHourExpiry = new Date(created.getTime() + MAX_SESSION_MS);
  const ghanaMidnightExpiry = nextGhanaMidnightAfter(created);
  const expiresAt = new Date(
    Math.min(eightHourExpiry.getTime(), ghanaMidnightExpiry.getTime())
  );
  const reason =
    ghanaMidnightExpiry.getTime() <= eightHourExpiry.getTime()
      ? "ghana_midnight"
      : "eight_hour_limit";

  return {
    createdAt: created,
    eightHourExpiry,
    ghanaMidnightExpiry,
    expiresAt,
    reason,
  };
}

function getEffectiveSessionExpiry({ createdAt, storedExpiresAt = null }) {
  const policy = getSessionPolicy(createdAt);
  const stored = validDate(storedExpiresAt);

  if (stored && stored.getTime() < policy.expiresAt.getTime()) {
    return {
      ...policy,
      expiresAt: stored,
      reason: "stored_expiry",
    };
  }

  return policy;
}

function expiryResponse(policy) {
  if (policy?.reason === "ghana_midnight") {
    return {
      code: "SESSION_EXPIRED_GHANA_MIDNIGHT",
      revocationReason: "ghana_midnight_logout",
      message:
        "The daily Ghana-midnight session reset has occurred. Please login again.",
    };
  }

  if (policy?.reason === "eight_hour_limit") {
    return {
      code: "SESSION_EXPIRED_EIGHT_HOURS",
      revocationReason: "eight_hour_session_limit",
      message: "Your eight-hour session has ended. Please login again.",
    };
  }

  return {
    code: "SESSION_EXPIRED",
    revocationReason: "expired",
    message: "Your session expired. Please login again.",
  };
}

module.exports = {
  GHANA_TIME_ZONE,
  MAX_SESSION_HOURS,
  MAX_SESSION_MS,
  expiryResponse,
  getEffectiveSessionExpiry,
  getSessionPolicy,
  nextGhanaMidnightAfter,
  validDate,
};
