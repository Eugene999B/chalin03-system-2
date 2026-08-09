import axiosClient from "../../api/axiosClient";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function getWebsiteControlIntelligence({ signal } = {}) {
  return unwrap(
    await axiosClient.get("/content-studio/pages/website-control", { signal })
  );
}
