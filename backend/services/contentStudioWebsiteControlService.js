"use strict";

const { pool } = require("../config/db");
const {
  booleanValue,
  schemaNotReadyError,
} = require("./contentStudioPageService");

const STATIC_PUBLIC_PATHS = Object.freeze(new Set([
  "/",
  "/about",
  "/businesses",
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
  "/testimonials",
]));

const DYNAMIC_PUBLIC_PREFIXES = Object.freeze([
  "/businesses/",
  "/projects/",
  "/equipment/",
  "/news/",
  "/careers/",
  "/tenders/",
  "/forms/",
  "/pages/",
]);

const SEVERITY_WEIGHT = Object.freeze({
  critical: 12,
  warning: 4,
  info: 1,
});

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePublicPath(value) {
  const raw = clean(value);
  if (!raw || !/^\/(?!\/)/.test(raw)) return null;
  try {
    const parsed = new URL(raw, "https://chalin.invalid");
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return null;
  }
}

function pagePublicPath(page = {}) {
  if (booleanValue(page.is_homepage)) return "/";
  const slug = clean(page.slug).replace(/^\/+|\/+$/g, "");
  return slug ? `/${slug}` : null;
}

function canonicalInfo(value) {
  const raw = clean(value);
  if (!raw) {
    return { configured: false, valid: false, normalized: null, path: null, host: null };
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return { configured: true, valid: false, normalized: null, path: null, host: null };
    }
    const pathname = normalizePublicPath(parsed.pathname) || "/";
    parsed.hash = "";
    return {
      configured: true,
      valid: true,
      normalized: parsed.toString(),
      path: pathname,
      host: parsed.hostname.toLowerCase(),
    };
  } catch {
    return { configured: true, valid: false, normalized: null, path: null, host: null };
  }
}

function robotsTokens(value) {
  return new Set(
    clean(value || "index,follow")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
  );
}

function issue(severity, code, message, area = "seo") {
  return { severity, code, message, area };
}

function pageSummary(page = {}) {
  return {
    id: Number(page.id),
    page_key: page.page_key,
    slug: page.slug,
    title: page.title || page.latest_title || page.menu_title || page.page_key,
    publication_status: page.publication_status,
    latest_version_id: page.latest_version_id ? Number(page.latest_version_id) : null,
    latest_version_status: page.latest_version_status || null,
    is_homepage: booleanValue(page.is_homepage),
    show_in_search: booleanValue(page.show_in_search),
    show_in_sitemap: booleanValue(page.show_in_sitemap),
    public_path: pagePublicPath(page),
  };
}

function evaluatePageSeo(page = {}) {
  const record = pageSummary(page);
  const issues = [];
  const title = clean(page.seo_title);
  const description = clean(page.meta_description);
  const canonical = canonicalInfo(page.canonical_url);
  const robots = robotsTokens(page.robots_directive);

  if (!record.latest_version_id) {
    issues.push(issue("critical", "PAGE_VERSION_MISSING", "This page has no saved version to publish."));
  }
  if (!title) {
    issues.push(issue("warning", "SEO_TITLE_MISSING", "No explicit SEO title is configured; the website must fall back to the page title."));
  } else if (title.length > 70) {
    issues.push(issue("warning", "SEO_TITLE_LONG", `SEO title is ${title.length} characters; review it for concise search presentation.`));
  }
  if (!description) {
    issues.push(issue("warning", "META_DESCRIPTION_MISSING", "No explicit meta description is configured."));
  } else if (description.length > 180) {
    issues.push(issue("warning", "META_DESCRIPTION_LONG", `Meta description is ${description.length} characters; review it for concise search presentation.`));
  }
  if (!canonical.configured) {
    issues.push(issue("warning", "CANONICAL_MISSING", "No explicit HTTPS canonical URL is configured."));
  } else if (!canonical.valid) {
    issues.push(issue("warning", "CANONICAL_INVALID", "Canonical URL must be an absolute HTTPS URL without embedded credentials."));
  }

  const noindex = robots.has("noindex");
  const index = robots.has("index") && !noindex;
  if (record.show_in_search && noindex) {
    issues.push(issue("critical", "SEARCH_NOINDEX_CONFLICT", "Search visibility is enabled but the robots directive contains noindex.", "indexing"));
  }
  if (record.show_in_sitemap && noindex) {
    issues.push(issue("warning", "SITEMAP_NOINDEX_CONFLICT", "Sitemap visibility is enabled while the robots directive contains noindex.", "indexing"));
  }
  if (!record.show_in_search && index) {
    issues.push(issue("info", "SEARCH_HIDDEN_BUT_INDEX", "Studio search visibility is disabled while the robots directive still allows indexing.", "indexing"));
  }

  return {
    ...record,
    seo_title: title,
    meta_description: description,
    canonical_url: clean(page.canonical_url) || null,
    canonical,
    robots_directive: clean(page.robots_directive) || "index,follow",
    issues,
  };
}

function directUrlKind(value) {
  const raw = clean(value);
  if (!raw) return "empty";
  if (/^\/(?!\/)/.test(raw)) return "internal";
  if (/^(mailto:|tel:)/i.test(raw)) return "contact";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? "external" : "invalid";
  } catch {
    return "invalid";
  }
}

