"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  COMPANY_INFO_KINDS,
  configFor,
  safePublicUrl,
  sanitizeDivision,
  sanitizeFaq,
  sanitizeLocation,
  sanitizeStatistic,
  sanitizeTender,
  sanitizeTestimonial,
  sanitizeVacancy,
} = require("../services/contentStudioCompanyInfoSchema");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = [
  "contentStudioCompanyInfoSchema.js",
  "contentStudioCompanyInfoStore.js",
  "contentStudioCompanyInfoWorkflow.js",
]
  .map((fileName) =>
    fs.readFileSync(path.join(repoRoot, "backend/services", fileName), "utf8")
  )
  .join("\n");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioCompanyInfoRoutes.js"),
  "utf8"
);
const aggregatorSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const publicRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicContentRoutes.js"),
  "utf8"
);
const mediaUsageSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaUsageService.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260805_chalin_one_public_content_foundation.sql"
  ),
  "utf8"
);

test("company information manager supports exactly the seven planned types", () => {
  assert.deepEqual(COMPANY_INFO_KINDS, [
    "division",
    "location",
    "statistic",
    "testimonial",
    "faq",
    "vacancy",
    "tender",
  ]);
  assert.equal(configFor("division").table, "public_business_divisions");
  assert.equal(configFor("location").table, "public_locations");
  assert.equal(configFor("statistic").table, "public_company_statistics");
  assert.equal(configFor("testimonial").table, "public_testimonials");
  assert.equal(configFor("faq").table, "public_faqs");
  assert.equal(configFor("vacancy").table, "public_job_vacancies");
  assert.equal(configFor("tender").table, "public_tenders");
  assert.throws(
    () => configFor("users"),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "UNSUPPORTED_COMPANY_INFO_KIND"
  );
});

test("division contacts and location coordinates are validated", () => {
  const division = sanitizeDivision({
    division_key: "mining_operations",
    slug: "mining-operations",
    name: "Mining Operations",
    contact_email: "info@chalin03.com",
    contact_phone: "+233 24 000 0000",
  });
  assert.equal(division.contact_email, "info@chalin03.com");
  assert.throws(
    () =>
      sanitizeDivision({
        division_key: "bad",
        slug: "bad",
        name: "Bad",
        contact_email: "not-email",
      }),
    /email/i
  );

  const location = sanitizeLocation({
    location_key: "dunkwa_office",
    slug: "dunkwa-office",
    name: "Dunkwa Office",
    latitude: 5.965,
    longitude: -1.78,
    map_url: "https://maps.google.com/example",
  });
  assert.equal(location.latitude, 5.965);
  assert.throws(
    () =>
      sanitizeLocation({
        location_key: "bad",
        slug: "bad",
        name: "Bad",
        latitude: 100,
        longitude: 0,
      }),
    /Latitude/
  );
  assert.throws(
    () =>
      sanitizeLocation({
        location_key: "bad",
        slug: "bad",
        name: "Bad",
        latitude: 5,
      }),
    /together/
  );
});

test("statistics testimonials and FAQs enforce business validation", () => {
  const statistic = sanitizeStatistic({
    statistic_key: "staff_count",
    label: "Staff",
    display_value: "120+",
    numeric_value: 120,
    as_of_date: "2026-08-06",
  });
  assert.equal(statistic.numeric_value, 120);
  assert.throws(
    () =>
      sanitizeStatistic({
        statistic_key: "bad",
        label: "Bad",
        display_value: "x",
        numeric_value: "NaN",
      }),
    /numeric value/
  );

  const testimonial = sanitizeTestimonial({
    testimonial_key: "client_one",
    customer_display_name: "Kofi",
    quote_text: "Excellent service",
    rating: 5,
  });
  assert.equal(testimonial.rating, 5);
  assert.throws(
    () =>
      sanitizeTestimonial({
        testimonial_key: "bad",
        customer_display_name: "Kofi",
        quote_text: "Text",
        rating: 6,
      }),
    /between 1 and 5/
  );

  const faq = sanitizeFaq({
    faq_key: "delivery",
    question: "Do you deliver?",
    answer: { type: "paragraph", text: "Yes" },
  });
  assert.equal(faq.question, "Do you deliver?");
  assert.throws(
    () => sanitizeFaq({ faq_key: "bad", question: "Missing answer" }),
    /required/
  );
});

