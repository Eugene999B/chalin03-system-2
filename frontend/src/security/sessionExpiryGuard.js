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
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    return new TextDecoder().decode(bytes);
  }

  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(padded, "base64").toString("utf8");
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

export function installSessionExpiryGuard({
  token,
  onExpire,
  onSessionChanged,
} = {}) {
  if (!token || typeof window === "undefined") {
    return () => {};
  }

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
    }
  };

  const checkStoredSession = () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);

    if (!storedToken) {
      expire("Your secure session ended. Please login again.");
      return true;
    }

    if (storedToken !== token) {
      completed = true;
      onSessionChanged?.({ token: storedToken });
      return true;
    }

    // The backend validates the real eight-hour, Ghana-midnight and JWT expiry
    // policy on every authenticated request. The browser clock is deliberately
    // not allowed to erase a valid server session because desktop clocks can be
    // ahead, behind or temporarily misconfigured.
    return false;
  };

  checkStoredSession();

  const handleVisibility = () => {
    if (document.visibilityState === "visible") checkStoredSession();
  };
  const handleStorage = (event) => {
    if (event.key === TOKEN_KEY && event.newValue !== token) {
      checkStoredSession();
    }
  };

  window.addEventListener("focus", checkStoredSession);
  window.addEventListener("pageshow", checkStoredSession);
  window.addEventListener("storage", handleStorage);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    completed = true;
    window.removeEventListener("focus", checkStoredSession);
    window.removeEventListener("pageshow", checkStoredSession);
    window.removeEventListener("storage", handleStorage);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

export const SESSION_EXPIRY_NOTICE = EXPIRY_NOTICE;