function navigationSummary(item = {}) {
  return {
    id: Number(item.id),
    navigation_key: item.navigation_key,
    label: item.label,
    navigation_location: item.navigation_location,
    publication_status: item.publication_status,
    parent_id: item.parent_id ? Number(item.parent_id) : null,
    page_id: item.page_id ? Number(item.page_id) : null,
    url: item.url || null,
    is_visible: item.is_visible === undefined ? true : booleanValue(item.is_visible),
  };
}

function evaluateNavigationTarget(item = {}, pageMap = new Map(), pathMap = new Map(), navigationMap = new Map()) {
  const record = navigationSummary(item);
  const issues = [];
  const targetPage = record.page_id ? pageMap.get(record.page_id) || null : null;
  const parent = record.parent_id ? navigationMap.get(record.parent_id) || null : null;
  const urlKind = directUrlKind(record.url);
  const internalPath = urlKind === "internal" ? normalizePublicPath(record.url) : null;
  const directPage = internalPath ? pathMap.get(internalPath) || null : null;

  if (record.page_id && record.url) {
    issues.push(issue("warning", "NAVIGATION_DUAL_TARGET", "This navigation item has both a page target and a direct URL. Keep one authoritative target.", "navigation"));
  }
  if (!record.page_id && !record.url) {
    issues.push(issue("critical", "NAVIGATION_TARGET_MISSING", "This navigation item has no page or URL target.", "navigation"));
  }

  if (record.page_id) {
    if (!targetPage) {
      issues.push(issue("critical", "NAVIGATION_PAGE_MISSING", "The linked website page no longer exists.", "navigation"));
    } else if (targetPage.publication_status === "archived") {
      issues.push(issue("critical", "NAVIGATION_PAGE_ARCHIVED", "The linked website page is archived.", "navigation"));
    } else if (record.publication_status === "published" && targetPage.publication_status !== "published") {
      issues.push(issue("warning", "NAVIGATION_PAGE_NOT_PUBLISHED", `Published navigation points to a ${targetPage.publication_status || "non-published"} page.`, "navigation"));
    }
  }

  if (record.parent_id) {
    if (!parent) {
      issues.push(issue("warning", "NAVIGATION_PARENT_MISSING", "The configured parent navigation item no longer exists.", "navigation"));
    } else if (parent.publication_status === "archived") {
      issues.push(issue("warning", "NAVIGATION_PARENT_ARCHIVED", "This item is nested under an archived navigation parent.", "navigation"));
    }
  }

  if (record.url) {
    if (urlKind === "invalid") {
      issues.push(issue("warning", "NAVIGATION_URL_INVALID", "The direct URL is not a recognized relative, HTTP, HTTPS, email or telephone target.", "navigation"));
    }
    if (urlKind === "internal" && internalPath) {
      if (directPage && !record.page_id) {
        issues.push(issue("info", "NAVIGATION_PAGE_BINDING_RECOMMENDED", `This direct URL matches page ${directPage.page_key}; bind the navigation item to the page record for stronger governance.`, "navigation"));
      } else if (!directPage && !STATIC_PUBLIC_PATHS.has(internalPath)) {
        const dynamic = DYNAMIC_PUBLIC_PREFIXES.some((prefix) => internalPath.startsWith(prefix));
        issues.push(
          dynamic
            ? issue("info", "NAVIGATION_DYNAMIC_ROUTE_UNVERIFIED", "This dynamic public route is structurally valid but cannot be tied to a page record by this first-pass audit.", "navigation")
            : issue("warning", "NAVIGATION_INTERNAL_TARGET_UNKNOWN", `No governed page or known public route matches ${internalPath}.`, "navigation")
        );
      }
    }
  }

  return {
    ...record,
    internal_path: internalPath,
    target_page: targetPage ? pageSummary(targetPage) : null,
    direct_page: directPage ? pageSummary(directPage) : null,
    issues,
  };
}

function addDuplicateCanonicalIssues(pageRows = []) {
  const groups = new Map();
  for (const page of pageRows) {
    if (!page.canonical?.valid || !page.canonical.normalized) continue;
    const key = page.canonical.normalized.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  const conflicts = [];
  for (const [canonical, pages] of groups.entries()) {
    if (pages.length < 2) continue;
    const pageIds = pages.map((page) => page.id);
    conflicts.push({ canonical_url: canonical, page_ids: pageIds, pages: pages.map(pageSummary) });
    for (const page of pages) {
      page.issues.push(issue("critical", "DUPLICATE_CANONICAL", `This canonical URL is also assigned to ${pages.length - 1} other page${pages.length === 2 ? "" : "s"}.`));
    }
  }
  return conflicts;
}

function issueCounts(rows = []) {
  const result = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const row of rows) {
    for (const current of row.issues || []) {
      if (Object.hasOwn(result, current.severity)) result[current.severity] += 1;
      result.total += 1;
    }
  }
  return result;
}

