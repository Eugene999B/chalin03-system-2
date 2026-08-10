import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function getContextualAiStatus({ signal } = {}) {
  const response = await axiosClient.get("/ai/status", {
    signal,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  return unwrap(response) || {};
}

export async function sendContextualAiMessage(
  persona,
  { contextKey, conversationKey = null, message },
  { signal } = {}
) {
  if (!["copilot", "executive"].includes(persona)) {
    throw new Error("Unsupported contextual CHALIN persona.");
  }
  const response = await axiosClient.post(
    `/ai/${persona}/chat`,
    {
      context_key: contextKey,
      conversation_key: conversationKey || null,
      message,
    },
    { signal }
  );
  return unwrap(response) || null;
}

export function contextualAiErrorMessage(error) {
  if (
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError"
  ) {
    return "";
  }
  const code = String(error?.response?.data?.code || "");
  if (code === "AI_CONTEXT_PROFILE_NOT_FOUND") {
    return "This CHALIN intelligence context is not available.";
  }
  if (
    code === "AI_CONTEXT_WORKSPACE_MISMATCH" ||
    code === "AI_CONTEXT_EQUIPMENT_DIVISION_DENIED"
  ) {
    return "This CHALIN intelligence context is outside your active workspace or division.";
  }
  if (
    code === "AI_BRANCH_SCOPE_REQUIRED" ||
    code === "AI_MINING_SITE_SCOPE_REQUIRED" ||
    code === "AI_HIRE_LOCATION_SCOPE_REQUIRED"
  ) {
    return "Choose the required authorized branch, mining site or hire location before asking CHALIN about this page.";
  }
  if (
    code === "AI_TOOL_BUSINESS_PERMISSION_DENIED" ||
    code === "AI_TOOL_PERMISSION_DENIED"
  ) {
    return "Your account does not have permission to read the live intelligence needed for this answer.";
  }
  return (
    error?.response?.data?.message ||
    error?.message ||
    "CHALIN could not complete this contextual intelligence request safely."
  );
}
