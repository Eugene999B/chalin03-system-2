import axiosClient from "../../api/axiosClient";

const BASE_PATH = "/content-studio/dashboard/intelligence";

function unwrap(response) {
  return response?.data?.data || response?.data || {};
}

export async function getContentStudioAiStatus({ signal } = {}) {
  const response = await axiosClient.get(`${BASE_PATH}/status`, {
    signal,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return unwrap(response);
}

export async function askContentStudioAi(question, { signal } = {}) {
  const response = await axiosClient.post(
    `${BASE_PATH}/ask`,
    { question: String(question || "").trim().slice(0, 1800) },
    { signal }
  );
  return unwrap(response);
}

export function contentStudioAiErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "CHALIN Studio could not complete the request safely."
  );
}