function websiteHealthScore(...collections) {
  let penalty = 0;
  for (const rows of collections) {
    for (const row of rows || []) {
      for (const current of row.issues || []) {
        penalty += SEVERITY_WEIGHT[current.severity] || 0;
      }
    }
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

function redirectCandidates(pageRows = [], navigationRows = []) {
  const candidates = [];
  for (const page of pageRows) {
    if (!page.canonical?.valid || !page.public_path || !page.canonical.path) continue;
    if (page.public_path !== page.canonical.path) {
      candidates.push({
        kind: "canonical_path_mismatch",
        source: page.public_path,
        destination: page.canonical.path,
        page_id: page.id,
        label: page.title,
        note: "The configured canonical path differs from the page's governed public path. Review whether a redirect will be required when redirect management is enabled.",
      });
    }
  }
  for (const item of navigationRows) {
    if (!(item.issues || []).some((current) => current.code === "NAVIGATION_INTERNAL_TARGET_UNKNOWN")) continue;
    candidates.push({
      kind: "unknown_internal_navigation",
      source: item.internal_path,
      destination: null,
      navigation_id: item.id,
      label: item.label,
      note: "This internal navigation path has no governed destination. Confirm the intended destination before creating a redirect rule.",
    });
  }
  return candidates;
}

async function getWebsiteControlIntelligence() {
  try {
    const [[pageRows], [navigationRows]] = await Promise.all([
      pool.query(
        `SELECT
           p.*,
           latest.id AS latest_version_id,
           latest.version_number AS latest_version_number,
           latest.version_status AS latest_version_status,
           latest.title,
           latest.seo_title,
           latest.meta_description,
           latest.canonical_url,
           latest.robots_directive
         FROM public_pages p
         LEFT JOIN public_page_versions latest
           ON latest.id = (
             SELECT pv.id
               FROM public_page_versions pv
              WHERE pv.page_id = p.id
              ORDER BY pv.version_number DESC, pv.id DESC
              LIMIT 1
           )
         ORDER BY p.is_homepage DESC, p.slug, p.id`
      ),
      pool.query(
        `SELECT n.*
           FROM public_navigation_items n
          ORDER BY n.navigation_location, n.sort_order, n.id`
      ),
    ]);

    const activePages = pageRows.filter((page) => page.publication_status !== "archived");
    const activeNavigation = navigationRows.filter((item) => item.publication_status !== "archived");
    const pageMap = new Map(activePages.map((page) => [Number(page.id), page]));
    const pathMap = new Map(
      activePages
        .map((page) => [pagePublicPath(page), page])
        .filter(([pathname]) => Boolean(pathname))
    );
    const navigationMap = new Map(activeNavigation.map((item) => [Number(item.id), item]));

    const pages = activePages.map(evaluatePageSeo);
    const canonicalConflicts = addDuplicateCanonicalIssues(pages);
    const navigation = activeNavigation.map((item) =>
      evaluateNavigationTarget(item, pageMap, pathMap, navigationMap)
    );

    const representedPageIds = new Set();
    for (const item of navigation) {
      if (item.page_id) representedPageIds.add(Number(item.page_id));
      if (item.direct_page?.id) representedPageIds.add(Number(item.direct_page.id));
    }
    const orphans = pages.filter(
      (page) => !page.is_homepage && !representedPageIds.has(Number(page.id))
    );
    const redirects = redirectCandidates(pages, navigation);
    const pageIssues = issueCounts(pages);
    const navigationIssues = issueCounts(navigation);
    const healthyPages = pages.filter(
      (page) => !(page.issues || []).some((current) => ["critical", "warning"].includes(current.severity))
    );

    return {
      generated_at: new Date().toISOString(),
      summary: {
        health_score: websiteHealthScore(pages, navigation),
        total_pages: pages.length,
        published_pages: pages.filter((page) => page.publication_status === "published").length,
        healthy_pages: healthyPages.length,
        attention_pages: pages.length - healthyPages.length,
        indexable_published_pages: pages.filter((page) =>
          page.publication_status === "published" &&
          page.show_in_search &&
          !robotsTokens(page.robots_directive).has("noindex")
        ).length,
        navigation_items: navigation.length,
        orphan_pages: orphans.length,
        redirect_candidates: redirects.length,
        canonical_conflicts: canonicalConflicts.length,
        page_issues: pageIssues,
        navigation_issues: navigationIssues,
      },
      pages,
      navigation,
      orphan_pages: orphans.map((page) => ({
        ...pageSummary(page),
        note: "This page is not represented in governed Navigation. It may still be reachable from hard-coded or contextual website links.",
      })),
      redirect_candidates: redirects,
      canonical_conflicts: canonicalConflicts,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  DYNAMIC_PUBLIC_PREFIXES,
  SEVERITY_WEIGHT,
  STATIC_PUBLIC_PATHS,
  addDuplicateCanonicalIssues,
  canonicalInfo,
  directUrlKind,
  evaluateNavigationTarget,
  evaluatePageSeo,
  getWebsiteControlIntelligence,
  normalizePublicPath,
  pagePublicPath,
  redirectCandidates,
  robotsTokens,
  websiteHealthScore,
};
