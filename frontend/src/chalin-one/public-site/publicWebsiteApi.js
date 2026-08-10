import {
  applyPublishedPublicMetadata,
} from "./publicMetadataRuntime";
import {
  applyPublishedPublicStructuredData,
} from "./publicStructuredDataRuntime";
import {
  installPublicRedirectRuntime,
} from "./publicRedirectRuntime";

const PUBLIC_API_BASE = String(
  import.meta.env.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/+$/, "");
const PUBLIC_REQUEST_TIMEOUT_MS = 20000;

function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

function publicRequestUrl(pathname, params = {}) {
  const base = PUBLIC_API_BASE.endsWith("/") ? PUBLIC_API_BASE : `${PUBLIC_API_BASE}/`;
  const relativePath = String(pathname || "").replace(/^\/+/, "");
  const url = new URL(relativePath, base);
  for (const [key, value] of Object.entries(cleanParams(params))) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function createPublicRequestError(response, payload) {
  const message =
    payload?.message ||
    `Public website request failed with status ${response.status}.`;
  const error = new Error(message);
  error.name = "PublicWebsiteRequestError";
  error.response = {
    status: response.status,
    data: payload,
  };
  return error;
}

async function parsePublicResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function publicWebsiteRequest(
  pathname,
  {
    method = "GET",
    params,
    signal,
    body,
    headers = {},
    timeoutMs = PUBLIC_REQUEST_TIMEOUT_MS,
  } = {}
) {
  const controller = new AbortController();
  let timedOut = false;

  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else if (signal) {
    signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(publicRequestUrl(pathname, params), {
      method,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...headers,
      },
      body:
        body === undefined || body === null
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });

    const payload = await parsePublicResponse(response);
    if (!response.ok) throw createPublicRequestError(response, payload);
    return { data: payload };
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error("The public website request timed out.");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
}

const publicWebsiteClient = Object.freeze({
  get(pathname, options = {}) {
    return publicWebsiteRequest(pathname, {
      ...options,
      method: "GET",
    });
  },
  post(pathname, body, options = {}) {
    return publicWebsiteRequest(pathname, {
      ...options,
      method: "POST",
      body,
    });
  },
});

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function applyPublishedRouteSeo(data, options = {}) {
  if (!data) return data;
  applyPublishedPublicMetadata(data, options);
  applyPublishedPublicStructuredData(data, options);
  return data;
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
    return applyPublishedRouteSeo(page);
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
  return applyPublishedRouteSeo(page);
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
  return applyPublishedRouteSeo(item, {
    type: resource === "news" ? "article" : "website",
  });
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
  if (
    error?.name === "AbortError" ||
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED"
  ) {
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

export {
  PUBLIC_API_BASE,
  PUBLIC_REQUEST_TIMEOUT_MS,
  publicRequestUrl,
  publicWebsiteClient,
  publicWebsiteRequest,
};
