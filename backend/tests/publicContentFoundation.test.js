"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  clampLimit,
  mapMedia,
  normalizeOffset,
  normalizeSlug,
  pageVersionPredicate,
  publicationPredicate,
  publicMediaJoin,
  safeJson,
  schemaNotReadyError,
} = require("../services/publicContentService");
const {
  PublicSubmissionValidationError,
  generateReferenceCode,
  getIpHashSecret,
  hashNetworkIdentifier,
  isRequiredFieldSatisfied,
  normalizeEmail,
  normalizePhone,
  normalizeSourceUrl,
  validateAndSanitizeSubmission,
} = require("../services/publicFormSubmissionService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicContentService.js"),
  "utf8"
);
const submissionSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicFormSubmissionService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicContentRoutes.js"),
  "utf8"
);
const systemRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/systemRoutes.js"),
  "utf8"
);

function exampleForm(overrides = {}) {
  return {
    key: "contact",
    slug: "contact",
    type: "general_enquiry",
    confirmation_message: "Received.",
    settings: {
      require_contact: true,
      require_consent: true,
    },
    fields: [
      {
        key: "subject",
        type: "select",
        label: "Subject",
        required: true,
        options: ["Spare Parts", "Equipment Hire"],
        validation: {},
      },
      {
        key: "message",
        type: "textarea",
        label: "Message",
        required: true,
        options: [],
        validation: { max_length: 500 },
      },
    ],
    ...overrides,
  };
}

test("public slug, pagination and JSON helpers fail safely", () => {
  assert.equal(normalizeSlug("mining-operations"), "mining-operations");
  assert.equal(normalizeSlug(" Mining-Operations "), "mining-operations");
  assert.equal(normalizeSlug("../private"), null);
  assert.equal(normalizeSlug("has spaces"), null);
  assert.equal(clampLimit("25"), 25);
  assert.equal(clampLimit("1000"), 100);
  assert.equal(clampLimit("bad"), 12);
  assert.equal(normalizeOffset("20"), 20);
  assert.equal(normalizeOffset("-1"), 0);
  assert.deepEqual(safeJson('{"ok":true}', {}), { ok: true });
  assert.deepEqual(safeJson("not-json", {}), {});
});

