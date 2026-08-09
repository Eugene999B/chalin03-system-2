"use strict";

const { pool } = require("../config/db");
const {
  publicationPredicate,
  schemaNotReadyError,
} = require("./publicContentService");
const {
  STATIC_PUBLIC_PATHS,
} = require("./contentStudioWebsiteControlService");
const {
  BUILT_IN_BUSINESS_SLUGS,
} = require("./publicRouteOccupancyService");

const MAX_SITEMAP_URLS = 50000;
const GENERIC_PAGE_PREFIX = "/pages";

function cleanSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function pageSitemapPath(page = {}) {
  if (Number(page.is_homepage || 0) === 1) return "/";
  const slug = cleanSlug(page.slug);
  if (!slug) return "";
  const topLevel = `/${slug}`;
  return STATIC_PUBLIC_PATHS.has(topLevel)
    ? topLevel
    : `${GENERIC_PAGE_PREFIX}/${slug}`;
}

function robotsAllowsSitemap(value) {
  const tokens = new Set(
    String(value || "index,follow")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
  );
  return !tokens.has("noindex");
}

function normalizeLastModified(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sitemapItem(path, kind, lastModified = null) {
  const pathname = String(path || "").trim();
  if (!/^\/(?!\/)/.test(pathname)) return null;
  return {
    path: pathname,
    kind,
    last_modified: normalizeLastModified(lastModified),
  };
}

function dedupeSitemapItems(items = []) {
  const byPath = new Map();
  for (const item of items) {
    if (!item?.path) continue;
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, item);
      continue;
    }
    const currentTime = item.last_modified ? Date.parse(item.last_modified) : 0;
    const existingTime = existing.last_modified ? Date.parse(existing.last_modified) : 0;
    if (currentTime > existingTime) byPath.set(item.path, item);
  }
  return [...byPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_SITEMAP_URLS);
}

async function getPublicSeoInventory() {
  try {
    const [
      [pageRows],
      [divisionRows],
      [newsRows],
      [projectRows],
      [equipmentRows],
      [vacancyRows],
      [tenderRows],
    ] = await Promise.all([
      pool.query(
        `SELECT
           p.slug,
           p.is_homepage,
           p.show_in_sitemap,
           p.updated_at,
           v.robots_directive,
           v.published_at AS version_published_at
         FROM public_pages p
         JOIN public_page_versions v
           ON v.id = (
             SELECT pv.id
               FROM public_page_versions pv
              WHERE pv.page_id = p.id
                AND pv.version_status = 'published'
                AND (pv.publish_at IS NULL OR pv.publish_at <= UTC_TIMESTAMP())
                AND (pv.expires_at IS NULL OR pv.expires_at > UTC_TIMESTAMP())
              ORDER BY pv.version_number DESC, pv.id DESC
              LIMIT 1
           )
        WHERE ${publicationPredicate("p")}
          AND p.show_in_sitemap = 1`
      ),
      pool.query(
        `SELECT d.slug, d.updated_at, d.published_at
           FROM public_business_divisions d
          WHERE ${publicationPredicate("d")}`
      ),
      pool.query(
        `SELECT a.slug, a.updated_at, a.published_at
           FROM public_news_articles a
          WHERE ${publicationPredicate("a")}`
      ),
      pool.query(
        `SELECT p.slug, p.updated_at, p.published_at
           FROM public_projects p
          WHERE ${publicationPredicate("p")}`
      ),
      pool.query(
        `SELECT e.slug, e.updated_at, e.published_at
           FROM public_equipment_catalogue e
          WHERE ${publicationPredicate("e")}`
      ),
      pool.query(
        `SELECT v.slug, v.updated_at, v.published_at
           FROM public_job_vacancies v
          WHERE ${publicationPredicate("v")}
            AND (v.opens_at IS NULL OR v.opens_at <= UTC_TIMESTAMP())
            AND (v.closes_at IS NULL OR v.closes_at > UTC_TIMESTAMP())`
      ),
      pool.query(
        `SELECT t.slug, t.updated_at, t.published_at
           FROM public_tenders t
          WHERE ${publicationPredicate("t")}
            AND (t.opens_at IS NULL OR t.opens_at <= UTC_TIMESTAMP())
            AND (t.closes_at IS NULL OR t.closes_at > UTC_TIMESTAMP())`
      ),
    ]);

    const items = [];
    for (const path of STATIC_PUBLIC_PATHS) {
      items.push(sitemapItem(path, "static"));
    }
    for (const slug of BUILT_IN_BUSINESS_SLUGS) {
      items.push(sitemapItem(`/businesses/${slug}`, "business"));
    }

    for (const row of pageRows) {
      if (!robotsAllowsSitemap(row.robots_directive)) continue;
      items.push(
        sitemapItem(
          pageSitemapPath(row),
          "page",
          row.updated_at || row.version_published_at
        )
      );
    }

    const addRows = (rows, prefix, kind) => {
      for (const row of rows) {
        const slug = cleanSlug(row.slug);
        if (!slug) continue;
        items.push(
          sitemapItem(
            `${prefix}/${slug}`,
            kind,
            row.updated_at || row.published_at
          )
        );
      }
    };

    addRows(divisionRows, "/businesses", "business");
    addRows(newsRows, "/news", "news");
    addRows(projectRows, "/projects", "project");
    addRows(equipmentRows, "/equipment", "equipment");
    addRows(vacancyRows, "/careers", "vacancy");
    addRows(tenderRows, "/tenders", "tender");

    const deduped = dedupeSitemapItems(items);
    return {
      generated_at: new Date().toISOString(),
      max_urls: MAX_SITEMAP_URLS,
      total: deduped.length,
      items: deduped,
      policy: {
        published_only: true,
        governed_page_sitemap_flag_required: true,
        governed_page_noindex_excluded: true,
        private_forms_excluded: true,
      },
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  GENERIC_PAGE_PREFIX,
  MAX_SITEMAP_URLS,
  cleanSlug,
  dedupeSitemapItems,
  getPublicSeoInventory,
  normalizeLastModified,
  pageSitemapPath,
  robotsAllowsSitemap,
  sitemapItem,
};
