import axiosClient from "../../api/axiosClient";

const COMPANY_INFO_KINDS = Object.freeze([
  "division",
  "location",
  "statistic",
  "testimonial",
  "faq",
  "vacancy",
  "tender",
]);

function assertKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!COMPANY_INFO_KINDS.includes(normalized)) {
    throw new Error("Unsupported Content Studio company-information manager.");
  }
  return normalized;
}

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function listCompanyInfoEntities(kind, params = {}, { signal } = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.get(`/content-studio/company-info/${safeKind}`, {
      params,
      signal,
    })
  );
}

export async function getCompanyInfoEntity(kind, entityId, { signal } = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.get(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}`,
      { signal }
    )
  );
}

export async function createCompanyInfoEntity(kind, payload) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(`/content-studio/company-info/${safeKind}`, payload)
  );
}

export async function createCompanyInfoVersion(kind, entityId, payload = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/versions`,
      payload
    )
  );
}

export async function updateCompanyInfoDraft(kind, entityId, versionId, payload) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.put(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}`,
      payload
    )
  );
}

export async function submitCompanyInfoVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/submit`,
      payload
    )
  );
}

export async function decideCompanyInfoApproval(kind, approvalId, payload) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/approvals/${Number(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishCompanyInfoVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/publish`,
      payload
    )
  );
}

export async function restoreCompanyInfoVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/versions/${Number(versionId)}/restore`,
      payload
    )
  );
}

export async function archiveCompanyInfoEntity(kind, entityId, payload = {}) {
  const safeKind = assertKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/company-info/${safeKind}/${Number(entityId)}/archive`,
      payload
    )
  );
}

export { COMPANY_INFO_KINDS };
