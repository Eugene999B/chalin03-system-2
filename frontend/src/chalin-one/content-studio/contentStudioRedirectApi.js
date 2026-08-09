import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function safeId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid redirect rule ID is required.");
  }
  return id;
}

export async function listRedirectRules({ signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/navigation/redirects", { signal })
  );
}

export async function createRedirectDraft(payload) {
  return unwrap(
    await axiosClient.post("/content-studio/navigation/redirects", payload)
  );
}

export async function updateRedirectDraft(ruleId, payload) {
  return unwrap(
    await axiosClient.put(
      `/content-studio/navigation/redirects/${safeId(ruleId)}`,
      payload
    )
  );
}

export async function activateRedirectRule(ruleId) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/redirects/${safeId(ruleId)}/activate`,
      {}
    )
  );
}

export async function deactivateRedirectRule(ruleId) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/redirects/${safeId(ruleId)}/deactivate`,
      {}
    )
  );
}

export async function archiveRedirectRule(ruleId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/redirects/${safeId(ruleId)}/archive`,
      { reason }
    )
  );
}
