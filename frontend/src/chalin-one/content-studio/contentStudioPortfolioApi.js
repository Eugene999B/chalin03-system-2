import axiosClient from "../../api/axiosClient";

const PORTFOLIO_KINDS = Object.freeze(["leadership", "project", "equipment"]);

function assertKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!PORTFOLIO_KINDS.includes(normalized)) {
    throw new Error("Unsupported Content Studio portfolio manager.");
  }
  return normalized;
}

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function listPortfolioEntities(kind, params = {}, { signal } = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.get(`/content-studio/portfolio/${safeKind}`, {
      params,
      signal,
    })
  );
}

export async function getPortfolioEntity(kind, entityId, { signal } = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.get(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}`,
      { signal }
    )
  );
}

export async function createPortfolioEntity(kind, payload) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(`/content-studio/portfolio/${safeKind}`, payload)
  );
}

export async function createPortfolioVersion(kind, entityId, payload = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/versions`,
      payload
    )
  );
}

export async function updatePortfolioDraft(
  kind,
  entityId,
  versionId,
  payload
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.put(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}`,
      payload
    )
  );
}

export async function submitPortfolioVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/submit`,
      payload
    )
  );
}

export async function decidePortfolioApproval(kind, approvalId, payload) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/approvals/${Number(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishPortfolioVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/publish`,
      payload
    )
  );
}

export async function restorePortfolioVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/restore`,
      payload
    )
  );
}

export async function archivePortfolioEntity(kind, entityId, payload = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/portfolio/${safeKind}/${Number(entityId)}/archive`,
      payload
    )
  );
}

export { PORTFOLIO_KINDS };
