import axios from "axios";

const guideClient = axios.create({
  baseURL: "/api/public/guide",
  timeout: 20000,
  withCredentials: false,
  headers: {
    Accept: "application/json",
  },
});

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function guideConfig(sessionToken, config = {}) {
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      ...(sessionToken
        ? { "x-chalin-guide-session": sessionToken }
        : {}),
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  };
}

export async function createGuideSession({ signal } = {}) {
  const response = await guideClient.post(
    "/sessions",
    {},
    guideConfig(null, { signal })
  );
  return unwrap(response) || null;
}

export async function getGuideHistory(sessionToken, { signal } = {}) {
  const response = await guideClient.get(
    "/history",
    guideConfig(sessionToken, { signal })
  );
  return unwrap(response) || null;
}

export async function sendGuideMessage(
  sessionToken,
  message,
  { signal } = {}
) {
  const response = await guideClient.post(
    "/messages",
    { message },
    guideConfig(sessionToken, { signal })
  );
  return unwrap(response) || null;
}

export async function submitGuideHandoff(
  sessionToken,
  payload,
  { signal } = {}
) {
  const response = await guideClient.post(
    "/handoffs",
    payload,
    guideConfig(sessionToken, { signal })
  );
  return unwrap(response) || null;
}

export function publicGuideErrorMessage(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") {
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
  if (code?.includes("RATE_LIMIT")) {
    return "The Guide request limit was reached. Please wait before trying again.";
  }
  if (code === "AI_PROVIDER_DISABLED") {
    return "Chalin Guide is safely unavailable while its information provider is disabled.";
  }
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Chalin Guide could not complete the request safely."
  );
}

export { guideClient };
