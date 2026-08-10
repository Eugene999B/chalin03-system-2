import {
  publicWebsiteClient,
  publicWebsiteErrorMessage,
} from "./publicWebsiteApi";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function guideHeaders(sessionToken = "") {
  return sessionToken
    ? { "x-chalin-guide-session": String(sessionToken) }
    : {};
}

export async function getPublicGuideAvailability({ signal } = {}) {
  const response = await publicWebsiteClient.get("/features/public", { signal });
  const payload = response?.data || {};
  return payload?.flags?.chalinGuide === true;
}

export async function createGuideSession({ signal } = {}) {
  return unwrap(
    await publicWebsiteClient.post("/public/guide/sessions", {}, {
      signal,
      headers: { "Content-Type": "application/json" },
    })
  );
}

export async function getGuideHistory(sessionToken, { signal } = {}) {
  return unwrap(
    await publicWebsiteClient.get("/public/guide/history", {
      signal,
      headers: guideHeaders(sessionToken),
    })
  );
}

export async function sendGuideMessage(
  sessionToken,
  message,
  { signal } = {}
) {
  return unwrap(
    await publicWebsiteClient.post(
      "/public/guide/messages",
      { message },
      {
        signal,
        headers: {
          "Content-Type": "application/json",
          ...guideHeaders(sessionToken),
        },
      }
    )
  );
}

export async function submitGuideHandoff(
  sessionToken,
  payload,
  { signal } = {}
) {
  return unwrap(
    await publicWebsiteClient.post(
      "/public/guide/handoffs",
      payload,
      {
        signal,
        headers: {
          "Content-Type": "application/json",
          ...guideHeaders(sessionToken),
        },
      }
    )
  );
}

export function publicGuideErrorMessage(error) {
  if (
    error?.name === "AbortError" ||
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED"
  ) {
    return "";
  }
  const code = error?.response?.data?.code;
  if (code === "FEATURE_DISABLED") {
    return "Chalin Guide is not enabled in this environment.";
  }
  if (
    code === "PUBLIC_GUIDE_SESSION_EXPIRED" ||
    code === "PUBLIC_GUIDE_SESSION_NOT_FOUND"
  ) {
    return "This Guide session expired. Close and reopen the Guide to start again.";
  }
  if (String(code || "").includes("RATE_LIMIT")) {
    return "The Guide request limit was reached. Please wait before trying again.";
  }
  if (code === "AI_PROVIDER_DISABLED") {
    return "Chalin Guide is safely unavailable while its information provider is disabled.";
  }
  if (code === "AI_GEMINI_API_KEY_REQUIRED") {
    return "Gemini is selected for Chalin Guide but its staging credential is not configured. CHALIN Local can be selected instead.";
  }
  return publicWebsiteErrorMessage(error);
}
