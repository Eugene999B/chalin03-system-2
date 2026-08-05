"use strict";

const crypto = require("node:crypto");
const { pool } = require("../config/db");
const {
  getPublicFormBySlug,
  normalizeSlug,
  safeJson,
  schemaNotReadyError,
} = require("./publicContentService");

const MAX_RESPONSE_KEYS = 100;
const MAX_TEXT_LENGTH = 5000;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_SOURCE_URL_LENGTH = 700;

class PublicSubmissionValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PublicSubmissionValidationError";
    this.code = "PUBLIC_SUBMISSION_INVALID";
    this.statusCode = 400;
    this.details = details;
  }
}

function cleanText(value, maximumLength = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizeEmail(value) {
  const email = cleanText(value, 180).toLowerCase();
  if (!email) return "";

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value) {
  const phone = cleanText(value, 50);
  if (!phone) return "";

  const compact = phone.replace(/[\s()-]/g, "");
  return /^\+?[0-9]{7,15}$/.test(compact) ? compact : null;
}

function truthy(value) {
  return value === true ||
    value === 1 ||
    ["1", "true", "yes", "on"].includes(
      String(value || "").trim().toLowerCase()
    );
}

function normalizeOptionValues(options) {
  if (!Array.isArray(options)) return [];

  return options
    .map((option) =>
      typeof option === "object" && option !== null
        ? option.value ?? option.key ?? option.label
        : option
    )
    .map((value) => cleanText(value, 255))
    .filter(Boolean);
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return true;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function sanitizeFieldValue(field, value) {
  const type = String(field.type || "text").trim().toLowerCase();
  const validation = safeJson(field.validation, {});
  const maximumLength = Math.min(
    Math.max(Number(validation?.max_length) || MAX_TEXT_LENGTH, 1),
    MAX_TEXT_LENGTH
  );

  if (type === "file" || type === "files") {
    throw new PublicSubmissionValidationError(
      `Field ${field.key} requires the separate secure upload workflow.`
    );
  }

  if (type === "checkbox" || type === "boolean") {
    return truthy(value);
  }

  if (type === "number") {
    if (!hasMeaningfulValue(value)) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} must be a valid number.`
      );
    }

    if (validation?.minimum !== undefined && number < Number(validation.minimum)) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} is below the allowed minimum.`
      );
    }

    if (validation?.maximum !== undefined && number > Number(validation.maximum)) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} is above the allowed maximum.`
      );
    }

    return number;
  }

  if (type === "multiselect" || type === "checkbox_group") {
    if (!Array.isArray(value)) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} must be a list of selected values.`
      );
    }

    const values = value
      .slice(0, 50)
      .map((item) => cleanText(item, 255))
      .filter(Boolean);
    const allowed = normalizeOptionValues(field.options);

    if (allowed.length > 0 && values.some((item) => !allowed.includes(item))) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} contains an unsupported option.`
      );
    }

    return values;
  }

  const text = cleanText(value, maximumLength);

  if (type === "email" && text) {
    const email = normalizeEmail(text);
    if (email === null) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} must be a valid email address.`
      );
    }
    return email;
  }

  if ((type === "tel" || type === "phone") && text) {
    const phone = normalizePhone(text);
    if (phone === null) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} must be a valid phone number.`
      );
    }
    return phone;
  }

  if (["select", "radio"].includes(type) && text) {
    const allowed = normalizeOptionValues(field.options);
    if (allowed.length > 0 && !allowed.includes(text)) {
      throw new PublicSubmissionValidationError(
        `${field.label || field.key} contains an unsupported option.`
      );
    }
  }

  return text;
}

function validateAndSanitizeSubmission(form, payload = {}) {
  if (!form || !Array.isArray(form.fields)) {
    throw new PublicSubmissionValidationError(
      "The selected public form is not available."
    );
  }

  if (payload && typeof payload !== "object") {
    throw new PublicSubmissionValidationError(
      "Submission data must be a JSON object."
    );
  }

  const honeypot = cleanText(
    payload.website || payload.company_website_confirm || "",
    255
  );

  if (honeypot) {
    return {
      honeypot: true,
      confirmation_message: form.confirmation_message,
    };
  }

  const fullName = cleanText(payload.full_name, 200);
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.phone);
  const companyName = cleanText(payload.company_name, 200);
  const consentGiven = truthy(payload.consent_given);
  const settings = safeJson(form.settings, {});
  const errors = [];

  if (email === null) errors.push("Enter a valid email address.");
  if (phone === null) errors.push("Enter a valid phone number.");

  if (settings.require_contact !== false && !email && !phone) {
    errors.push("Provide at least one email address or phone number.");
  }

  if (settings.require_consent !== false && !consentGiven) {
    errors.push("Consent is required before this form can be submitted.");
  }

  const responses =
    payload.responses && typeof payload.responses === "object" &&
    !Array.isArray(payload.responses)
      ? payload.responses
      : {};
  const responseKeys = Object.keys(responses);

  if (responseKeys.length > MAX_RESPONSE_KEYS) {
    errors.push(`A form submission may contain no more than ${MAX_RESPONSE_KEYS} fields.`);
  }

  const fieldsByKey = new Map(form.fields.map((field) => [field.key, field]));
  const unknownKeys = responseKeys.filter((key) => !fieldsByKey.has(key));
  if (unknownKeys.length > 0) {
    errors.push(`Unsupported form fields: ${unknownKeys.slice(0, 10).join(", ")}.`);
  }

  const sanitizedResponses = {};

  for (const field of form.fields) {
    const rawValue = responses[field.key];

    if (field.required && !hasMeaningfulValue(rawValue)) {
      errors.push(`${field.label || field.key} is required.`);
      continue;
    }

    if (!hasMeaningfulValue(rawValue)) continue;

    try {
      sanitizedResponses[field.key] = sanitizeFieldValue(field, rawValue);
    } catch (error) {
      if (error instanceof PublicSubmissionValidationError) {
        errors.push(error.message);
      } else {
        throw error;
      }
    }
  }

  if (errors.length > 0) {
    throw new PublicSubmissionValidationError(
      "Please correct the form information and try again.",
      errors
    );
  }

  return {
    honeypot: false,
    full_name: fullName || null,
    email: email || null,
    phone: phone || null,
    company_name: companyName || null,
    responses: sanitizedResponses,
    consent_given: consentGiven,
    consent_text_version: cleanText(payload.consent_text_version, 80) || null,
    consent_at: consentGiven ? new Date() : null,
    source_page_slug: normalizeSlug(payload.source_page_slug, 180),
    source_url: cleanText(payload.source_url, MAX_SOURCE_URL_LENGTH) || null,
    confirmation_message: form.confirmation_message,
  };
}

function getIpHashSecret(env = process.env) {
  const secret = String(env.PUBLIC_FORM_IP_HASH_SECRET || "").trim();
  const production =
    String(env.NODE_ENV || "").trim().toLowerCase() === "production";

  if (production && secret.length < 32) {
    const error = new Error(
      "PUBLIC_FORM_IP_HASH_SECRET must be configured with at least 32 characters before public forms are enabled in production."
    );
    error.code = "PUBLIC_FORM_SECURITY_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }

  return secret || null;
}

function hashNetworkIdentifier(value, env = process.env) {
  const secret = getIpHashSecret(env);
  const identifier = cleanText(value, 255);
  if (!secret || !identifier) return null;

  return crypto
    .createHmac("sha256", secret)
    .update(identifier)
    .digest("hex");
}

function generateReferenceCode(now = new Date(), randomBytes = crypto.randomBytes) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const token = randomBytes(6).toString("hex").toUpperCase();
  return `WEB-${date}-${token}`;
}

async function insertSubmission(connection, form, sanitized, requestContext) {
  const referenceCode = generateReferenceCode();
  const ipHash = hashNetworkIdentifier(requestContext?.ip);
  const userAgent = cleanText(
    requestContext?.userAgent,
    MAX_USER_AGENT_LENGTH
  );

  const [result] = await connection.query(
    `INSERT INTO public_form_submissions (
       form_id,
       reference_code,
       submission_status,
       full_name,
       email,
       phone,
       company_name,
       response_json,
       consent_given,
       consent_text_version,
       consent_at,
       source_page_slug,
       source_url,
       ip_hash,
       user_agent
     ) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      form.internal_form_id,
      referenceCode,
      sanitized.full_name,
      sanitized.email,
      sanitized.phone,
      sanitized.company_name,
      JSON.stringify(sanitized.responses),
      sanitized.consent_given ? 1 : 0,
      sanitized.consent_text_version,
      sanitized.consent_at,
      sanitized.source_page_slug,
      sanitized.source_url,
      ipHash,
      userAgent || null,
    ]
  );

  await connection.query(
    `INSERT INTO public_content_audit_log (
       entity_type,
       entity_id,
       action_key,
       request_id,
       metadata_json
     ) VALUES ('form_submission', ?, 'public_submission_received', ?, ?)`,
    [
      result.insertId,
      cleanText(requestContext?.requestId, 80) || null,
      JSON.stringify({
        form_key: form.key,
        form_type: form.type,
        consent_given: sanitized.consent_given,
        source_page_slug: sanitized.source_page_slug,
      }),
    ]
  );

  return {
    reference_code: referenceCode,
    confirmation_message: sanitized.confirmation_message,
  };
}

async function createPublicFormSubmission({
  formSlug,
  payload,
  requestContext = {},
}) {
  const form = await getPublicFormBySlug(formSlug, { includeInternalId: true });
  if (!form) return null;

  const sanitized = validateAndSanitizeSubmission(form, payload);

  if (sanitized.honeypot) {
    return {
      accepted: true,
      reference_code: null,
      confirmation_message: sanitized.confirmation_message,
    };
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await insertSubmission(
      connection,
      form,
      sanitized,
      requestContext
    );
    await connection.commit();

    return {
      accepted: true,
      ...result,
    };
  } catch (error) {
    await connection.rollback();
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  MAX_RESPONSE_KEYS,
  MAX_SOURCE_URL_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_USER_AGENT_LENGTH,
  PublicSubmissionValidationError,
  cleanText,
  createPublicFormSubmission,
  generateReferenceCode,
  getIpHashSecret,
  hashNetworkIdentifier,
  hasMeaningfulValue,
  normalizeEmail,
  normalizeOptionValues,
  normalizePhone,
  sanitizeFieldValue,
  truthy,
  validateAndSanitizeSubmission,
};
