import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function listPages(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/pages", { params, signal })
  );
}

export async function getPage(pageId, { signal } = {}) {
  return unwrap(
    await axiosClient.get(`/content-studio/pages/${Number(pageId)}`, { signal })
  );
}

export async function createPage(payload) {
  return unwrap(await axiosClient.post("/content-studio/pages", payload));
}

export async function createPageVersion(pageId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/pages/${Number(pageId)}/versions`,
      payload
    )
  );
}

export async function updatePageDraft(pageId, versionId, payload) {
  return unwrap(
    await axiosClient.put(
      `/content-studio/pages/${Number(pageId)}/versions/${Number(versionId)}`,
      payload
    )
  );
}

export async function submitPageVersion(pageId, versionId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/pages/${Number(pageId)}/versions/${Number(versionId)}/submit`,
      payload
    )
  );
}

export async function decidePageApproval(approvalId, payload) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/approvals/${Number(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishPageVersion(pageId, versionId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/pages/${Number(pageId)}/versions/${Number(versionId)}/publish`,
      payload
    )
  );
}

export async function restorePageVersion(pageId, versionId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/pages/${Number(pageId)}/versions/${Number(versionId)}/restore`,
      payload
    )
  );
}

export async function archivePage(pageId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/pages/${Number(pageId)}/archive`,
      payload
    )
  );
}
