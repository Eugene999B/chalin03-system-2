"use strict";

const { pool } = require("../config/db");
const {
  booleanValue,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  publicationPredicate,
} = require("./publicContentService");
const {
  BUILT_IN_BUSINESS_SLUGS,
  isReservedPlatformPath,
} = require("./publicRouteOccupancyService");
const {
  STATIC_PUBLIC_PATHS,
} = require("./contentStudioWebsiteControlService");
const {
  pageSitemapPath,
} = require("./publicSeoDeliveryService");

const MAX_LINK_TARGETS = 500;
const MAX_LINK_REFERENCES = 1500;
const MAX_TRAVERSAL_NODES = 12000;
const MAX_TRAVERSAL_DEPTH = 12;
const BUSINESS_SECTIONS = Object.freeze([
  "capabilities",
  "projects",
  "gallery",
  "contact",
]);
const LINK_KEY_PATTERN = /(?:url|href|link|path|route|action|cta|destination|target|\bto\b)/i;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\((\/(?!\/)[^)\s]+)\)/g;
const ATTRIBUTE_LINK_PATTERN = /(?:href|to)\s*=\s*["'](\/(?!\/)[^"']+)["']/gi;

function clean(value, maximum = 2000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeInternalTarget(value) {
  const raw = clean(value, 2000);
  if (!/^\/(?!\/)/.test(raw) || /[\\\r\n]/.test(raw)) return null;
  try {
    const parsed = new URL(raw, "https://chalin.invalid");
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    return {
      original: raw,
      path: pathname || "/",
      query: parsed.search || "",
      hash: parsed.hash || "",
    };
  } catch {
    return null;
  }
}

function addTarget(result, value, location) {
  if (result.references.length >= MAX_LINK_REFERENCES) {
    result.truncated = true;
    return;
  }
  const normalized = normalizeInternalTarget(value);
  if (!normalized) return;
  result.references.push({
    ...normalized,
    location: clean(location, 500) || "content",
  });
}

function linksFromString(value, key, location, result) {
  const text = clean(value, 8000);
  if (!text) return;

  if (LINK_KEY_PATTERN.test(String(key || ""))) {
    addTarget(result, text, location);
  }

  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    addTarget(result, match[1], `${location}:markdown`);
  }
  for (const match of text.matchAll(ATTRIBUTE_LINK_PATTERN)) {
    addTarget(result, match[1], `${location}:attribute`);
  }
}

function extractInternalLinks(value, options = {}) {
  const result = {
    references: [],
    traversed_nodes: 0,
    truncated: false,
  };
  const root = options.root || "content";

  function visit(current, key, location, depth) {
    if (result.truncated) return;
    if (depth > MAX_TRAVERSAL_DEPTH) {
      result.truncated = true;
      return;
    }
    result.traversed_nodes += 1;
    if (result.traversed_nodes > MAX_TRAVERSAL_NODES) {
      result.truncated = true;
      return;
    }

    if (typeof current === "string") {
      linksFromString(current, key, location, result);
      return;
    }
    if (current === null || current === undefined || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, key, `${location}[${index}]`, depth + 1));
      return;
    }
    for (const [childKey, childValue] of Object.entries(current)) {
      visit(childValue, childKey, `${location}.${childKey}`, depth + 1);
    }
  }

  visit(safeJson(value, value), "", root, 0);
  return result;
}

function pagePath(page) {
  return pageSitemapPath({
    slug: page.slug,
    is_homepage: booleanValue(page.is_homepage),
  });
}

