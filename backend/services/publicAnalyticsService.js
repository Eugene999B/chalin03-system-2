"use strict";

const { pool } = require("../config/db");

const MAX_ROUTE_LENGTH = 220;
const DEFAULT_SUMMARY_DAYS = 30;
const MAX_SUMMARY_DAYS = 90;
const MAX_TOP_ROUTES = 50;

const PRIVATE_ROUTE_PREFIXES = Object.freeze([
  "/api",
  "/login",
  "/staff",
  "/content-studio",
  "/intelligence",
  "/mining",
  "/equipment-hire-operations",
  "/equipment-installment-finance",
  "/group-executive-control",
  "/system",
  "/settings",
  "/users",
  "/audit",
  "/backups",
]);

function cleanRoutePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > MAX_ROUTE_LENGTH * 2) return null;
  if (/[^\x20-\x7E]/.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  let pathname;
  try {
    pathname = new URL(raw, "https://chalin-one.invalid").pathname;
  } catch {
    return null;
  }

  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  if (!pathname || pathname.length > MAX_ROUTE_LENGTH) return null;

  const lower = pathname.toLowerCase();
  if (
    PRIVATE_ROUTE_PREFIXES.some(
      (prefix) => lower === prefix || lower.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }

  return pathname;
}

function clampSummaryDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) return DEFAULT_SUMMARY_DAYS;
  return Math.min(days, MAX_SUMMARY_DAYS);
}

async function recordPublicPageView(rawPath, connection = pool) {
  const routePath = cleanRoutePath(rawPath);
  if (!routePath) {
    return Object.freeze({ recorded: false, reason: "route_not_public" });
  }

  await connection.query(
    `INSERT INTO public_analytics_daily (
       metric_date,
       route_path,
       page_views,
       first_seen_at,
       last_seen_at
     ) VALUES (UTC_DATE(), ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       page_views = page_views + 1,
       last_seen_at = UTC_TIMESTAMP()`,
    [routePath]
  );

  return Object.freeze({ recorded: true, route_path: routePath });
}

async function getPublicAnalyticsSummary({ days } = {}, connection = pool) {
  const safeDays = clampSummaryDays(days);
  const intervalDays = safeDays - 1;

  const [totalsResult, topResult, trendResult] = await Promise.all([
    connection.query(
      `SELECT
         COALESCE(SUM(page_views), 0) AS total_page_views,
         COUNT(DISTINCT route_path) AS unique_public_routes,
         MIN(metric_date) AS first_metric_date,
         MAX(metric_date) AS last_metric_date
       FROM public_analytics_daily
       WHERE metric_date >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)`,
      [intervalDays]
    ),
    connection.query(
      `SELECT
         route_path,
         SUM(page_views) AS page_views,
         MIN(metric_date) AS first_metric_date,
         MAX(metric_date) AS last_metric_date
       FROM public_analytics_daily
       WHERE metric_date >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
       GROUP BY route_path
       ORDER BY page_views DESC, route_path ASC
       LIMIT ?`,
      [intervalDays, MAX_TOP_ROUTES]
    ),
    connection.query(
      `SELECT metric_date, SUM(page_views) AS page_views
       FROM public_analytics_daily
       WHERE metric_date >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
       GROUP BY metric_date
       ORDER BY metric_date ASC`,
      [intervalDays]
    ),
  ]);

  const totals = totalsResult?.[0]?.[0] || {};
  const topRows = Array.isArray(topResult?.[0]) ? topResult[0] : [];
  const trendRows = Array.isArray(trendResult?.[0]) ? trendResult[0] : [];

  return {
    days: safeDays,
    privacy: {
      aggregate_only: true,
      stores_raw_ip: false,
      stores_user_agent: false,
      stores_cookie_id: false,
      stores_visitor_id: false,
      stores_form_content: false,
      stores_staff_activity: false,
    },
    totals: {
      page_views: Number(totals?.total_page_views || 0),
      public_routes: Number(totals?.unique_public_routes || 0),
      first_metric_date: totals?.first_metric_date || null,
      last_metric_date: totals?.last_metric_date || null,
    },
    top_routes: topRows.map((row) => ({
      route_path: row.route_path,
      page_views: Number(row.page_views || 0),
      first_metric_date: row.first_metric_date || null,
      last_metric_date: row.last_metric_date || null,
    })),
    trend: trendRows.map((row) => ({
      metric_date: row.metric_date,
      page_views: Number(row.page_views || 0),
    })),
  };
}

module.exports = {
  DEFAULT_SUMMARY_DAYS,
  MAX_ROUTE_LENGTH,
  MAX_SUMMARY_DAYS,
  MAX_TOP_ROUTES,
  PRIVATE_ROUTE_PREFIXES,
  clampSummaryDays,
  cleanRoutePath,
  getPublicAnalyticsSummary,
  recordPublicPageView,
};
