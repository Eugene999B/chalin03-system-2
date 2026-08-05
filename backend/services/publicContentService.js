"use strict";

const { pool } = require("../config/db");

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

function normalizeSlug(value, maximumLength = 200) {
  const slug = String(value || "").trim().toLowerCase();
  if (!slug || slug.length > maximumLength) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return slug;
}

function clampLimit(value, fallback = DEFAULT_LIMIT, maximum = MAX_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function booleanValue(value) {
  return value === true || Number(value) === 1;
}

function publicationPredicate(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Unsafe publication alias: ${alias}`);
  }

  return `${alias}.publication_status = 'published'
    AND (${alias}.publish_at IS NULL OR ${alias}.publish_at <= UTC_TIMESTAMP())
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > UTC_TIMESTAMP())`;
}

function pageVersionPredicate(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Unsafe page-version alias: ${alias}`);
  }

  return `${alias}.version_status = 'published'
    AND (${alias}.publish_at IS NULL OR ${alias}.publish_at <= UTC_TIMESTAMP())
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > UTC_TIMESTAMP())`;
}

function mediaColumns(alias = "media", prefix = "media") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias) || !/^[a-z][a-z0-9_]*$/i.test(prefix)) {
    throw new Error("Unsafe media SQL alias.");
  }

  return `${alias}.asset_key AS ${prefix}_asset_key,
    ${alias}.public_url AS ${prefix}_public_url,
    ${alias}.media_type AS ${prefix}_type,
    ${alias}.mime_type AS ${prefix}_mime_type,
    ${alias}.width_pixels AS ${prefix}_width,
    ${alias}.height_pixels AS ${prefix}_height,
    ${alias}.duration_seconds AS ${prefix}_duration_seconds,
    ${alias}.alt_text AS ${prefix}_alt_text,
    ${alias}.caption AS ${prefix}_caption,
    ${alias}.credit_text AS ${prefix}_credit_text`;
}