async function loadPublishedPathMap(connection = pool) {
  const [
    [pageRows],
    [divisionRows],
    [newsRows],
    [projectRows],
    [equipmentRows],
    [vacancyRows],
    [tenderRows],
    [formRows],
  ] = await Promise.all([
    connection.query(
      `SELECT p.slug, p.is_homepage
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
        WHERE ${publicationPredicate("p")}`
    ),
    connection.query(`SELECT d.slug FROM public_business_divisions d WHERE ${publicationPredicate("d")}`),
    connection.query(`SELECT a.slug FROM public_news_articles a WHERE ${publicationPredicate("a")}`),
    connection.query(`SELECT p.slug FROM public_projects p WHERE ${publicationPredicate("p")}`),
    connection.query(`SELECT e.slug FROM public_equipment_catalogue e WHERE ${publicationPredicate("e")}`),
    connection.query(
      `SELECT v.slug FROM public_job_vacancies v
        WHERE ${publicationPredicate("v")}
          AND (v.opens_at IS NULL OR v.opens_at <= UTC_TIMESTAMP())
          AND (v.closes_at IS NULL OR v.closes_at > UTC_TIMESTAMP())`
    ),
    connection.query(
      `SELECT t.slug FROM public_tenders t
        WHERE ${publicationPredicate("t")}
          AND (t.opens_at IS NULL OR t.opens_at <= UTC_TIMESTAMP())
          AND (t.closes_at IS NULL OR t.closes_at > UTC_TIMESTAMP())`
    ),
    connection.query(`SELECT f.slug FROM public_forms f WHERE ${publicationPredicate("f")}`),
  ]);

  const paths = new Map();
  for (const path of STATIC_PUBLIC_PATHS) paths.set(path, "static");

  const addBusiness = (slug) => {
    const cleanSlug = clean(slug, 200);
    if (!cleanSlug) return;
    paths.set(`/businesses/${cleanSlug}`, "business");
    for (const section of BUSINESS_SECTIONS) {
      paths.set(`/businesses/${cleanSlug}/${section}`, "business_section");
    }
  };
  for (const slug of BUILT_IN_BUSINESS_SLUGS) addBusiness(slug);
  for (const row of divisionRows) addBusiness(row.slug);

  for (const row of pageRows) {
    const path = pagePath(row);
    if (path) paths.set(path, "page");
  }
  const addRows = (rows, prefix, kind) => {
    for (const row of rows) {
      const slug = clean(row.slug, 200);
      if (slug) paths.set(`${prefix}/${slug}`, kind);
    }
  };
  addRows(newsRows, "/news", "news");
  addRows(projectRows, "/projects", "project");
  addRows(equipmentRows, "/equipment", "equipment");
  addRows(vacancyRows, "/careers", "vacancy");
  addRows(tenderRows, "/tenders", "tender");
  addRows(formRows, "/forms", "form");
  return paths;
}

async function loadActivePagePathMap(connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, page_key, slug, is_homepage, publication_status
       FROM public_pages
      WHERE publication_status <> 'archived'`
  );
  return new Map(
    rows
      .map((row) => [pagePath(row), row])
      .filter(([pathname]) => Boolean(pathname))
  );
}

async function loadActiveRedirectMap(connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, source_path, destination_url, redirect_status
       FROM public_redirect_rules
      WHERE rule_status = 'active'
        AND (activate_at IS NULL OR activate_at <= UTC_TIMESTAMP())
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())`
  );
  return new Map(rows.map((row) => [String(row.source_path), row]));
}

function classifyInternalTarget(pathname, context = {}) {
  const path = clean(pathname, 1000);
  if (!path) {
    return {
      status: "broken",
      severity: "critical",
      code: "BROKEN_INTERNAL_LINK",
      message: "The internal target could not be normalized safely.",
    };
  }

  if (isReservedPlatformPath(path)) {
    return {
      status: "private",
      severity: "critical",
      code: "PRIVATE_ROUTE_LINK",
      message: "Public content points into a protected staff, operational, security or API route.",
    };
  }

  if (context.publishedPaths?.has(path)) {
    return {
      status: "healthy",
      severity: "healthy",
      code: "PUBLIC_ROUTE_OK",
      owner_kind: context.publishedPaths.get(path),
      message: "The target resolves to a currently published public route.",
    };
  }

  if (context.redirects?.has(path)) {
    const redirect = context.redirects.get(path);
    return {
      status: "redirected",
      severity: "warning",
      code: "REDIRECTED_INTERNAL_LINK",
      redirect_id: Number(redirect.id),
      redirect_destination: redirect.destination_url,
      redirect_status: Number(redirect.redirect_status),
      message: "This content still links to an active redirect source. Prefer the final governed destination.",
    };
  }

  if (path === "/website" || path.startsWith("/website/")) {
    const suffix = path.replace(/^\/website\/?/, "");
    return {
      status: "legacy",
      severity: "warning",
      code: "LEGACY_WEBSITE_LINK",
      redirect_destination: suffix ? `/${suffix}` : "/",
      message: "This link uses the legacy /website compatibility path. Update it to the canonical root route.",
    };
  }

  if (context.activePages?.has(path)) {
    const page = context.activePages.get(path);
    return {
      status: "unpublished",
      severity: "warning",
      code: "UNPUBLISHED_PAGE_LINK",
      page_id: Number(page.id),
      page_status: page.publication_status,
      message: `The target belongs to a governed Page that is currently ${page.publication_status || "not published"}.`,
    };
  }

  return {
    status: "broken",
    severity: "critical",
    code: "BROKEN_INTERNAL_LINK",
    message: "No current public route, governed redirect or active Page owns this internal path.",
  };
}

