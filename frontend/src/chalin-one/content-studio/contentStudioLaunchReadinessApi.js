import axiosClient from "../../api/axiosClient";

function safeMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Readiness signal unavailable."
  );
}

function normalizeSettled(result) {
  if (result.status === "fulfilled") {
    return { ok: true, data: result.value?.data || {} };
  }
  return { ok: false, data: null, error: safeMessage(result.reason) };
}

export async function getContentStudioLaunchReadiness({ signal } = {}) {
  const config = {
    signal,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  };

  const [readiness, publicFeatures, publicBootstrap, analyticsDisclosure] =
    await Promise.allSettled([
      axiosClient.get("/readiness", config),
      axiosClient.get("/features/public", config),
      axiosClient.get("/public/content/bootstrap", config),
      axiosClient.get("/public/analytics/disclosure", config),
    ]);

  return {
    readiness: normalizeSettled(readiness),
    publicFeatures: normalizeSettled(publicFeatures),
    publicBootstrap: normalizeSettled(publicBootstrap),
    analyticsDisclosure: normalizeSettled(analyticsDisclosure),
  };
}
