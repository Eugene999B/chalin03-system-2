"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  MAX_FIELD_OPTIONS,
  MAX_FORM_FIELDS,
  RESERVED_FIELD_KEYS,
  SUPPORTED_FIELD_TYPES,
  sanitizeFields,
  sanitizeFormSnapshot,
} = require("../services/contentStudioFormSchema");
const {
  PublicSubmissionValidationError,
  validateAndSanitizeSubmission,
} = require("../services/publicFormSubmissionService");

const repoRoot = path.resolve(__dirname, "../..");
const schemaSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioFormSchema.js"),
  "utf8"
);
const serviceSource = [
  "contentStudioFormStore.js",
  "contentStudioFormDraftWorkflow.js",
  "contentStudioFormReviewWorkflow.js",
  "contentStudioFormPublishWorkflow.js",
]
  .map((fileName) =>
    fs.readFileSync(path.join(repoRoot, "backend/services", fileName), "utf8")
  )
  .join("\n");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioFormRoutes.js"),
  "utf8"
);
const aggregatorSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260805_chalin_one_public_content_foundation.sql"
  ),
  "utf8"
);

test("Form Builder exposes only submission-validator-backed field types", () => {
  assert.deepEqual(SUPPORTED_FIELD_TYPES, [
    "text",
    "textarea",
    "email",
    "tel",
    "number",
    "select",
    "radio",
    "multiselect",
    "checkbox_group",
    "checkbox",
    "boolean",
  ]);
  assert.equal(SUPPORTED_FIELD_TYPES.includes("file"), false);
  assert.equal(SUPPORTED_FIELD_TYPES.includes("html"), false);
  assert.equal(MAX_FORM_FIELDS, 60);
  assert.equal(MAX_FIELD_OPTIONS, 100);
});

test("reserved protocol keys and duplicate field keys are blocked", () => {
  assert.ok(RESERVED_FIELD_KEYS.includes("email"));
  assert.ok(RESERVED_FIELD_KEYS.includes("consent_given"));
  assert.throws(
    () => sanitizeFields([{ key: "email", type: "text", label: "Email" }]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_FORM_FIELD_KEY_RESERVED"
  );
  assert.throws(
    () =>
      sanitizeFields([
        { key: "message", type: "text", label: "One" },
        { key: "message", type: "text", label: "Two" },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_FORM_FIELD_KEY_DUPLICATE"
  );
});

test("choice fields require unique options and number ranges are ordered", () => {
  assert.throws(
    () =>
      sanitizeFields([
        { key: "subject", type: "select", label: "Subject", options: [] },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_FORM_OPTIONS_REQUIRED"
  );
  assert.throws(
    () =>
      sanitizeFields([
        {
          key: "subject",
          type: "select",
          label: "Subject",
          options: ["Hire", "Hire"],
        },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_FORM_OPTIONS_DUPLICATE"
  );
  assert.throws(
    () =>
      sanitizeFields([
        {
          key: "amount",
          type: "number",
          label: "Amount",
          validation: { minimum: 20, maximum: 10 },
        },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_FORM_NUMBER_RANGE_INVALID"
  );
});

test("a builder snapshot is accepted by the real public submission validator", () => {
  const snapshot = sanitizeFormSnapshot({
    form_key: "equipment_quote",
    slug: "equipment-quote",
    name: "Equipment Quote",
    form_type: "quote_request",
    settings: { require_contact: true, require_consent: true },
    fields: [
      {
        key: "equipment_type",
        type: "select",
        label: "Equipment type",
        required: true,
        options: ["Excavator", "Bulldozer"],
      },
      {
        key: "message",
        type: "textarea",
        label: "Message",
        required: true,
        validation: { max_length: 500 },
      },
      {
        key: "terms_confirmed",
        type: "checkbox",
        label: "I confirm the information",
        required: true,
      },
    ],
  });

  const publicForm = {
    key: snapshot.form_key,
    slug: snapshot.slug,
    type: snapshot.form_type,
    confirmation_message: snapshot.confirmation_message,
    settings: snapshot.settings,
    fields: snapshot.fields.map((field) => ({
      key: field.field_key,
      type: field.field_type,
      label: field.label,
      required: field.is_required,
      options: field.options,
      validation: field.validation,
    })),
  };
  const sanitized = validateAndSanitizeSubmission(publicForm, {
    email: "customer@example.com",
    consent_given: true,
    responses: {
      equipment_type: "Excavator",
      message: "Please send a quotation.",
      terms_confirmed: true,
    },
  });
  assert.equal(sanitized.responses.equipment_type, "Excavator");
  assert.equal(sanitized.responses.terms_confirmed, true);

  assert.throws(
    () =>
      validateAndSanitizeSubmission(publicForm, {
        email: "customer@example.com",
        consent_given: true,
        responses: {
          equipment_type: "Excavator",
          message: "Please send a quotation.",
          terms_confirmed: false,
        },
      }),
    (error) =>
      error instanceof PublicSubmissionValidationError &&
      error.details.some((detail) => /confirm the information is required/i.test(detail))
  );
});

test("Form Builder approval uses the real content_version_id schema", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_forms/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_form_fields/);
  assert.match(migrationSource, /content_version_id BIGINT UNSIGNED NULL/);
  assert.match(serviceSource, /content_version_id = \?/);
  assert.match(serviceSource, /entity_id, content_version_id, request_type/);
  assert.doesNotMatch(serviceSource, /metadata_json/);
  assert.doesNotMatch(serviceSource, /JSON_EXTRACT/);
});

test("live fields change only after approved publication", () => {
  assert.match(serviceSource, /snapshot_json/);
  assert.match(serviceSource, /replaceFields/);
  assert.match(serviceSource, /DELETE FROM public_form_fields WHERE form_id = \?/);
  assert.match(serviceSource, /PUBLIC_FORM_VERSION_NOT_APPROVED/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /PUBLIC_FORM_SCHEDULING_NOT_READY/);
});

test("restore creates an unscheduled draft and archive preserves submissions", () => {
  assert.match(serviceSource, /snapshot\.publish_at = null/);
  assert.match(serviceSource, /snapshot\.expires_at = null/);
  assert.match(serviceSource, /public_form_version_restored_as_draft/);
  assert.match(serviceSource, /approval_status = 'cancelled'/);
  assert.doesNotMatch(serviceSource, /DELETE FROM public_form_submissions/);
  assert.doesNotMatch(serviceSource, /DELETE FROM public_forms/);
});

test("Form Builder routes separate form management from approval and publishing", () => {
  assert.match(routeSource, /public_forms\.view/);
  assert.match(routeSource, /public_forms\.manage/);
  assert.match(routeSource, /public_content\.review/);
  assert.match(routeSource, /public_content\.approve/);
  assert.match(routeSource, /public_content\.submit/);
  assert.match(routeSource, /public_content\.publish/);
  assert.match(routeSource, /public_content\.restore_version/);
  assert.match(routeSource, /public_content\.archive/);
  assert.match(routeSource, /Cache-Control.*no-store/s);
  assert.match(
    aggregatorSource,
    /router\.use\("\/forms", contentStudioFormRoutes\)/
  );
});

test("schema contains no executable HTML or arbitrary regular-expression builder", () => {
  assert.doesNotMatch(schemaSource, /"(?:file|files|html|script)"/);
  assert.doesNotMatch(schemaSource, /new RegExp|pattern/);
});