function sourceSnapshot(page, version, scope, sections = []) {
  const sources = [];
  const body = extractInternalLinks(version.body_json, { root: "body" });
  const settings = extractInternalLinks(version.settings_json, { root: "settings" });
  sources.push(...body.references, ...settings.references);
  let truncated = body.truncated || settings.truncated;

  for (const section of sections) {
    const key = clean(section.section_key, 160) || `section-${section.id}`;
    const content = extractInternalLinks(section.content_json, { root: `section:${key}:content` });
    const sectionSettings = extractInternalLinks(section.settings_json, { root: `section:${key}:settings` });
    sources.push(...content.references, ...sectionSettings.references);
    truncated ||= content.truncated || sectionSettings.truncated;
    if (sources.length >= MAX_LINK_REFERENCES) {
      truncated = true;
      break;
    }
  }

  return sources.slice(0, MAX_LINK_REFERENCES).map((reference) => ({
    ...reference,
    page_id: Number(page.id),
    page_key: page.page_key,
    page_title: version.title || page.page_key,
    page_path: pagePath(page),
    version_id: Number(version.id),
    version_number: Number(version.version_number),
    version_status: version.version_status,
    scope,
  })).concat(truncated ? [{ __truncated: true }] : []);
}

async function loadPageSnapshots(connection = pool) {
  const [pages] = await connection.query(
    `SELECT p.id, p.page_key, p.slug, p.is_homepage, p.publication_status,
            (SELECT pv.id
               FROM public_page_versions pv
              WHERE pv.page_id = p.id
              ORDER BY pv.version_number DESC, pv.id DESC
              LIMIT 1) AS latest_version_id,
            (SELECT pub.id
               FROM public_page_versions pub
              WHERE pub.page_id = p.id
                AND pub.version_status = 'published'
                AND (pub.publish_at IS NULL OR pub.publish_at <= UTC_TIMESTAMP())
                AND (pub.expires_at IS NULL OR pub.expires_at > UTC_TIMESTAMP())
              ORDER BY pub.version_number DESC, pub.id DESC
              LIMIT 1) AS published_version_id
       FROM public_pages p
      WHERE p.publication_status <> 'archived'
      ORDER BY p.is_homepage DESC, p.slug, p.id`
  );

  const versionIds = [...new Set(
    pages.flatMap((page) => [page.latest_version_id, page.published_version_id])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  )];
  if (!versionIds.length) return { pages, versions: new Map(), sections: new Map() };

  const placeholders = versionIds.map(() => "?").join(",");
  const [[versions], [sections]] = await Promise.all([
    connection.query(
      `SELECT id, page_id, version_number, version_status, title, body_json, settings_json
         FROM public_page_versions
        WHERE id IN (${placeholders})`,
      versionIds
    ),
    connection.query(
      `SELECT id, page_version_id, section_key, content_json, settings_json
         FROM public_page_sections
        WHERE page_version_id IN (${placeholders})
          AND is_enabled = 1
        ORDER BY page_version_id, sort_order, id`,
      versionIds
    ),
  ]);

  const versionMap = new Map(versions.map((row) => [Number(row.id), row]));
  const sectionMap = new Map();
  for (const row of sections) {
    const id = Number(row.page_version_id);
    if (!sectionMap.has(id)) sectionMap.set(id, []);
    sectionMap.get(id).push(row);
  }
  return { pages, versions: versionMap, sections: sectionMap };
}