test("publication predicates require published status and effective UTC dates", () => {
  const contentPredicate = publicationPredicate("article");
  const versionPredicate = pageVersionPredicate("version");

  assert.match(contentPredicate, /publication_status = 'published'/);
  assert.match(contentPredicate, /publish_at <= UTC_TIMESTAMP\(\)/);
  assert.match(contentPredicate, /expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(versionPredicate, /version_status = 'published'/);
  assert.match(versionPredicate, /publish_at <= UTC_TIMESTAMP\(\)/);
  assert.match(versionPredicate, /expires_at > UTC_TIMESTAMP\(\)/);
  assert.throws(() => publicationPredicate("bad alias"), /Unsafe/);
});

test("media joins expose only public ready active assets", () => {
  const join = publicMediaJoin("media", "article.featured_media_asset_id");
  assert.match(join, /visibility = 'public'/);
  assert.match(join, /processing_status = 'ready'/);
  assert.match(join, /is_active = 1/);

  assert.equal(mapMedia({ media_asset_key: null }), null);
  assert.deepEqual(
    mapMedia({
      media_asset_key: "hero-1",
      media_public_url: "https://cdn.example/hero.jpg",
      media_type: "image",
      media_mime_type: "image/jpeg",
      media_width: 1600,
      media_height: 900,
      media_alt_text: "Excavator at a mining site",
    }),
    {
      asset_key: "hero-1",
      url: "https://cdn.example/hero.jpg",
      media_type: "image",
      mime_type: "image/jpeg",
      width: 1600,
      height: 900,
      duration_seconds: null,
      alt_text: "Excavator at a mining site",
      caption: "",
      credit: "",
    }
  );
});

test("missing public schema becomes a controlled 503 error", () => {
  const translated = schemaNotReadyError({
    code: "ER_NO_SUCH_TABLE",
    message: "missing",
  });
  assert.equal(translated.code, "PUBLIC_CONTENT_SCHEMA_NOT_READY");
  assert.equal(translated.statusCode, 503);

  const original = new Error("other");
  original.code = "ER_BAD_FIELD_ERROR";
  assert.equal(schemaNotReadyError(original), original);
});

test("public form validation requires contact, consent and declared fields", () => {
  const form = exampleForm();

  assert.throws(
    () =>
      validateAndSanitizeSubmission(form, {
        responses: { subject: "Spare Parts", message: "Need a quotation" },
      }),
    (error) =>
      error instanceof PublicSubmissionValidationError &&
      error.details.some((detail) => /email address or phone/i.test(detail)) &&
      error.details.some((detail) => /Consent is required/i.test(detail))
  );

  assert.throws(
    () =>
      validateAndSanitizeSubmission(form, {
        email: "customer@example.com",
        consent_given: true,
        responses: {
          subject: "Spare Parts",
          message: "Need a quotation",
          internal_role: "admin",
        },
      }),
    (error) =>
      error instanceof PublicSubmissionValidationError &&
      error.details.some((detail) => /Unsupported form fields/i.test(detail))
  );
});

test("required checkbox fields require an affirmative value", () => {
  const requiredCheckbox = {
    key: "accept_terms",
    type: "checkbox",
    label: "Accept terms",
    required: true,
    options: [],
    validation: {},
  };

  assert.equal(isRequiredFieldSatisfied(requiredCheckbox, false), false);
  assert.equal(isRequiredFieldSatisfied(requiredCheckbox, "false"), false);
  assert.equal(isRequiredFieldSatisfied(requiredCheckbox, true), true);
  assert.equal(isRequiredFieldSatisfied(requiredCheckbox, "yes"), true);

  const form = exampleForm({
    fields: [...exampleForm().fields, requiredCheckbox],
  });

  assert.throws(
    () =>
      validateAndSanitizeSubmission(form, {
        email: "customer@example.com",
        consent_given: true,
        responses: {
          subject: "Spare Parts",
          message: "Need a quotation",
          accept_terms: false,
        },
      }),
    (error) =>
      error instanceof PublicSubmissionValidationError &&
      error.details.some((detail) => /Accept terms is required/i.test(detail))
  );
});

test("valid public form data is normalized without accepting unsupported options", () => {
  const form = exampleForm();

  assert.throws(
    () =>
      validateAndSanitizeSubmission(form, {
        email: "customer@example.com",
        consent_given: true,
        responses: { subject: "Secret Internal", message: "Hello" },
      }),
    /correct the form information/i
  );

  const sanitized = validateAndSanitizeSubmission(form, {
    full_name: "  Ama   Mensah ",
    email: " AMA@EXAMPLE.COM ",
    phone: "024 000 0000",
    company_name: "Example Mining Ltd",
    consent_given: "true",
    consent_text_version: "privacy-v1",
    source_page_slug: "contact",
    source_url: "https://www.chalin03.com/contact",
    responses: {
      subject: "Equipment Hire",
      message: "  Please contact me about an excavator.  ",
    },
  });

  assert.equal(sanitized.full_name, "Ama Mensah");
  assert.equal(sanitized.email, "ama@example.com");
  assert.equal(sanitized.phone, "0240000000");
  assert.equal(sanitized.consent_given, true);
  assert.equal(sanitized.responses.subject, "Equipment Hire");
  assert.equal(
    sanitized.responses.message,
    "Please contact me about an excavator."
  );
  assert.equal(sanitized.source_url, "https://www.chalin03.com/contact");
});

test("source URLs accept only HTTP or HTTPS without embedded credentials", () => {
  assert.equal(
    normalizeSourceUrl("https://www.chalin03.com/contact"),
    "https://www.chalin03.com/contact"
  );
  assert.equal(normalizeSourceUrl("javascript:alert(1)"), null);
  assert.equal(normalizeSourceUrl("https://user:pass@example.com/contact"), null);
  assert.equal(normalizeSourceUrl("not a url"), null);

  assert.throws(
    () =>
      validateAndSanitizeSubmission(exampleForm(), {
        email: "customer@example.com",
        consent_given: true,
        source_url: "javascript:alert(1)",
        responses: {
          subject: "Spare Parts",
          message: "Need a quotation",
        },
      }),
    (error) =>
      error instanceof PublicSubmissionValidationError &&
      error.details.some((detail) => /source URL is invalid/i.test(detail))
  );
});

test("honeypot submissions are accepted silently without database content", () => {
  const result = validateAndSanitizeSubmission(exampleForm(), {
    website: "https://spam.invalid",
  });

  assert.equal(result.honeypot, true);
  assert.equal(result.confirmation_message, "Received.");
});

test("email and phone normalization reject malformed contacts", () => {
  assert.equal(normalizeEmail("CUSTOMER@EXAMPLE.COM"), "customer@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizePhone("+233 24 000 0000"), "+233240000000");
  assert.equal(normalizePhone("abc"), null);
});

test("network identifiers use a dedicated HMAC secret and never plain storage", () => {
  const env = {
    NODE_ENV: "production",
    PUBLIC_FORM_IP_HASH_SECRET: "a".repeat(64),
  };
  const first = hashNetworkIdentifier("192.0.2.10", env);
  const second = hashNetworkIdentifier("192.0.2.10", env);
  const different = hashNetworkIdentifier("192.0.2.11", env);

  assert.equal(first.length, 64);
  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.notEqual(first, "192.0.2.10");
  assert.throws(
    () =>
      getIpHashSecret({
        NODE_ENV: "production",
        PUBLIC_FORM_IP_HASH_SECRET: "a".repeat(63),
      }),
    /at least 64 characters/
  );
});

test("public reference codes contain date and cryptographic token", () => {
  const code = generateReferenceCode(
    new Date("2026-08-05T12:00:00.000Z"),
    () => Buffer.from("a1b2c3d4e5f6", "hex")
  );
  assert.equal(code, "WEB-20260805-A1B2C3D4E5F6");
});

test("public route surface is anonymous, rate-limited and no-store for writes", () => {
  assert.doesNotMatch(routeSource, /requireAuth/);
  assert.match(routeSource, /express-rate-limit/);
  assert.match(routeSource, /PUBLIC_CONTENT_RATE_LIMITED/);
  assert.match(routeSource, /PUBLIC_FORM_RATE_LIMITED/);
  assert.match(routeSource, /Cache-Control.*no-store/s);
  assert.match(routeSource, /router\.get\("\/bootstrap"/);
  assert.match(routeSource, /router\.get\("\/pages\/:slug"/);
  assert.match(routeSource, /router\.get\("\/news"/);
  assert.match(routeSource, /router\.get\("\/equipment"/);
  assert.match(routeSource, /router\.get\("\/vacancies"/);
  assert.match(routeSource, /router\.get\("\/tenders"/);
  assert.match(
    routeSource,
    /router\.post\([\s\S]*?\/forms\/:slug\/submissions/
  );
});

test("system router blocks the full public API before any query when disabled", () => {
  assert.match(systemRouteSource, /requireFeature/);
  assert.match(
    systemRouteSource,
    /router\.use\([\s\S]*?"\/public\/content"[\s\S]*?requireFeature\("publicWebsite"\)[\s\S]*?publicContentRoutes/
  );
});

test("read service never selects drafts and submission service uses a transaction", () => {
  assert.match(serviceSource, /publication_status = 'published'/);
  assert.match(serviceSource, /version_status = 'published'/);
  assert.match(serviceSource, /visibility = 'public'/);
  assert.match(serviceSource, /processing_status = 'ready'/);
  assert.doesNotMatch(serviceSource, /publication_status\s*!=\s*'archived'/);

  assert.match(submissionSource, /beginTransaction\(\)/);
  assert.match(submissionSource, /commit\(\)/);
  assert.match(submissionSource, /rollback\(\)/);
  assert.match(submissionSource, /ip_hash/);
  assert.doesNotMatch(submissionSource, /ip_address/);
  assert.match(submissionSource, /public_submission_received/);
});