test("vacancy and tender windows and public URLs fail safely", () => {
  assert.equal(safePublicUrl("/apply"), "/apply");
  assert.equal(
    safePublicUrl("https://chalin03.com/apply"),
    "https://chalin03.com/apply"
  );
  assert.equal(safePublicUrl("http://example.com"), null);
  assert.equal(safePublicUrl("javascript:alert(1)"), null);

  const vacancy = sanitizeVacancy({
    vacancy_key: "accountant",
    slug: "accountant",
    title: "Accountant",
    vacancies_count: 2,
    opens_at: "2026-08-06T00:00:00Z",
    closes_at: "2026-08-31T23:59:59Z",
    application_url: "/forms/careers",
  });
  assert.equal(vacancy.vacancies_count, 2);
  assert.throws(
    () =>
      sanitizeVacancy({
        vacancy_key: "bad",
        slug: "bad",
        title: "Bad",
        vacancies_count: 0,
      }),
    /between 1 and 10,000/
  );

  const tender = sanitizeTender({
    tender_key: "fuel_supply",
    slug: "fuel-supply",
    title: "Fuel Supply",
    opens_at: "2026-08-06T00:00:00Z",
    closes_at: "2026-09-01T00:00:00Z",
  });
  assert.equal(tender.title, "Fuel Supply");
  assert.throws(
    () =>
      sanitizeTender({
        tender_key: "bad",
        slug: "bad",
        title: "Bad",
        opens_at: "2026-09-01",
        closes_at: "2026-08-01",
      }),
    /cannot be before/
  );
});

test("workflow uses exact-version approval and independent decisions", () => {
  assert.match(migrationSource, /content_version_id BIGINT UNSIGNED NULL/);
  assert.match(serviceSource, /content_version_id = \?/);
  assert.match(serviceSource, /entity_id, content_version_id, request_type/);
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.doesNotMatch(serviceSource, /metadata_json/);
  assert.doesNotMatch(serviceSource, /JSON_EXTRACT/);
});

test("publication revalidates media and scheduling fails closed", () => {
  assert.match(serviceSource, /PUBLIC_MEDIA_NOT_READY/);
  assert.match(serviceSource, /PUBLIC_MEDIA_TYPE_INVALID/);
  assert.match(serviceSource, /COMPANY_INFO_SCHEDULING_NOT_READY/);
  assert.match(serviceSource, /version_status = 'superseded'/);
  assert.match(serviceSource, /executed_at = UTC_TIMESTAMP/);
  for (const type of [
    "business_division_version_snapshot",
    "location_version_snapshot",
    "testimonial_version_snapshot",
    "job_vacancy_version_snapshot",
    "tender_version_snapshot",
  ]) {
    assert.match(mediaUsageSource, new RegExp(type));
  }
});

test("division and location archive guards cover live and draft dependencies", () => {
  assert.match(serviceSource, /PUBLIC_DIVISION_IN_USE/);
  assert.match(serviceSource, /PUBLIC_LOCATION_IN_USE/);
  assert.match(serviceSource, /public_projects/);
  assert.match(serviceSource, /public_equipment_catalogue/);
  assert.match(serviceSource, /public_job_vacancies/);
  assert.match(serviceSource, /public_tenders/);
  assert.match(
    serviceSource,
    /JSON_CONTAINS\(snapshot_json, JSON_OBJECT\('division_id', \?\)\)/
  );
  assert.match(
    serviceSource,
    /JSON_CONTAINS\(snapshot_json, JSON_OBJECT\('location_id', \?\)\)/
  );
});

test("private manager and public read routes cover all seven types", () => {
  for (const permission of [
    "public_content.view",
    "public_content.create",
    "public_content.edit",
    "public_content.submit",
    "public_content.review",
    "public_content.approve",
    "public_content.publish",
    "public_content.restore_version",
    "public_content.archive",
  ]) {
    assert.match(routeSource, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(routeSource, /Cache-Control.*no-store/s);
  assert.match(
    aggregatorSource,
    /router\.use\("\/company-info", contentStudioCompanyInfoRoutes\)/
  );
  assert.match(publicRouteSource, /router\.get\("\/divisions"/);
  assert.match(publicRouteSource, /router\.get\("\/locations"/);
  assert.match(publicRouteSource, /router\.get\("\/testimonials"/);
  assert.match(publicRouteSource, /router\.get\("\/faqs"/);
  assert.match(publicRouteSource, /router\.get\("\/vacancies"/);
  assert.match(publicRouteSource, /router\.get\("\/tenders"/);
  assert.match(publicRouteSource, /getPublicBootstrap/);
});

test("migration contains every managed company-information table", () => {
  for (const table of [
    "public_business_divisions",
    "public_locations",
    "public_company_statistics",
    "public_testimonials",
    "public_faqs",
    "public_job_vacancies",
    "public_tenders",
  ]) {
    assert.match(migrationSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
