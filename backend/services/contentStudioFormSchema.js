"use strict";

const {
  ContentStudioError,
  booleanValue,
  cleanText,
  normalizeDateTime,
  validatePublishingWindow,
} = require("./contentStudioPageService");

const MAX_FORM_FIELDS = 60;
const MAX_FIELD_OPTIONS = 100;
const SUPPORTED_FORM_TYPES = Object.freeze([
  "general_enquiry",
  "contact",
  "quote_request",
  "equipment_hire",
  "installment_application",
  "career_application",
  "supplier_registration",
  "tender_response",
]);
const SUPPORTED_FIELD_TYPES = Object.freeze([
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
const OPTION_FIELD_TYPES = Object.freeze([
  "select",
  "radio",
  "multiselect",
  "checkbox_group",
]);
const RESERVED_FIELD_KEYS = Object.freeze([
  "full_name",
  "email",
  "phone",
  "company_name",
  "consent_given",
  "consent_text_version",
  "source_page_slug",
  "source_url",
  "website",
  "company_website_confirm",
  "responses",
]);

function normalizeFormKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeFormSlug(value) {
  const slug = cleanText(value, 180).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function normalizeFormType(value) {
  const formType = cleanText(value, 100)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return SUPPORTED_FORM_TYPES.includes(formType) ? formType : null;
}

function normalizeFieldType(value) {
  const fieldType = cleanText(value, 80).toLowerCase();
  return SUPPORTED_FIELD_TYPES.includes(fieldType) ? fieldType : null;
}

function sanitizeOptions(value, fieldType) {
  if (!OPTION_FIELD_TYPES.includes(fieldType)) return [];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContentStudioError(
      "Select, radio and multi-choice fields require at least one option.",
      { code: "PUBLIC_FORM_OPTIONS_REQUIRED", statusCode: 400 }
    );
  }
  if (value.length > MAX_FIELD_OPTIONS) {
    throw new ContentStudioError(
      `A form field may contain no more than ${MAX_FIELD_OPTIONS} options.`,
      { code: "PUBLIC_FORM_OPTIONS_TOO_LARGE", statusCode: 413 }
    );
  }

  const options = value
    .map((item) =>
      cleanText(
        typeof item === "object" && item !== null
          ? item.value ?? item.key ?? item.label
          : item,
        255
      )
    )
    .filter(Boolean);
  if (options.length === 0) {
    throw new ContentStudioError("Form field options cannot be empty.", {
      code: "PUBLIC_FORM_OPTIONS_REQUIRED",
      statusCode: 400,
    });
  }
  if (new Set(options).size !== options.length) {
    throw new ContentStudioError("Form field options must be unique.", {
      code: "PUBLIC_FORM_OPTIONS_DUPLICATE",
      statusCode: 409,
    });
  }
  return options;
}

function sanitizeValidation(value, fieldType) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const validation = {};

  if (["text", "textarea", "email", "tel"].includes(fieldType)) {
    const maxLength = Number(input.max_length);
    if (Number.isFinite(maxLength)) {
      validation.max_length = Math.min(Math.max(Math.trunc(maxLength), 1), 5000);
    }
  }

  if (fieldType === "number") {
    const minimum =
      input.minimum === undefined || input.minimum === null || input.minimum === ""
        ? null
        : Number(input.minimum);
    const maximum =
      input.maximum === undefined || input.maximum === null || input.maximum === ""
        ? null
        : Number(input.maximum);
    if (minimum !== null && !Number.isFinite(minimum)) {
      throw new ContentStudioError("Number minimum must be valid.", {
        code: "PUBLIC_FORM_NUMBER_RANGE_INVALID",
        statusCode: 400,
      });
    }
    if (maximum !== null && !Number.isFinite(maximum)) {
      throw new ContentStudioError("Number maximum must be valid.", {
        code: "PUBLIC_FORM_NUMBER_RANGE_INVALID",
        statusCode: 400,
      });
    }
    if (minimum !== null) validation.minimum = minimum;
    if (maximum !== null) validation.maximum = maximum;
    if (minimum !== null && maximum !== null && maximum < minimum) {
      throw new ContentStudioError(
        "Number maximum cannot be below its minimum.",
        { code: "PUBLIC_FORM_NUMBER_RANGE_INVALID", statusCode: 400 }
      );
    }
  }

  return validation;
}

function sanitizeFields(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ContentStudioError("Form fields must be a list.", {
      code: "INVALID_PUBLIC_FORM_FIELDS",
      statusCode: 400,
    });
  }
  if (value.length > MAX_FORM_FIELDS) {
    throw new ContentStudioError(
      `A public form may contain no more than ${MAX_FORM_FIELDS} fields.`,
      { code: "PUBLIC_FORM_FIELDS_TOO_LARGE", statusCode: 413 }
    );
  }

  const keys = new Set();
  return value.map((field, index) => {
    const key = normalizeFormKey(field?.field_key ?? field?.key);
    const type = normalizeFieldType(field?.field_type ?? field?.type);
    const label = cleanText(field?.label, 220);

    if (!key || !type || !label) {
      throw new ContentStudioError(
        "Every form field requires a safe key, supported type and label.",
        { code: "INVALID_PUBLIC_FORM_FIELD", statusCode: 400 }
      );
    }
    if (RESERVED_FIELD_KEYS.includes(key)) {
      throw new ContentStudioError(
        `The field key ${key} is reserved by the public submission protocol.`,
        { code: "PUBLIC_FORM_FIELD_KEY_RESERVED", statusCode: 409 }
      );
    }
    if (keys.has(key)) {
      throw new ContentStudioError("Form field keys must be unique.", {
        code: "PUBLIC_FORM_FIELD_KEY_DUPLICATE",
        statusCode: 409,
      });
    }
    keys.add(key);

    return {
      field_key: key,
      field_type: type,
      label,
      placeholder: cleanText(field?.placeholder, 255) || null,
      help_text: cleanText(field?.help_text, 700) || null,
      is_required: booleanValue(field?.is_required ?? field?.required),
      options: sanitizeOptions(field?.options ?? field?.options_json, type),
      validation: sanitizeValidation(
        field?.validation ?? field?.validation_json,
        type
      ),
      sort_order: Number.isInteger(Number(field?.sort_order))
        ? Number(field.sort_order)
        : index,
    };
  });
}

