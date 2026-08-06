import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function safeId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("A valid Content Studio record ID is required.");
  }
  return number;
}

function safeQuery(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) =>
      value !== undefined && value !== null && value !== ""
    )
  );
}

export async function listMedia(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/media", {
      params: safeQuery(params),
      signal,
    })
  );
}

export async function listMediaFolders({ signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/media/folders", { signal })
  );
}

export async function createMediaFolder(payload) {
  return unwrap(
    await axiosClient.post("/content-studio/media/folders", payload)
  );
}

export async function updateMediaFolder(folderId, payload) {
  return unwrap(
    await axiosClient.patch(
      `/content-studio/media/folders/${safeId(folderId)}`,
      payload
    )
  );
}

export async function archiveMediaFolder(folderId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/media/folders/${safeId(folderId)}/archive`,
      { reason }
    )
  );
}

export async function uploadMediaImage(file, metadata = {}, { signal } = {}) {
  if (!(file instanceof Blob)) {
    throw new Error("Choose a JPEG, PNG or WebP image.");
  }
  const headers = {
    "Content-Type": file.type,
    "x-media-filename": file.name || "image",
    "x-media-display-name": metadata.display_name || file.name || "Image",
    "x-media-alt-text": metadata.alt_text || "",
    "x-media-caption": metadata.caption || "",
    "x-media-credit": metadata.credit || "",
    "x-media-folder-id": metadata.folder_id || "",
  };
  return unwrap(
    await axiosClient.post("/content-studio/media/images", file, {
      headers,
      signal,
      transformRequest: [(body) => body],
    })
  );
}

export async function registerMediaVideo(payload) {
  return unwrap(
    await axiosClient.post("/content-studio/media/videos", payload)
  );
}

export async function getMediaUsage(assetId, { signal } = {}) {
  return unwrap(
    await axiosClient.get(
      `/content-studio/media/${safeId(assetId)}/usage`,
      { signal }
    )
  );
}

export async function updateMediaAsset(assetId, payload) {
  return unwrap(
    await axiosClient.patch(
      `/content-studio/media/${safeId(assetId)}`,
      payload
    )
  );
}

export async function archiveMediaAsset(assetId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/media/${safeId(assetId)}/archive`,
      { reason }
    )
  );
}

export async function listForms(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/forms", {
      params: safeQuery(params),
      signal,
    })
  );
}

export async function getForm(formId, { signal } = {}) {
  return unwrap(
    await axiosClient.get(`/content-studio/forms/${safeId(formId)}`, { signal })
  );
}

export async function createForm(payload) {
  return unwrap(await axiosClient.post("/content-studio/forms", payload));
}

export async function createFormVersion(formId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/${safeId(formId)}/versions`,
      payload
    )
  );
}

export async function updateFormDraft(formId, versionId, payload) {
  return unwrap(
    await axiosClient.put(
      `/content-studio/forms/${safeId(formId)}/versions/${safeId(versionId)}`,
      payload
    )
  );
}

export async function submitFormVersion(formId, versionId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/${safeId(formId)}/versions/${safeId(versionId)}/submit`,
      payload
    )
  );
}

export async function decideFormApproval(approvalId, payload) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/approvals/${safeId(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishFormVersion(formId, versionId) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/${safeId(formId)}/versions/${safeId(versionId)}/publish`,
      {}
    )
  );
}

export async function restoreFormVersion(formId, versionId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/${safeId(formId)}/versions/${safeId(versionId)}/restore`,
      { reason }
    )
  );
}

export async function archiveForm(formId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/forms/${safeId(formId)}/archive`,
      { reason }
    )
  );
}

export async function listSubmissions(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/submissions", {
      params: safeQuery(params),
      signal,
    })
  );
}

export async function getSubmission(submissionId, { signal } = {}) {
  return unwrap(
    await axiosClient.get(
      `/content-studio/submissions/${safeId(submissionId)}`,
      { signal }
    )
  );
}

export async function assignSubmission(submissionId, assignedTo) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/submissions/${safeId(submissionId)}/assign`,
      { assigned_to: safeId(assignedTo) }
    )
  );
}

export async function reviewSubmission(submissionId, note, status) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/submissions/${safeId(submissionId)}/review`,
      { note, status }
    )
  );
}

export async function changeSubmissionStatus(submissionId, status, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/submissions/${safeId(submissionId)}/status`,
      { status, reason }
    )
  );
}

