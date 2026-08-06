"use strict";

const {
  ContentStudioError,
  booleanValue,
  cleanText,
  normalizeDateTime,
  positiveInteger,
  validatePublishingWindow,
} = require("./contentStudioPageService");

const NEWSROOM_KINDS = Object.freeze(["article", "announcement"]);
const ANNOUNCEMENT_STYLES = Object.freeze([
  "info",
  "success",
  "warning",
  "urgent",
  "promotion",
]);

const CONFIG = Object.freeze({
  article: Object.freeze({
    entityType: "news_article",
    table: "public_news_articles",
    keyColumn: "article_key",
    label: "News article",
    searchSql:
      "(e.title LIKE ? OR e.slug LIKE ? OR e.author_display_name LIKE ?)",
    orderSql: "e.updated_at DESC, e.id DESC",
  }),
  announcement: Object.freeze({
    entityType: "announcement",
    table: "public_announcements",
    keyColumn: "announcement_key",
    label: "Announcement",
    searchSql: "(e.title LIKE ? OR e.body_text LIKE ?)",
    orderSql: "e.priority DESC, e.updated_at DESC, e.id DESC",
  }),
});

function configFor(kind) {
  const normalized = cleanText(kind, 30).toLowerCase();
  const config = CONFIG[normalized];
  if (!config) {
    throw new ContentStudioError("Choose a supported Newsroom manager.", {
      code: "UNSUPPORTED_NEWSROOM_KIND",
      statusCode: 400,
    });
  }
  return { kind: normalized, ...config };
}

function normalizeKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeSlug(value) {
  const slug = cleanText(value, 200).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function normalizeInteger(value, fallback = 0, minimum = -1000, maximum = 1000) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function safeAnnouncementUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return null;
  if (/^\/(?!\/)[^\s]*$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function commonWindow(input, fallback) {
  const publishAt = normalizeDateTime(input.publish_at ?? fallback.publish_at);
  const expiresAt = normalizeDateTime(input.expires_at ?? fallback.expires_at);
  validatePublishingWindow(publishAt, expiresAt);
  return { publish_at: publishAt, expires_at: expiresAt };
}

function sanitizeArticle(input = {}, fallback = {}) {
  const articleKey = normalizeKey(
    input.article_key ?? input.key ?? fallback.article_key
  );
  const slug = normalizeSlug(input.slug ?? fallback.slug);
  const title = cleanText(input.title ?? fallback.title, 255);
  if (!articleKey || !slug || !title) {
    throw new ContentStudioError(
      "Article key, public slug and title are required.",
      { code: "INVALID_NEWS_ARTICLE", statusCode: 400 }
    );
  }

  return {
    article_key: articleKey,
    slug,
    category_id: positiveInteger(input.category_id ?? fallback.category_id),
    title,
    excerpt: cleanText(input.excerpt ?? fallback.excerpt, 5000) || null,
    body:
      input.body ??
      input.body_json ??
      fallback.body ??
      fallback.body_json ??
      {},
    author_display_name:
      cleanText(
        input.author_display_name ?? fallback.author_display_name,
        180
      ) || null,
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
    is_featured: booleanValue(
      input.is_featured,
      booleanValue(fallback.is_featured)
    ),
    seo_title: cleanText(input.seo_title ?? fallback.seo_title, 255) || null,
    meta_description:
      cleanText(
        input.meta_description ?? fallback.meta_description,
        500
      ) || null,
    ...commonWindow(input, fallback),
  };
}

function sanitizeAnnouncement(input = {}, fallback = {}) {
  const announcementKey = normalizeKey(
    input.announcement_key ?? input.key ?? fallback.announcement_key
  );
  const title = cleanText(input.title ?? fallback.title, 255);
  if (!announcementKey || !title) {
    throw new ContentStudioError(
      "Announcement key and title are required.",
      { code: "INVALID_PUBLIC_ANNOUNCEMENT", statusCode: 400 }
    );
  }

  const rawUrl = input.link_url ?? fallback.link_url;
  const linkUrl = safeAnnouncementUrl(rawUrl);
  const linkLabel = cleanText(input.link_label ?? fallback.link_label, 120) || null;
  if (rawUrl && !linkUrl) {
    throw new ContentStudioError(
      "Announcement links must use a safe relative path or HTTPS URL.",
      { code: "INVALID_ANNOUNCEMENT_URL", statusCode: 400 }
    );
  }
  if ((linkUrl && !linkLabel) || (!linkUrl && linkLabel)) {
    throw new ContentStudioError(
      "Announcement link label and URL must be supplied together.",
      { code: "ANNOUNCEMENT_LINK_INCOMPLETE", statusCode: 400 }
    );
  }

  const rawStyle = cleanText(
    input.display_style ?? fallback.display_style ?? "info",
    50
  ).toLowerCase();
  if (!ANNOUNCEMENT_STYLES.includes(rawStyle)) {
    throw new ContentStudioError("Choose a supported announcement style.", {
      code: "INVALID_ANNOUNCEMENT_STYLE",
      statusCode: 400,
    });
  }

  return {
    announcement_key: announcementKey,
    title,
    body_text: cleanText(input.body_text ?? fallback.body_text, 5000) || null,
    link_label: linkLabel,
    link_url: linkUrl,
    display_style: rawStyle,
    priority: normalizeInteger(input.priority ?? fallback.priority, 0),
    ticker_enabled: booleanValue(
      input.ticker_enabled,
      booleanValue(fallback.ticker_enabled)
    ),
    ...commonWindow(input, fallback),
  };
}

function sanitizeSnapshot(kind, input = {}, fallback = {}) {
  const normalizedKind = configFor(kind).kind;
  return normalizedKind === "article"
    ? sanitizeArticle(input, fallback)
    : sanitizeAnnouncement(input, fallback);
}

module.exports = {
  ANNOUNCEMENT_STYLES,
  CONFIG,
  NEWSROOM_KINDS,
  configFor,
  normalizeInteger,
  normalizeKey,
  normalizeSlug,
  safeAnnouncementUrl,
  sanitizeAnnouncement,
  sanitizeArticle,
  sanitizeSnapshot,
};
