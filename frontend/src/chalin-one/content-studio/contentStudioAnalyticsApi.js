import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function getContentStudioPublicAnalytics(days = 30, { signal } = {}) {
  const response = await axiosClient.get("/content-studio/dashboard/analytics/summary", {
    params: { days },
    signal,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return unwrap(response) || {};
}
