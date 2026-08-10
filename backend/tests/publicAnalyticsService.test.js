"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clampSummaryDays,
  cleanRoutePath,
  getPublicAnalyticsSummary,
  recordPublicPageView,
} = require("../services/publicAnalyticsService");

const PUBLIC_PATHS = [
  "/",
  "/about",
  "/businesses/spare-parts",
  "/news/company-update",
  "/equipment/excavator-01",
  "/contact",
  "/forms/quotation",
];

const PRIVATE_PATHS = [
  "/api/health",
  "/login",
  "/staff/dashboard",
  "/content-studio",
  "/content-studio/pages",
  "/intelligence",
  "/mining/dashboard",
  "/equipment-hire-operations",
  "/equipment-installment-finance",
  "/group-executive-control",
  "/system/diagnostics",
  "/settings",
  "/users",
  "/backups",
];

test("public analytics path normalization strips query/hash and rejects private application roots", () => {
  for (const path of PUBLIC_PATHS) {
    assert.equal(cleanRoutePath(path), path);
  }
  assert.equal(cleanRoutePath("/news/story?campaign=private#section"), "/news/story");
  assert.equal(cleanRoutePath("/about/"), "/about");
  assert.equal(cleanRoutePath("//external.example/path"), null);
  assert.equal(cleanRoutePath("https://external.example/path"), null);
  for (const path of PRIVATE_PATHS) assert.equal(cleanRoutePath(path), null, path);
});

test("analytics summary period is tightly bounded", () => {
  assert.equal(clampSummaryDays(undefined), 30);
  assert.equal(clampSummaryDays(0), 30);
  assert.equal(clampSummaryDays(7), 7);
  assert.equal(clampSummaryDays(90), 90);
  assert.equal(clampSummaryDays(365), 90);
});

test("page-view writes contain only normalized public route and aggregate counter SQL", async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };

  const result = await recordPublicPageView("/news/story?source=email", connection);
  assert.equal(result.recorded, true);
  assert.equal(result.route_path, "/news/story");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ["/news/story"]);
  assert.match(calls[0].sql, /page_views = page_views \+ 1/);
  assert.doesNotMatch(calls[0].sql, /ip|user_agent|cookie|visitor|form|email|phone/i);

  const blocked = await recordPublicPageView("/content-studio/pages", connection);
  assert.equal(blocked.recorded, false);
  assert.equal(calls.length, 1);
});

test("Studio analytics summary returns aggregate counts plus explicit privacy posture", async () => {
  const connection = {
    async query(sql) {
      if (/COUNT\(DISTINCT route_path\)/.test(sql)) {
        return [[{
          total_page_views: 42,
          unique_public_routes: 3,
          first_metric_date: "2026-08-08",
          last_metric_date: "2026-08-10",
        }]];
      }
      if (/GROUP BY route_path/.test(sql)) {
        return [[{
          route_path: "/",
          page_views: 30,
          first_metric_date: "2026-08-08",
          last_metric_date: "2026-08-10",
        }]];
      }
      if (/GROUP BY metric_date/.test(sql)) {
        return [[{ metric_date: "2026-08-10", page_views: 14 }]];
      }
      throw new Error("Unexpected analytics query");
    },
  };

  const summary = await getPublicAnalyticsSummary({ days: 7 }, connection);
  assert.equal(summary.days, 7);
  assert.equal(summary.totals.page_views, 42);
  assert.equal(summary.top_routes[0].route_path, "/");
  assert.equal(summary.trend[0].page_views, 14);
  assert.equal(summary.privacy.aggregate_only, true);
  assert.equal(summary.privacy.stores_raw_ip, false);
  assert.equal(summary.privacy.stores_user_agent, false);
  assert.equal(summary.privacy.stores_cookie_id, false);
  assert.equal(summary.privacy.stores_visitor_id, false);
  assert.equal(summary.privacy.stores_form_content, false);
  assert.equal(summary.privacy.stores_staff_activity, false);
});
