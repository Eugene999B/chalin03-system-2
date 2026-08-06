import axiosClient from "../../api/axiosClient";

export const CONTENT_STUDIO_RESOURCE_PATHS = Object.freeze({
  dashboard: "/content-studio/dashboard",
  pages: "/content-studio/pages",
  newsroomArticles: "/content-studio/newsroom/article",
  newsroomAnnouncements: "/content-studio/newsroom/announcement",
  leadership: "/content-studio/portfolio/leadership",
  projects: "/content-studio/portfolio/project",
  equipment: "/content-studio/portfolio/equipment",
  divisions: "/content-studio/company-info/division",
  locations: "/content-studio/company-info/location",
  statistics: "/content-studio/company-info/statistic",
  testimonials: "/content-studio/company-info/testimonial",
  faqs: "/content-studio/company-info/faq",
  vacancies: "/content-studio/company-info/vacancy",
  tenders: "/content-studio/company-info/tender",
  media: "/content-studio/media",
  forms: "/content-studio/forms",
  submissions: "/content-studio/submissions",
  navigation: "/content-studio/navigation",
  settings: "/content-studio/settings",
  pageApprovals: "/content-studio/approvals",
  portfolioApprovals: "/content-studio/portfolio/approvals",
  newsroomApprovals: "/content-studio/newsroom/approvals",
  companyInfoApprovals: "/content-studio/company-info/approvals",
  formApprovals: "/content-studio/forms/approvals",
});

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function safeParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) =>
      value !== undefined && value !== null && value !== ""
    )
  );
}

export async function getContentStudioDashboard({ signal } = {}) {
  const response = await axiosClient.get(CONTENT_STUDIO_RESOURCE_PATHS.dashboard, {
    signal,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return unwrap(response) || {};
}

export async function listContentStudioResource(path, params = {}, { signal } = {}) {
  if (!Object.values(CONTENT_STUDIO_RESOURCE_PATHS).includes(path)) {
    throw new Error("Unsupported Content Studio resource path.");
  }
  const response = await axiosClient.get(path, {
    params: safeParams(params),
    signal,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return unwrap(response);
}

export async function getContentStudioApprovalSummary({ signal } = {}) {
  const paths = [
    CONTENT_STUDIO_RESOURCE_PATHS.pageApprovals,
    CONTENT_STUDIO_RESOURCE_PATHS.portfolioApprovals,
    CONTENT_STUDIO_RESOURCE_PATHS.newsroomApprovals,
    CONTENT_STUDIO_RESOURCE_PATHS.companyInfoApprovals,
    CONTENT_STUDIO_RESOURCE_PATHS.formApprovals,
  ];
  const results = await Promise.allSettled(
    paths.map((path) =>
      listContentStudioResource(path, { limit: 20 }, { signal })
    )
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" && Array.isArray(result.value)
      ? result.value
      : result.status === "fulfilled" && Array.isArray(result.value?.items)
        ? result.value.items
        : []
  );
}

export function contentStudioErrorMessage(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") return "";
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Content Studio information could not be loaded safely."
  );
}
