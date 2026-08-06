import axiosClient from "../../api/axiosClient";

const NEWSROOM_KINDS = new Set(["article", "announcement"]);

function safeKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!NEWSROOM_KINDS.has(normalized)) {
    throw new Error("Unsupported Newsroom manager.");
  }
  return normalized;
}

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function listNewsroomEntities(kind, params = {}, { signal } = {}) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.get(`/content-studio/newsroom/${normalizedKind}`, {
      params,
      signal,
    })
  );
}

export async function getNewsroomEntity(kind, entityId, { signal } = {}) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.get(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}`,
      { signal }
    )
  );
}

export async function createNewsroomEntity(kind, payload) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}`,
      payload
    )
  );
}

export async function createNewsroomVersion(kind, entityId, payload = {}) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/versions`,
      payload
    )
  );
}

export async function updateNewsroomDraft(
  kind,
  entityId,
  versionId,
  payload
) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.put(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/versions/${Number(versionId)}`,
      payload
    )
  );
}

export async function submitNewsroomVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/versions/${Number(versionId)}/submit`,
      payload
    )
  );
}

export async function decideNewsroomApproval(
  kind,
  approvalId,
  payload
) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/approvals/${Number(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishNewsroomVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/versions/${Number(versionId)}/publish`,
      payload
    )
  );
}

export async function restoreNewsroomVersion(
  kind,
  entityId,
  versionId,
  payload = {}
) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/versions/${Number(versionId)}/restore`,
      payload
    )
  );
}

export async function archiveNewsroomEntity(kind, entityId, payload = {}) {
  const normalizedKind = safeKind(kind);
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/${normalizedKind}/${Number(entityId)}/archive`,
      payload
    )
  );
}

export async function listNewsCategories(
  { includeInactive = true } = {},
  { signal } = {}
) {
  return unwrap(
    await axiosClient.get("/content-studio/newsroom/categories", {
      params: { include_inactive: includeInactive },
      signal,
    })
  );
}

export async function createNewsCategory(payload) {
  return unwrap(
    await axiosClient.post("/content-studio/newsroom/categories", payload)
  );
}

export async function updateNewsCategory(categoryId, payload) {
  return unwrap(
    await axiosClient.patch(
      `/content-studio/newsroom/categories/${Number(categoryId)}`,
      payload
    )
  );
}

export async function archiveNewsCategory(categoryId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/newsroom/categories/${Number(categoryId)}/archive`,
      payload
    )
  );
}
