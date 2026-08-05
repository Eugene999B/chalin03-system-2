"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  clampTestimonialLimit,
  validRating,
} = require("../services/publicTestimonialService");

const repoRoot = path.resolve(__dirname, "../..");
const testimonialSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicTestimonialService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicContentRoutes.js"),
  "utf8"
);

test("testimonial limits and ratings are normalized", () => {
  assert.equal(clampTestimonialLimit(undefined), 12);
  assert.equal(clampTestimonialLimit("5"), 5);
  assert.equal(clampTestimonialLimit("500"), 50);
  assert.equal(validRating(1), 1);
  assert.equal(validRating("5"), 5);
  assert.equal(validRating(0), null);
  assert.equal(validRating(6), null);
  assert.equal(validRating(4.5), null);
});

test("testimonial service selects only published records and public-ready portraits", () => {
  assert.match(testimonialSource, /publicationPredicate\("t"\)/);
  assert.match(testimonialSource, /publicMediaJoin\("portrait"/);
  assert.match(testimonialSource, /public_testimonials/);
  assert.match(testimonialSource, /ORDER BY t\.sort_order/);
});

test("public route exposes testimonials as a cacheable read endpoint", () => {
  assert.match(routeSource, /listPublicTestimonials/);
  assert.match(routeSource, /router\.get\("\/testimonials"/);
  assert.match(routeSource, /cacheSeconds: 120/);
});

test("read and write traffic use separate limiting paths", () => {
  assert.match(routeSource, /function applyPublicReadLimiter/);
  assert.match(routeSource, /req\.method === "GET"/);
  assert.match(routeSource, /router\.use\(applyPublicReadLimiter\)/);
  assert.match(
    routeSource,
    /router\.post\([\s\S]*?publicSubmissionLimiter/
  );
});