function sanitizeSettings(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    require_contact: booleanValue(input.require_contact, true),
    require_consent: booleanValue(input.require_consent, true),
    submit_label: cleanText(input.submit_label, 80) || "Submit",
    consent_text_version:
      cleanText(input.consent_text_version, 80) || "privacy-v1",
  };
}

function sanitizeFormSnapshot(input = {}, fallback = {}) {
  const formKey = normalizeFormKey(
    input.form_key ?? input.key ?? fallback.form_key
  );
  const slug = normalizeFormSlug(input.slug ?? fallback.slug);
  const name = cleanText(input.name ?? fallback.name, 220);
  const formType = normalizeFormType(
    input.form_type ?? input.type ?? fallback.form_type ?? "general_enquiry"
  );
  if (!formKey || !slug || !name || !formType) {
    throw new ContentStudioError(
      "Form key, slug, name and supported form type are required.",
      { code: "INVALID_PUBLIC_FORM", statusCode: 400 }
    );
  }

  const publishAt = normalizeDateTime(input.publish_at ?? fallback.publish_at);
  const expiresAt = normalizeDateTime(input.expires_at ?? fallback.expires_at);
  validatePublishingWindow(publishAt, expiresAt);

  return {
    form_key: formKey,
    slug,
    name,
    form_type: formType,
    description: cleanText(input.description ?? fallback.description, 5000) || null,
    confirmation_message:
      cleanText(
        input.confirmation_message ?? fallback.confirmation_message,
        2000
      ) || "Thank you. Your information was received.",
    settings: sanitizeSettings(
      input.settings ?? input.settings_json ?? fallback.settings ?? fallback.settings_json
    ),
    fields: sanitizeFields(input.fields ?? fallback.fields),
    publish_at: publishAt,
    expires_at: expiresAt,
  };
}

module.exports = {
  MAX_FIELD_OPTIONS,
  MAX_FORM_FIELDS,
  OPTION_FIELD_TYPES,
  RESERVED_FIELD_KEYS,
  SUPPORTED_FIELD_TYPES,
  SUPPORTED_FORM_TYPES,
  normalizeFieldType,
  normalizeFormKey,
  normalizeFormSlug,
  normalizeFormType,
  sanitizeFields,
  sanitizeFormSnapshot,
  sanitizeOptions,
  sanitizeSettings,
  sanitizeValidation,
};