function publicMediaJoin(alias, idExpression) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Unsafe media join alias: ${alias}`);
  }

  return `LEFT JOIN public_media_assets ${alias}
    ON ${alias}.id = ${idExpression}
   AND ${alias}.visibility = 'public'
   AND ${alias}.processing_status = 'ready'
   AND ${alias}.is_active = 1`;
}

function mapMedia(row, prefix = "media") {
  const assetKey = row?.[`${prefix}_asset_key`];
  if (!assetKey) return null;

  return {
    asset_key: assetKey,
    url: row[`${prefix}_public_url`] || null,
    media_type: row[`${prefix}_type`] || null,
    mime_type: row[`${prefix}_mime_type`] || null,
    width: row[`${prefix}_width`] ?? null,
    height: row[`${prefix}_height`] ?? null,
    duration_seconds: row[`${prefix}_duration_seconds`] ?? null,
    alt_text: row[`${prefix}_alt_text`] || "",
    caption: row[`${prefix}_caption`] || "",
    credit: row[`${prefix}_credit_text`] || "",
  };
}

function schemaNotReadyError(error) {
  if (error?.code !== "ER_NO_SUCH_TABLE") return error;

  const translated = new Error(
    "The CHALIN ONE public-content database foundation has not been applied to this environment."
  );
  translated.code = "PUBLIC_CONTENT_SCHEMA_NOT_READY";
  translated.statusCode = 503;
  translated.cause = error;
  return translated;
}

async function query(sql, values = []) {
  try {
    const [rows] = await pool.query(sql, values);
    return rows;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

function mapDivision(row) {
  return {
    key: row.division_key,
    slug: row.slug,
    name: row.name,
    short_description: row.short_description || "",
    body: safeJson(row.body_json, {}),
    contact: {
      phone: row.contact_phone || "",
      email: row.contact_email || "",
    },
    media: mapMedia(row),
  };
}

async function getPublicBootstrap() {
  const [settingRows, navigationRows, announcementRows, divisionRows, statisticRows] =
    await Promise.all([
      query(
        `SELECT setting_key, setting_group, value_json
         FROM public_site_settings
         WHERE is_public = 1
           AND is_active = 1
         ORDER BY setting_group, setting_key`
      ),
      query(
        `SELECT
           n.navigation_key,
           parent.navigation_key AS parent_key,
           n.navigation_location,
           n.label,
           n.url,
           n.icon_key,
           n.sort_order,
           n.opens_new_tab,
           p.slug AS page_slug
         FROM public_navigation_items n
         LEFT JOIN public_navigation_items parent ON parent.id = n.parent_id
         LEFT JOIN public_pages p ON p.id = n.page_id
         WHERE n.is_visible = 1
           AND ${publicationPredicate("n")}
         ORDER BY n.navigation_location, n.sort_order, n.id`
      ),
      query(
        `SELECT
           announcement_key,
           title,
           body_text,
           link_label,
           link_url,
           display_style,
           priority,
           ticker_enabled,
           publish_at,
           expires_at
         FROM public_announcements a
         WHERE ${publicationPredicate("a")}
         ORDER BY priority DESC, published_at DESC, id DESC`
      ),
      query(
        `SELECT
           d.division_key,
           d.slug,
           d.name,
           d.short_description,
           d.body_json,
           d.contact_phone,
           d.contact_email,
           ${mediaColumns("media")}
         FROM public_business_divisions d
         ${publicMediaJoin("media", "d.featured_media_asset_id")}
         WHERE ${publicationPredicate("d")}
         ORDER BY d.sort_order, d.name`
      ),
      query(
        `SELECT
           statistic_key,
           label,
           display_value,
           numeric_value,
           prefix_text,
           suffix_text,
           source_note,
           as_of_date
         FROM public_company_statistics s
         WHERE ${publicationPredicate("s")}
         ORDER BY s.sort_order, s.id`
      ),
    ]);

  const settings = {};
  for (const row of settingRows) {
    settings[row.setting_key] = safeJson(row.value_json, null);
  }

  return {
    settings,
    navigation: navigationRows.map((row) => ({
      key: row.navigation_key,
      parent_key: row.parent_key || null,
      location: row.navigation_location,
      label: row.label,
      url: row.url || (row.page_slug ? `/${row.page_slug}` : null),
      icon: row.icon_key || null,
      sort_order: Number(row.sort_order || 0),
      opens_new_tab: booleanValue(row.opens_new_tab),
    })),
    announcements: announcementRows.map((row) => ({
      key: row.announcement_key,
      title: row.title,
      body: row.body_text || "",
      link_label: row.link_label || null,
      link_url: row.link_url || null,
      style: row.display_style,
      priority: Number(row.priority || 0),
      ticker_enabled: booleanValue(row.ticker_enabled),
      publish_at: row.publish_at || null,
      expires_at: row.expires_at || null,
    })),
    divisions: divisionRows.map(mapDivision),
    statistics: statisticRows.map((row) => ({
      key: row.statistic_key,
      label: row.label,
      display_value: row.display_value,
      numeric_value: row.numeric_value ?? null,
      prefix: row.prefix_text || "",
      suffix: row.suffix_text || "",
      source_note: row.source_note || "",
      as_of_date: row.as_of_date || null,
    })),
  };
}

async function getPublicPageBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug, 180);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       p.page_key,
       p.slug,
       p.page_type,
       p.template_key,
       p.menu_title,
       v.id AS internal_page_version_id,
       v.version_number,
       v.title,
       v.subtitle,
       v.summary,
       v.body_json,
       v.seo_title,
       v.meta_description,
       v.canonical_url,
       v.robots_directive,
       v.settings_json,
       v.published_at,
       ${mediaColumns("media")}
     FROM public_pages p
     JOIN public_page_versions v
       ON v.id = (
         SELECT pv.id
         FROM public_page_versions pv
         WHERE pv.page_id = p.id
           AND ${pageVersionPredicate("pv")}
         ORDER BY pv.version_number DESC, pv.id DESC
         LIMIT 1
       )
     ${publicMediaJoin("media", "v.primary_media_asset_id")}
     WHERE p.slug = ?
       AND ${publicationPredicate("p")}
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  const sectionRows = await query(
    `SELECT
       s.section_key,
       s.section_type,
       s.heading,
       s.subheading,
       s.content_json,
       s.settings_json,
       s.sort_order,
       ${mediaColumns("primary_media", "primary_media")},
       ${mediaColumns("background_media", "background_media")}
     FROM public_page_sections s
     ${publicMediaJoin("primary_media", "s.primary_media_asset_id")}
     ${publicMediaJoin("background_media", "s.background_media_asset_id")}
     WHERE s.page_version_id = ?
       AND s.is_enabled = 1
     ORDER BY s.sort_order, s.id`,
    [row.internal_page_version_id]
  );

  return {
    key: row.page_key,
    slug: row.slug,
    page_type: row.page_type,
    template: row.template_key,
    menu_title: row.menu_title || row.title,
    version: Number(row.version_number),
    title: row.title,
    subtitle: row.subtitle || "",
    summary: row.summary || "",
    body: safeJson(row.body_json, {}),
    settings: safeJson(row.settings_json, {}),
    seo: {
      title: row.seo_title || row.title,
      description: row.meta_description || row.summary || "",
      canonical_url: row.canonical_url || null,
      robots: row.robots_directive || "index,follow",
    },
    media: mapMedia(row),
    published_at: row.published_at || null,
    sections: sectionRows.map((section) => ({
      key: section.section_key,
      type: section.section_type,
      heading: section.heading || "",
      subheading: section.subheading || "",
      content: safeJson(section.content_json, {}),
      settings: safeJson(section.settings_json, {}),
      sort_order: Number(section.sort_order || 0),
      primary_media: mapMedia(section, "primary_media"),
      background_media: mapMedia(section, "background_media"),
    })),
  };
}

async function listPublicNews({ limit, offset, categorySlug } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const safeCategorySlug = categorySlug
    ? normalizeSlug(categorySlug, 160)
    : null;

  if (categorySlug && !safeCategorySlug) {
    return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
  }

  const filters = [publicationPredicate("a")];
  const values = [];

  if (safeCategorySlug) {
    filters.push("c.slug = ?");
    values.push(safeCategorySlug);
  }

  const where = filters.join(" AND ");
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT
         a.article_key,
         a.slug,
         a.title,
         a.excerpt,
         a.author_display_name,
         a.is_featured,
         a.published_at,
         c.slug AS category_slug,
         c.name AS category_name,
         ${mediaColumns("media")}
       FROM public_news_articles a
       LEFT JOIN public_news_categories c
         ON c.id = a.category_id
        AND c.is_active = 1
       ${publicMediaJoin("media", "a.featured_media_asset_id")}
       WHERE ${where}
       ORDER BY a.is_featured DESC, a.published_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM public_news_articles a
       LEFT JOIN public_news_categories c
         ON c.id = a.category_id
        AND c.is_active = 1
       WHERE ${where}`,
      values
    ),
  ]);

  return {
    items: rows.map((row) => ({
      key: row.article_key,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt || "",
      author: row.author_display_name || "Chalin 03",
      featured: booleanValue(row.is_featured),
      published_at: row.published_at || null,
      category: row.category_slug
        ? { slug: row.category_slug, name: row.category_name }
        : null,
      media: mapMedia(row),
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublicNewsBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       a.article_key,
       a.slug,
       a.title,
       a.excerpt,
       a.body_json,
       a.author_display_name,
       a.published_at,
       a.seo_title,
       a.meta_description,
       c.slug AS category_slug,
       c.name AS category_name,
       ${mediaColumns("media")}
     FROM public_news_articles a
     LEFT JOIN public_news_categories c
       ON c.id = a.category_id
      AND c.is_active = 1
     ${publicMediaJoin("media", "a.featured_media_asset_id")}
     WHERE a.slug = ?
       AND ${publicationPredicate("a")}
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    key: row.article_key,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || "",
    body: safeJson(row.body_json, {}),
    author: row.author_display_name || "Chalin 03",
    published_at: row.published_at || null,
    category: row.category_slug
      ? { slug: row.category_slug, name: row.category_name }
      : null,
    seo: {
      title: row.seo_title || row.title,
      description: row.meta_description || row.excerpt || "",
    },
    media: mapMedia(row),
  };
}

async function listPublicDivisions() {
  const rows = await query(
    `SELECT
       d.division_key,
       d.slug,
       d.name,
       d.short_description,
       d.body_json,
       d.contact_phone,
       d.contact_email,
       ${mediaColumns("media")}
     FROM public_business_divisions d
     ${publicMediaJoin("media", "d.featured_media_asset_id")}
     WHERE ${publicationPredicate("d")}
     ORDER BY d.sort_order, d.name`
  );

  return rows.map(mapDivision);
}

async function getPublicDivisionBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug, 180);
  if (!slug) return null;

  const divisions = await query(
    `SELECT
       d.division_key,
       d.slug,
       d.name,
       d.short_description,
       d.body_json,
       d.contact_phone,
       d.contact_email,
       ${mediaColumns("media")}
     FROM public_business_divisions d
     ${publicMediaJoin("media", "d.featured_media_asset_id")}
     WHERE d.slug = ?
       AND ${publicationPredicate("d")}
     LIMIT 1`,
    [slug]
  );

  return divisions[0] ? mapDivision(divisions[0]) : null;
}

