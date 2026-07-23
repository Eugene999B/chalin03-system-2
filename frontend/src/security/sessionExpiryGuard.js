const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_NOTICE_KEY = "chalin03_login_notice";
const EXPIRY_NOTICE =
  "Your session ended after 8 hours or at 12:00 a.m. Ghana time. Please login again.";

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof globalThis.atob === "function") {
    return globalThis.atob(padded);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }

  throw new Error("Base64 decoder is unavailable.");
}

export function decodeTokenPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    return JSON.parse(decodeBase64Url(payload));
  } catch {
    return null;
  }
}

export function calculateSessionExpiry(token) {
  const payload = decodeTokenPayload(token);
  const issuedAtMs = Number(payload?.iat || 0) * 1000;
  const tokenExpiryMs = Number(payload?.exp || 0) * 1000;

  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return {
      expiresAtMs:
        Number.isFinite(tokenExpiryMs) && tokenExpiryMs > 0
          ? tokenExpiryMs
          : null,
      reason: "token_expiry",
    };
  }

  const issuedAt = new Date(issuedAtMs);
  const eightHourExpiryMs = issuedAtMs + MAX_SESSION_MS;
  const ghanaMidnightExpiryMs = Date.UTC(
    issuedAt.getUTCFullYear(),
    issuedAt.getUTCMonth(),
    issuedAt.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );

  const candidates = [eightHourExpiryMs, ghanaMidnightExpiryMs];
  if (Number.isFinite(tokenExpiryMs) && tokenExpiryMs > 0) {
    candidates.push(tokenExpiryMs);
  }

  const expiresAtMs = Math.min(...candidates);
  let reason = "eight_hour_limit";

  if (expiresAtMs === ghanaMidnightExpiryMs) {
    reason = "ghana_midnight";
  } else if (expiresAtMs === tokenExpiryMs) {
    reason = "token_expiry";
  }

  return {
    expiresAtMs,
    reason,
    issuedAtMs,
    eightHourExpiryMs,
    ghanaMidnightExpiryMs,
    tokenExpiryMs:
      Number.isFinite(tokenExpiryMs) && tokenExpiryMs > 0
        ? tokenExpiryMs
        : null,
  };
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("chalin03_active_context_mining");
  localStorage.removeItem("chalin03_active_context_equipment_hire");
}

export function installSessionExpiryGuard({ token, onExpire } = {}) {
  if (!token || typeof window === "undefined") {
    return () => {};
  }

  const policy = calculateSessionExpiry(token);
  let timer = null;
  let completed = false;

  const expire = (notice = EXPIRY_NOTICE) => {
    if (completed) return;
    completed = true;

    try {
      sessionStorage.setItem(LOGIN_NOTICE_KEY, notice);
    } catch {
      // The redirect and server-side expiry remain authoritative.
    }

    clearStoredSession();
    onExpire?.();

    if (window.location.pathname !== "/login") {
      window.location.replace("/login");
    } else {
      window.location.reload();
    }
  };

  const check = () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);

    if (!storedToken || storedToken !== token) {
      expire("Your secure session changed or ended. Please login again.");
      return true;
    }

    if (!policy.expiresAtMs || Date.now() >= policy.expiresAtMs) {
      expire();
      return true;
    }

    return false;
  };

  if (!check()) {
    timer = window.setTimeout(
      check,
      Math.max(0, policy.expiresAtMs - Date.now() + 25)
    );
  }

  const handleVisibility = () => {
    if (document.visibilityState === "visible") check();
  };
  const handleStorage = (event) => {
    if (event.key === TOKEN_KEY && event.newValue !== token) check();
  };

  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("storage", handleStorage);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    completed = true;
    if (timer) window.clearTimeout(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener("pageshow", check);
    window.removeEventListener("storage", handleStorage);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

export const SESSION_EXPIRY_NOTICE = EXPIRY_NOTICE;
