import { publicWebsiteClient } from "./publicWebsiteApi";

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function recordPublicPageView(pathname, { signal } = {}) {
  const path = String(pathname || "").trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;

  return unwrap(
    await publicWebsiteClient.post(
      "/public/analytics/page-view",
      { path },
      {
        signal,
        headers: { "Content-Type": "application/json" },
      }
    )
  );
}

export async function getPublicDataUseDisclosure({ signal } = {}) {
  return unwrap(
    await publicWebsiteClient.get("/public/analytics/disclosure", { signal })
  );
}
