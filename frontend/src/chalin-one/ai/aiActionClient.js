import axiosClient from "../../api/axiosClient";

function responseData(response) {
  return response?.data?.data ?? response?.data ?? {};
}

export async function reviewAiActionProposal({
  proposalKey,
  decision,
  note = null,
} = {}) {
  if (!proposalKey || !["approved", "rejected"].includes(decision)) {
    throw new Error("A proposal key and approved/rejected decision are required.");
  }
  const response = await axiosClient.post(
    `/ai/actions/proposals/${encodeURIComponent(proposalKey)}/decision`,
    {
      decision,
      note: String(note || "").trim() || null,
    }
  );
  return responseData(response);
}

export async function executeAiActionProposal({
  proposalKey,
  confirmation = "",
} = {}) {
  if (!proposalKey) throw new Error("An AI action proposal key is required.");
  const response = await axiosClient.post(
    `/ai/actions/proposals/${encodeURIComponent(proposalKey)}/execute`,
    { confirmation: String(confirmation || "") }
  );
  return responseData(response);
}

export async function cancelAiActionProposal({ proposalKey, note = null } = {}) {
  if (!proposalKey) throw new Error("An AI action proposal key is required.");
  const response = await axiosClient.post(
    `/ai/actions/proposals/${encodeURIComponent(proposalKey)}/cancel`,
    { note: String(note || "").trim() || null }
  );
  return responseData(response);
}

export function actionFromChatResponse(response) {
  const url = String(response?.config?.url || "");
  if (!/(?:^|\/)ai\/(?:copilot|executive)\/chat(?:$|[?#])/i.test(url)) return null;
  const result = responseData(response);
  const action = result?.action;
  if (!action || typeof action !== "object") return null;
  if (!action.proposal_key || !["pending_review", "approved"].includes(action.status)) {
    return null;
  }
  return Object.freeze({
    ...action,
    proposal_key: String(action.proposal_key),
    expected_confirmation: String(action.expected_confirmation || ""),
  });
}