function aggregateTargets(references, context) {
  const byPath = new Map();
  let truncated = false;

  for (const reference of references) {
    if (reference.__truncated) {
      truncated = true;
      continue;
    }
    if (!byPath.has(reference.path) && byPath.size >= MAX_LINK_TARGETS) {
      truncated = true;
      continue;
    }
    if (!byPath.has(reference.path)) {
      byPath.set(reference.path, {
        path: reference.path,
        classification: classifyInternalTarget(reference.path, context),
        sources: [],
      });
    }
    const target = byPath.get(reference.path);
    if (target.sources.length < 40) target.sources.push(reference);
    else truncated = true;
  }

  return {
    targets: [...byPath.values()].map((target) => ({
      path: target.path,
      ...target.classification,
      references: target.sources.length,
      sources: target.sources,
    })),
    truncated,
  };
}

async function getLinkIntegrityIntelligence() {
  try {
    const [snapshots, publishedPaths, activePages, redirects] = await Promise.all([
      loadPageSnapshots(pool),
      loadPublishedPathMap(pool),
      loadActivePagePathMap(pool),
      loadActiveRedirectMap(pool),
    ]);

    const references = [];
    let versionsScanned = 0;
    let truncated = false;
    for (const page of snapshots.pages) {
      const publishedId = Number(page.published_version_id || 0);
      const latestId = Number(page.latest_version_id || 0);
      const selections = [];
      if (publishedId) selections.push([publishedId, "published"]);
      if (latestId && latestId !== publishedId) selections.push([latestId, "candidate"]);

      for (const [versionId, scope] of selections) {
        const version = snapshots.versions.get(versionId);
        if (!version) continue;
        versionsScanned += 1;
        const found = sourceSnapshot(
          page,
          version,
          scope,
          snapshots.sections.get(versionId) || []
        );
        for (const reference of found) {
          if (references.length >= MAX_LINK_REFERENCES) {
            truncated = true;
            break;
          }
          references.push(reference);
          if (reference.__truncated) truncated = true;
        }
      }
      if (references.length >= MAX_LINK_REFERENCES) break;
    }

    const aggregated = aggregateTargets(references, { publishedPaths, activePages, redirects });
    truncated ||= aggregated.truncated;
    const targets = aggregated.targets.sort((left, right) => {
      const weight = { critical: 0, warning: 1, healthy: 2 };
      return (weight[left.severity] ?? 3) - (weight[right.severity] ?? 3) || left.path.localeCompare(right.path);
    });
    const issues = targets.filter((target) => target.severity !== "healthy");
    const count = (status) => targets.filter((target) => target.status === status).length;
    const referenceCount = targets.reduce((total, target) => total + Number(target.references || 0), 0);

    return {
      generated_at: new Date().toISOString(),
      summary: {
        pages_scanned: snapshots.pages.length,
        versions_scanned: versionsScanned,
        references_scanned: referenceCount,
        unique_targets: targets.length,
        healthy_targets: count("healthy"),
        broken_targets: count("broken"),
        private_route_targets: count("private"),
        redirected_targets: count("redirected") + count("legacy"),
        unpublished_page_targets: count("unpublished"),
        critical_targets: targets.filter((target) => target.severity === "critical").length,
        warning_targets: targets.filter((target) => target.severity === "warning").length,
        truncated,
      },
      issues,
      targets,
      policy: {
        read_only: true,
        scans_latest_candidate_and_current_published: true,
        disabled_sections_excluded: true,
        protected_platform_routes_blocked: true,
        active_redirect_sources_warned: true,
        max_unique_targets: MAX_LINK_TARGETS,
        max_references: MAX_LINK_REFERENCES,
      },
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  ATTRIBUTE_LINK_PATTERN,
  BUSINESS_SECTIONS,
  LINK_KEY_PATTERN,
  MARKDOWN_LINK_PATTERN,
  MAX_LINK_REFERENCES,
  MAX_LINK_TARGETS,
  MAX_TRAVERSAL_DEPTH,
  MAX_TRAVERSAL_NODES,
  aggregateTargets,
  classifyInternalTarget,
  extractInternalLinks,
  getLinkIntegrityIntelligence,
  loadActivePagePathMap,
  loadActiveRedirectMap,
  loadPageSnapshots,
  loadPublishedPathMap,
  normalizeInternalTarget,
};