async function listPublicLeadership() {
  const rows = await query(
    `SELECT
       l.profile_key,
       l.slug,
       l.full_name,
       l.position_title,
       l.professional_summary,
       l.biography_json,
       l.social_links_json,
       ${mediaColumns("portrait", "portrait")}
     FROM public_leadership_profiles l
     ${publicMediaJoin("portrait", "l.portrait_media_asset_id")}
     WHERE ${publicationPredicate("l")}
     ORDER BY l.sort_order, l.full_name`
  );

  return rows.map((row) => ({
    key: row.profile_key,
    slug: row.slug,
    full_name: row.full_name,
    position: row.position_title,
    summary: row.professional_summary || "",
    biography: safeJson(row.biography_json, {}),
    social_links: safeJson(row.social_links_json, []),
    portrait: mapMedia(row, "portrait"),
  }));
}

async function listPublicProjects({ limit, offset, divisionSlug, status } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = [publicationPredicate("p")];
  const values = [];

  if (divisionSlug) {
    const slug = normalizeSlug(divisionSlug, 180);
    if (!slug) return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    filters.push("d.slug = ?");
    values.push(slug);
  }

  if (status) {
    const safeStatus = String(status).trim().toLowerCase();
    if (!["planned", "active", "paused", "completed", "cancelled"].includes(safeStatus)) {
      return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    }
    filters.push("p.operational_status = ?");
    values.push(safeStatus);
  }

  const where = filters.join(" AND ");
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT
         p.project_key,
         p.slug,
         p.title,
         p.summary,
         p.location_text,
         p.operational_status,
         p.start_date,
         p.end_date,
         d.slug AS division_slug,
         d.name AS division_name,
         ${mediaColumns("media")}
       FROM public_projects p
       LEFT JOIN public_business_divisions d
         ON d.id = p.division_id
        AND ${publicationPredicate("d")}
       ${publicMediaJoin("media", "p.featured_media_asset_id")}
       WHERE ${where}
       ORDER BY p.sort_order, p.published_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM public_projects p
       LEFT JOIN public_business_divisions d
         ON d.id = p.division_id
        AND ${publicationPredicate("d")}
       WHERE ${where}`,
      values
    ),
  ]);

  return {
    items: rows.map((row) => ({
      key: row.project_key,
      slug: row.slug,
      title: row.title,
      summary: row.summary || "",
      location: row.location_text || "",
      status: row.operational_status,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      division: row.division_slug
        ? { slug: row.division_slug, name: row.division_name }
        : null,
      media: mapMedia(row),
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublicProjectBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       p.id AS internal_project_id,
       p.project_key,
       p.slug,
       p.title,
       p.summary,
       p.body_json,
       p.location_text,
       p.operational_status,
       p.start_date,
       p.end_date,
       d.slug AS division_slug,
       d.name AS division_name,
       ${mediaColumns("media")}
     FROM public_projects p
     LEFT JOIN public_business_divisions d
       ON d.id = p.division_id
      AND ${publicationPredicate("d")}
     ${publicMediaJoin("media", "p.featured_media_asset_id")}
     WHERE p.slug = ?
       AND ${publicationPredicate("p")}
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  const galleryRows = await query(
    `SELECT
       pm.media_role,
       pm.caption AS project_caption,
       pm.sort_order,
       ${mediaColumns("media")}
     FROM public_project_media pm
     JOIN public_media_assets media
       ON media.id = pm.media_asset_id
      AND media.visibility = 'public'
      AND media.processing_status = 'ready'
      AND media.is_active = 1
     WHERE pm.project_id = ?
     ORDER BY pm.sort_order, pm.id`,
    [row.internal_project_id]
  );

  return {
    key: row.project_key,
    slug: row.slug,
    title: row.title,
    summary: row.summary || "",
    body: safeJson(row.body_json, {}),
    location: row.location_text || "",
    status: row.operational_status,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    division: row.division_slug
      ? { slug: row.division_slug, name: row.division_name }
      : null,
    media: mapMedia(row),
    gallery: galleryRows.map((gallery) => ({
      role: gallery.media_role,
      caption: gallery.project_caption || gallery.media_caption || "",
      sort_order: Number(gallery.sort_order || 0),
      media: mapMedia(gallery),
    })),
  };
}

async function listPublicEquipment({
  limit,
  offset,
  divisionSlug,
  availability,
  hireAvailable,
  financeAvailable,
  search,
} = {}) {
  const safeLimit = clampLimit(limit, 18, 100);
  const safeOffset = normalizeOffset(offset);
  const filters = [publicationPredicate("e")];
  const values = [];

  if (divisionSlug) {
    const slug = normalizeSlug(divisionSlug, 180);
    if (!slug) return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    filters.push("d.slug = ?");
    values.push(slug);
  }

  if (availability) {
    const allowed = [
      "available",
      "reserved",
      "hired",
      "sold",
      "maintenance",
      "unavailable",
      "coming_soon",
    ];
    const safeAvailability = String(availability).trim().toLowerCase();
    if (!allowed.includes(safeAvailability)) {
      return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    }
    filters.push("e.availability_status = ?");
    values.push(safeAvailability);
  }

  if (hireAvailable === true || String(hireAvailable).toLowerCase() === "true") {
    filters.push("e.hire_available = 1");
  }

  if (financeAvailable === true || String(financeAvailable).toLowerCase() === "true") {
    filters.push("e.finance_available = 1");
  }

  const searchTerm = String(search || "").trim();
  if (searchTerm) {
    const safeTerm = searchTerm.slice(0, 100);
    filters.push(
      "(e.name LIKE ? OR e.manufacturer LIKE ? OR e.model LIKE ? OR e.equipment_category LIKE ?)"
    );
    const like = `%${safeTerm}%`;
    values.push(like, like, like, like);
  }

  const where = filters.join(" AND ");
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT
         e.equipment_key,
         e.slug,
         e.name,
         e.manufacturer,
         e.model,
         e.model_year,
         e.equipment_category,
         e.condition_label,
         e.availability_status,
         e.short_description,
         e.currency_code,
         e.display_price,
         e.show_price,
         e.hire_available,
         e.finance_available,
         d.slug AS division_slug,
         d.name AS division_name,
         ${mediaColumns("media")}
       FROM public_equipment_catalogue e
       LEFT JOIN public_business_divisions d
         ON d.id = e.division_id
        AND ${publicationPredicate("d")}
       ${publicMediaJoin("media", "e.featured_media_asset_id")}
       WHERE ${where}
       ORDER BY e.sort_order, e.name
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM public_equipment_catalogue e
       LEFT JOIN public_business_divisions d
         ON d.id = e.division_id
        AND ${publicationPredicate("d")}
       WHERE ${where}`,
      values
    ),
  ]);

  return {
    items: rows.map((row) => ({
      key: row.equipment_key,
      slug: row.slug,
      name: row.name,
      manufacturer: row.manufacturer || "",
      model: row.model || "",
      year: row.model_year || null,
      category: row.equipment_category || "",
      condition: row.condition_label || "",
      availability: row.availability_status,
      short_description: row.short_description || "",
      price:
        booleanValue(row.show_price) && row.display_price !== null
          ? { currency: row.currency_code, amount: row.display_price }
          : null,
      hire_available: booleanValue(row.hire_available),
      finance_available: booleanValue(row.finance_available),
      division: row.division_slug
        ? { slug: row.division_slug, name: row.division_name }
        : null,
      media: mapMedia(row),
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublicEquipmentBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       e.equipment_key,
       e.slug,
       e.name,
       e.manufacturer,
       e.model,
       e.model_year,
       e.equipment_category,
       e.condition_label,
       e.availability_status,
       e.short_description,
       e.specifications_json,
       e.features_json,
       e.currency_code,
       e.display_price,
       e.show_price,
       e.hire_available,
       e.finance_available,
       d.slug AS division_slug,
       d.name AS division_name,
       ${mediaColumns("media")}
     FROM public_equipment_catalogue e
     LEFT JOIN public_business_divisions d
       ON d.id = e.division_id
      AND ${publicationPredicate("d")}
     ${publicMediaJoin("media", "e.featured_media_asset_id")}
     WHERE e.slug = ?
       AND ${publicationPredicate("e")}
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    key: row.equipment_key,
    slug: row.slug,
    name: row.name,
    manufacturer: row.manufacturer || "",
    model: row.model || "",
    year: row.model_year || null,
    category: row.equipment_category || "",
    condition: row.condition_label || "",
    availability: row.availability_status,
    short_description: row.short_description || "",
    specifications: safeJson(row.specifications_json, {}),
    features: safeJson(row.features_json, []),
    price:
      booleanValue(row.show_price) && row.display_price !== null
        ? { currency: row.currency_code, amount: row.display_price }
        : null,
    hire_available: booleanValue(row.hire_available),
    finance_available: booleanValue(row.finance_available),
    division: row.division_slug
      ? { slug: row.division_slug, name: row.division_name }
      : null,
    media: mapMedia(row),
  };
}

async function listPublicLocations({ divisionSlug } = {}) {
  const filters = [publicationPredicate("l")];
  const values = [];

  if (divisionSlug) {
    const slug = normalizeSlug(divisionSlug, 180);
    if (!slug) return [];
    filters.push("d.slug = ?");
    values.push(slug);
  }

  const rows = await query(
    `SELECT
       l.location_key,
       l.slug,
       l.name,
       l.location_type,
       l.address_line,
       l.city,
       l.region,
       l.country,
       l.latitude,
       l.longitude,
       l.phone,
       l.email,
       l.business_hours_json,
       l.map_url,
       d.slug AS division_slug,
       d.name AS division_name,
       ${mediaColumns("media")}
     FROM public_locations l
     LEFT JOIN public_business_divisions d
       ON d.id = l.division_id
      AND ${publicationPredicate("d")}
     ${publicMediaJoin("media", "l.featured_media_asset_id")}
     WHERE ${filters.join(" AND ")}
     ORDER BY l.sort_order, l.name`,
    values
  );

  return rows.map((row) => ({
    key: row.location_key,
    slug: row.slug,
    name: row.name,
    type: row.location_type,
    address: row.address_line || "",
    city: row.city || "",
    region: row.region || "",
    country: row.country,
    coordinates:
      row.latitude !== null && row.longitude !== null
        ? { latitude: row.latitude, longitude: row.longitude }
        : null,
    phone: row.phone || "",
    email: row.email || "",
    business_hours: safeJson(row.business_hours_json, {}),
    map_url: row.map_url || null,
    division: row.division_slug
      ? { slug: row.division_slug, name: row.division_name }
      : null,
    media: mapMedia(row),
  }));
}

async function listPublicFaqs({ category } = {}) {
  const filters = [publicationPredicate("f")];
  const values = [];

  if (category) {
    const safeCategory = String(category).trim().slice(0, 150);
    filters.push("f.category_label = ?");
    values.push(safeCategory);
  }

  const rows = await query(
    `SELECT faq_key, category_label, question, answer_json, sort_order
     FROM public_faqs f
     WHERE ${filters.join(" AND ")}
     ORDER BY f.category_label, f.sort_order, f.id`,
    values
  );

  return rows.map((row) => ({
    key: row.faq_key,
    category: row.category_label || "General",
    question: row.question,
    answer: safeJson(row.answer_json, {}),
    sort_order: Number(row.sort_order || 0),
  }));
}

async function listPublicVacancies({ limit, offset, divisionSlug } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = [publicationPredicate("v")];
  const values = [];

  if (divisionSlug) {
    const slug = normalizeSlug(divisionSlug, 180);
    if (!slug) return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    filters.push("d.slug = ?");
    values.push(slug);
  }

  filters.push("(v.opens_at IS NULL OR v.opens_at <= UTC_TIMESTAMP())");
  filters.push("(v.closes_at IS NULL OR v.closes_at > UTC_TIMESTAMP())");
  const where = filters.join(" AND ");

  const [rows, countRows] = await Promise.all([
    query(
      `SELECT
         v.vacancy_key,
         v.slug,
         v.title,
         v.employment_type,
         v.summary,
         v.vacancies_count,
         v.opens_at,
         v.closes_at,
         v.application_url,
         d.slug AS division_slug,
         d.name AS division_name,
         l.slug AS location_slug,
         l.name AS location_name,
         ${mediaColumns("media")}
       FROM public_job_vacancies v
       LEFT JOIN public_business_divisions d
         ON d.id = v.division_id
        AND ${publicationPredicate("d")}
       LEFT JOIN public_locations l
         ON l.id = v.location_id
        AND ${publicationPredicate("l")}
       ${publicMediaJoin("media", "v.featured_media_asset_id")}
       WHERE ${where}
       ORDER BY v.closes_at, v.published_at DESC, v.id DESC
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM public_job_vacancies v
       LEFT JOIN public_business_divisions d
         ON d.id = v.division_id
        AND ${publicationPredicate("d")}
       WHERE ${where}`,
      values
    ),
  ]);

  return {
    items: rows.map((row) => ({
      key: row.vacancy_key,
      slug: row.slug,
      title: row.title,
      employment_type: row.employment_type || "",
      summary: row.summary || "",
      vacancies_count: Number(row.vacancies_count || 1),
      opens_at: row.opens_at || null,
      closes_at: row.closes_at || null,
      application_url: row.application_url || null,
      division: row.division_slug
        ? { slug: row.division_slug, name: row.division_name }
        : null,
      location: row.location_slug
        ? { slug: row.location_slug, name: row.location_name }
        : null,
      media: mapMedia(row),
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublicVacancyBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       v.vacancy_key,
       v.slug,
       v.title,
       v.employment_type,
       v.summary,
       v.description_json,
       v.requirements_json,
       v.application_instructions_json,
       v.application_url,
       v.vacancies_count,
       v.opens_at,
       v.closes_at,
       d.slug AS division_slug,
       d.name AS division_name,
       l.slug AS location_slug,
       l.name AS location_name,
       ${mediaColumns("media")}
     FROM public_job_vacancies v
     LEFT JOIN public_business_divisions d
       ON d.id = v.division_id
      AND ${publicationPredicate("d")}
     LEFT JOIN public_locations l
       ON l.id = v.location_id
      AND ${publicationPredicate("l")}
     ${publicMediaJoin("media", "v.featured_media_asset_id")}
     WHERE v.slug = ?
       AND ${publicationPredicate("v")}
       AND (v.opens_at IS NULL OR v.opens_at <= UTC_TIMESTAMP())
       AND (v.closes_at IS NULL OR v.closes_at > UTC_TIMESTAMP())
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    key: row.vacancy_key,
    slug: row.slug,
    title: row.title,
    employment_type: row.employment_type || "",
    summary: row.summary || "",
    description: safeJson(row.description_json, {}),
    requirements: safeJson(row.requirements_json, []),
    application_instructions: safeJson(row.application_instructions_json, {}),
    application_url: row.application_url || null,
    vacancies_count: Number(row.vacancies_count || 1),
    opens_at: row.opens_at || null,
    closes_at: row.closes_at || null,
    division: row.division_slug
      ? { slug: row.division_slug, name: row.division_name }
      : null,
    location: row.location_slug
      ? { slug: row.location_slug, name: row.location_name }
      : null,
    media: mapMedia(row),
  };
}

async function listPublicTenders({ limit, offset, divisionSlug } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = [publicationPredicate("t")];
  const values = [];

  if (divisionSlug) {
    const slug = normalizeSlug(divisionSlug, 180);
    if (!slug) return { items: [], total: 0, limit: safeLimit, offset: safeOffset };
    filters.push("d.slug = ?");
    values.push(slug);
  }

  filters.push("(t.opens_at IS NULL OR t.opens_at <= UTC_TIMESTAMP())");
  filters.push("(t.closes_at IS NULL OR t.closes_at > UTC_TIMESTAMP())");
  const where = filters.join(" AND ");

  const [rows, countRows] = await Promise.all([
    query(
      `SELECT
         t.tender_key,
         t.slug,
         t.reference_number,
         t.title,
         t.summary,
         t.opens_at,
         t.closes_at,
         d.slug AS division_slug,
         d.name AS division_name,
         ${mediaColumns("document", "document")}
       FROM public_tenders t
       LEFT JOIN public_business_divisions d
         ON d.id = t.division_id
        AND ${publicationPredicate("d")}
       ${publicMediaJoin("document", "t.document_media_asset_id")}
       WHERE ${where}
       ORDER BY t.closes_at, t.published_at DESC, t.id DESC
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM public_tenders t
       LEFT JOIN public_business_divisions d
         ON d.id = t.division_id
        AND ${publicationPredicate("d")}
       WHERE ${where}`,
      values
    ),
  ]);

  return {
    items: rows.map((row) => ({
      key: row.tender_key,
      slug: row.slug,
      reference_number: row.reference_number || null,
      title: row.title,
      summary: row.summary || "",
      opens_at: row.opens_at || null,
      closes_at: row.closes_at || null,
      division: row.division_slug
        ? { slug: row.division_slug, name: row.division_name }
        : null,
      document: mapMedia(row, "document"),
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublicTenderBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       t.tender_key,
       t.slug,
       t.reference_number,
       t.title,
       t.summary,
       t.details_json,
       t.submission_instructions_json,
       t.opens_at,
       t.closes_at,
       d.slug AS division_slug,
       d.name AS division_name,
       ${mediaColumns("document", "document")}
     FROM public_tenders t
     LEFT JOIN public_business_divisions d
       ON d.id = t.division_id
      AND ${publicationPredicate("d")}
     ${publicMediaJoin("document", "t.document_media_asset_id")}
     WHERE t.slug = ?
       AND ${publicationPredicate("t")}
       AND (t.opens_at IS NULL OR t.opens_at <= UTC_TIMESTAMP())
       AND (t.closes_at IS NULL OR t.closes_at > UTC_TIMESTAMP())
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    key: row.tender_key,
    slug: row.slug,
    reference_number: row.reference_number || null,
    title: row.title,
    summary: row.summary || "",
    details: safeJson(row.details_json, {}),
    submission_instructions: safeJson(row.submission_instructions_json, {}),
    opens_at: row.opens_at || null,
    closes_at: row.closes_at || null,
    division: row.division_slug
      ? { slug: row.division_slug, name: row.division_name }
      : null,
    document: mapMedia(row, "document"),
  };
}

async function getPublicFormBySlug(rawSlug, { includeInternalId = false } = {}) {
  const slug = normalizeSlug(rawSlug, 180);
  if (!slug) return null;

  const rows = await query(
    `SELECT
       id AS internal_form_id,
       form_key,
       slug,
       name,
       form_type,
       description,
       confirmation_message,
       settings_json
     FROM public_forms f
     WHERE f.slug = ?
       AND ${publicationPredicate("f")}
     LIMIT 1`,
    [slug]
  );

  const row = rows[0];
  if (!row) return null;

  const fieldRows = await query(
    `SELECT
       field_key,
       field_type,
       label,
       placeholder,
       help_text,
       is_required,
       options_json,
       validation_json,
       sort_order
     FROM public_form_fields
     WHERE form_id = ?
       AND is_active = 1
     ORDER BY sort_order, id`,
    [row.internal_form_id]
  );

  const form = {
    key: row.form_key,
    slug: row.slug,
    name: row.name,
    type: row.form_type,
    description: row.description || "",
    confirmation_message:
      row.confirmation_message || "Thank you. Your information was received.",
    settings: safeJson(row.settings_json, {}),
    fields: fieldRows.map((field) => ({
      key: field.field_key,
      type: field.field_type,
      label: field.label,
      placeholder: field.placeholder || "",
      help_text: field.help_text || "",
      required: booleanValue(field.is_required),
      options: safeJson(field.options_json, []),
      validation: safeJson(field.validation_json, {}),
      sort_order: Number(field.sort_order || 0),
    })),
  };

  if (includeInternalId) {
    form.internal_form_id = row.internal_form_id;
  }

  return form;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  booleanValue,
  clampLimit,
  getPublicBootstrap,
  getPublicDivisionBySlug,
  getPublicEquipmentBySlug,
  getPublicFormBySlug,
  getPublicNewsBySlug,
  getPublicPageBySlug,
  getPublicProjectBySlug,
  getPublicTenderBySlug,
  getPublicVacancyBySlug,
  listPublicDivisions,
  listPublicEquipment,
  listPublicFaqs,
  listPublicLeadership,
  listPublicLocations,
  listPublicNews,
  listPublicProjects,
  listPublicTenders,
  listPublicVacancies,
  mapMedia,
  mediaColumns,
  normalizeOffset,
  normalizeSlug,
  pageVersionPredicate,
  publicationPredicate,
  publicMediaJoin,
  safeJson,
  schemaNotReadyError,
};
