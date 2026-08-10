export const PUBLIC_TOP_LEVEL_PATHS = Object.freeze([
  "about",
  "businesses",
  "projects",
  "equipment",
  "news",
  "leadership",
  "media",
  "careers",
  "locations",
  "contact",
  "faqs",
  "tenders",
  "testimonials",
  "forms",
  "pages",
  "website",
]);

const PUBLIC_TOP_LEVEL_PATH_SET = new Set(PUBLIC_TOP_LEVEL_PATHS);

export const PUBLIC_RELEASE_SMOKE_PATHS = Object.freeze([
  "/",
  "/about",
  "/businesses",
  "/businesses/spare-parts",
  "/projects",
  "/equipment",
  "/news",
  "/leadership",
  "/media",
  "/careers",
  "/locations",
  "/contact",
  "/faqs",
  "/tenders",
]);

export function isPublicWebsitePath(pathname) {
  const path = String(pathname || "").split(/[?#]/)[0] || "/";
  if (path === "/") return true;
  const firstSegment = path.replace(/^\/+/, "").split("/")[0];
  return PUBLIC_TOP_LEVEL_PATH_SET.has(firstSegment);
}

export function isChalinOneStandalonePath(pathname) {
  const path = String(pathname || "").split(/[?#]/)[0] || "/";
  return (
    isPublicWebsitePath(path) ||
    path === "/content-studio" ||
    path.startsWith("/content-studio/") ||
    path === "/intelligence" ||
    path.startsWith("/intelligence/")
  );
}
