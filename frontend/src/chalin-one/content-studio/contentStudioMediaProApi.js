import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function safeQuery(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) =>
      value !== undefined && value !== null && value !== ""
    )
  );
}

export async function listMediaPro(params = {}, { signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/media", {
      params: safeQuery(params),
      signal,
    })
  );
}

export async function getMediaLibraryIntelligence({ signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/media/intelligence", { signal })
  );
}