const APPROVAL_SOURCES = Object.freeze([
  Object.freeze({ source: "page", path: "/content-studio/approvals" }),
  Object.freeze({ source: "portfolio", path: "/content-studio/portfolio/approvals" }),
  Object.freeze({ source: "newsroom", path: "/content-studio/newsroom/approvals" }),
  Object.freeze({ source: "company_info", path: "/content-studio/company-info/approvals" }),
  Object.freeze({ source: "form", path: "/content-studio/forms/approvals" }),
  Object.freeze({ source: "navigation", path: "/content-studio/navigation/approvals" }),
]);

function approvalKind(source, approval) {
  const entityType = String(approval?.entity_type || "").toLowerCase();
  if (source === "portfolio") {
    if (entityType.includes("leadership")) return "leadership";
    if (entityType.includes("equipment")) return "equipment";
    return "project";
  }
  if (source === "newsroom") {
    return entityType.includes("announcement") ? "announcement" : "article";
  }
  if (source === "company_info") {
    const mapping = {
      business_division: "division",
      location: "location",
      company_statistic: "statistic",
      testimonial: "testimonial",
      faq: "faq",
      job_vacancy: "vacancy",
      tender: "tender",
    };
    return mapping[entityType] || approval?.kind || "division";
  }
  return null;
}

export async function listAllApprovals(params = {}, { signal } = {}) {
  const settled = await Promise.allSettled(
    APPROVAL_SOURCES.map(async (definition) => {
      const response = await axiosClient.get(definition.path, {
        params: safeQuery(params),
        signal,
      });
      const data = unwrap(response);
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];
      return items.map((item) => ({
        ...item,
        approval_source: definition.source,
        approval_kind: approvalKind(definition.source, item),
      }));
    })
  );
  return {
    items: settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    ),
    unavailable_sources: settled
      .map((result, index) =>
        result.status === "rejected" ? APPROVAL_SOURCES[index].source : null
      )
      .filter(Boolean),
  };
}

export async function decideApproval(approval, decision, note = "") {
  const id = safeId(approval?.id);
  const source = approval?.approval_source;
  const kind = approval?.approval_kind;
  let path;
  if (source === "page") path = `/content-studio/approvals/${id}/decision`;
  if (source === "portfolio") {
    path = `/content-studio/portfolio/${kind}/approvals/${id}/decision`;
  }
  if (source === "newsroom") {
    path = `/content-studio/newsroom/${kind}/approvals/${id}/decision`;
  }
  if (source === "company_info") {
    path = `/content-studio/company-info/${kind}/approvals/${id}/decision`;
  }
  if (source === "form") {
    path = `/content-studio/forms/approvals/${id}/decision`;
  }
  if (source === "navigation") {
    path = `/content-studio/navigation/approvals/${id}/decision`;
  }
  if (!path) throw new Error("Unsupported Content Studio approval source.");
  return unwrap(await axiosClient.post(path, { decision, note }));
}

export async function listNavigation({ signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/navigation", { signal })
  );
}

export async function createNavigation(payload) {
  return unwrap(await axiosClient.post("/content-studio/navigation", payload));
}

export async function createNavigationVersion(itemId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/${safeId(itemId)}/versions`,
      payload
    )
  );
}

export async function updateNavigationDraft(itemId, versionId, payload) {
  return unwrap(
    await axiosClient.put(
      `/content-studio/navigation/${safeId(itemId)}/versions/${safeId(versionId)}`,
      payload
    )
  );
}

export async function submitNavigationVersion(itemId, versionId, payload = {}) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/${safeId(itemId)}/versions/${safeId(versionId)}/submit`,
      payload
    )
  );
}

export async function decideNavigationApproval(approvalId, payload) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/approvals/${safeId(approvalId)}/decision`,
      payload
    )
  );
}

export async function publishNavigationVersion(itemId, versionId) {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/${safeId(itemId)}/versions/${safeId(versionId)}/publish`,
      {}
    )
  );
}

export async function archiveNavigation(itemId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/navigation/${safeId(itemId)}/archive`,
      { reason }
    )
  );
}

export async function listSettings(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/settings", {
      params: safeQuery(params),
      signal,
    })
  );
}

export async function createSetting(payload) {
  return unwrap(await axiosClient.post("/content-studio/settings", payload));
}

export async function updateSetting(settingId, payload) {
  return unwrap(
    await axiosClient.put(
      `/content-studio/settings/${safeId(settingId)}`,
      payload
    )
  );
}

export async function deactivateSetting(settingId, reason = "") {
  return unwrap(
    await axiosClient.post(
      `/content-studio/settings/${safeId(settingId)}/deactivate`,
      { reason }
    )
  );
}

export { APPROVAL_SOURCES };
