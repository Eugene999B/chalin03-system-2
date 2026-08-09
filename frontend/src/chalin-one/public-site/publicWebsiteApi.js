import axios from "axios";
import {
  applyPublishedPublicMetadata,
} from "./publicMetadataRuntime";
import {
  installPublicRedirectRuntime,
} from "./publicRedirectRuntime";

const publicWebsiteClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 20000,
  headers: {
    Accept: "application/json",
  },
});

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

export async function getPublicBootstrap({ signal } = {}) {
  return unwrap(
    await publicWebsiteClient.get("/public/content/bootstrap", { signal })
  );
}

export async function getPublicHomepage({ signal } = {}) {
  try {
    const page = unwrap(
      await publicWebsiteClient.get("/public/content/homepage", { signal })
    );
    if (page) applyPublishedPublicMetadata(page);
    return page;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

export async function getPublicPage(slug, { signal } = {}) {
  const page = unwrap(
    await publicWebsiteClient.get(
      `/public/content/pages/${encodeURIComponent(slug)}`,
      { signal }
    )
  );
  if (page) applyPublishedPublicMetadata(page);
  return page;
}

export async function listPublicResource(resource, params = {}, { signal } = {}) {
  const supported = new Set([
    "news",
    "divisions",
    "leadership",
    "projects",
    "equipment",
    "locations",
    "faqs",
    "vacancies",
    "tenders",
    "testimonials",
  ]);
  if (!supported.has(resource)) {
    throw new Error("Unsupported public website resource.");
  }
  return unwrap(
    await publicWebsiteClient.get(`/public/content/${resource}`, {
      params: cleanParams(params),
      signal,
    })
  );
}

export async function getPublicResource(resource, slug, { signal } = {}) {
  const supported = new Set([
    "news",
    "divisions",
    "projects",
    "equipment",
    "vacancies",
    "tenders",
  ]);
  if (!supported.has(resource)) {
    throw new Error("Unsupported public website detail resource.");
  }
  const item = unwrap(
    await publicWebsiteClient.get(
      `/public/content/${resource}/${encodeURIComponent(slug)}`,
      { signal }
    )
  );
  if (item) {
    applyPublishedPublicMetadata(item, {
      type: resource === "news" ? "article" : "website",
    });
  }
  return item;
}

export async function getPublicForm(slug, { signal } = {}) {
  const form = unwrap(
    await publicWebsiteClient.get(
      `/public/content/forms/${encodeURIComponent(slug)}`,
      { signal }
    )
  );
  if (form) applyPublishedPublicMetadata(form);
  return form;
}

export async function resolvePublicRedirect(pathname, { signal } = {}) {
  const path = String(pathname || "").trim();
  if (!/^\/(?!\/)/.test(path)) return null;
  return unwrap(
    await publicWebsiteClient.get("/public/redirects/resolve", {
      params: { path },
      signal,
    })
  );
}

export async function submitPublicForm(slug, payload) {
  return unwrap(
    await publicWebsiteClient.post(
      `/public/content/forms/${encodeURIComponent(slug)}/submissions`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
  );
}

export function publicWebsiteErrorMessage(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") {
    return "";
  }
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) {
    return details.join(" ");
  }
  return (
    error?.response?.data?.message ||
    error?.message ||
    "The public website information could not be loaded safely."
  );
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installPublicRedirectRuntime(resolvePublicRedirect);
}

export { publicWebsiteClient };
