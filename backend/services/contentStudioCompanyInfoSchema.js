"use strict";

const {
  ContentStudioError,
  cleanText,
  normalizeDateTime,
  positiveInteger,
  validatePublishingWindow,
} = require("./contentStudioPageService");

const COMPANY_INFO_KINDS = Object.freeze([
  "division",
  "location",
  "statistic",
  "testimonial",
  "faq",
  "vacancy",
  "tender",
]);

const CONFIG = Object.freeze({
  division: Object.freeze({
    entityType: "business_division",
    table: "public_business_divisions",
    keyColumn: "division_key",
    label: "Business division",
    searchSql: "(e.name LIKE ? OR e.short_description LIKE ?)",
    orderSql: "e.sort_order, e.name, e.id",
  }),
  location: Object.freeze({
    entityType: "location",
    table: "public_locations",
    keyColumn: "location_key",
    label: "Location",
    searchSql: "(e.name LIKE ? OR e.city LIKE ? OR e.region LIKE ?)",
    orderSql: "e.sort_order, e.name, e.id",
  }),
  statistic: Object.freeze({
    entityType: "company_statistic",
    table: "public_company_statistics",
    keyColumn: "statistic_key",
    label: "Company statistic",
    searchSql: "(e.label LIKE ? OR e.display_value LIKE ?)",
    orderSql: "e.sort_order, e.id",
  }),
  testimonial: Object.freeze({
    entityType: "testimonial",
    table: "public_testimonials",
    keyColumn: "testimonial_key",
    label: "Testimonial",
    searchSql:
      "(e.customer_display_name LIKE ? OR e.company_name LIKE ? OR e.quote_text LIKE ?)",
    orderSql: "e.sort_order, e.id",
  }),
  faq: Object.freeze({
    entityType: "faq",
    table: "public_faqs",
    keyColumn: "faq_key",
    label: "FAQ",
    searchSql: "(e.question LIKE ? OR e.category_label LIKE ?)",
    orderSql: "e.category_label, e.sort_order, e.id",
  }),
  vacancy: Object.freeze({
    entityType: "job_vacancy",
    table: "public_job_vacancies",
    keyColumn: "vacancy_key",
    label: "Vacancy",
    searchSql: "(e.title LIKE ? OR e.employment_type LIKE ? OR e.summary LIKE ?)",
    orderSql: "e.opens_at DESC, e.id DESC",
  }),
  tender: Object.freeze({
    entityType: "tender",
    table: "public_tenders",
    keyColumn: "tender_key",
    label: "Tender",
    searchSql: "(e.title LIKE ? OR e.reference_number LIKE ? OR e.summary LIKE ?)",
    orderSql: "e.opens_at DESC, e.id DESC",
  }),
});

function configFor(kind) {
  const normalized = cleanText(kind, 30).toLowerCase();
  const config = CONFIG[normalized];
  if (!config) {
    throw new ContentStudioError("Choose a supported company-information manager.", {
      code: "UNSUPPORTED_COMPANY_INFO_KIND",
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

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeDateOnly(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const raw = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ContentStudioError(`${label} must use YYYY-MM-DD format.`, {
      code: "INVALID_COMPANY_INFO_DATE",
      statusCode: 400,
    });
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new ContentStudioError(`${label} is not a valid calendar date.`, {
      code: "INVALID_COMPANY_INFO_DATE",
      statusCode: 400,
    });
  }
  return raw;
}

function normalizeDateTimeWindow(startValue, endValue, labels) {
  const start = normalizeDateTime(startValue);
  const end = normalizeDateTime(endValue);
  if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
    throw new ContentStudioError(`${labels.end} cannot be before ${labels.start}.`, {
      code: "INVALID_COMPANY_INFO_WINDOW",
      statusCode: 400,
    });
  }
  return [start, end];
}

function safePublicUrl(value) {
  const raw = cleanText(value, 700);
  if (!raw) return null;
  if (/^\/(?!\/)[^\s]*$/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString().slice(0, 700);
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  const email = cleanText(value, 180).toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value) {
  const phone = cleanText(value, 50);
  if (!phone) return null;
  return /^[+0-9][0-9()\-\s]{6,49}$/.test(phone) ? phone : null;
}

function normalizeJson(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "object") {
    throw new ContentStudioError("Structured content must be valid JSON data.", {
      code: "INVALID_COMPANY_INFO_JSON",
      statusCode: 400,
    });
  }
  return value;
}

function commonSnapshot(input, fallback, keyColumn, { slugRequired = false } = {}) {
  const key = normalizeKey(input[keyColumn] ?? input.key ?? fallback[keyColumn]);
  if (!key) {
    throw new ContentStudioError("A safe internal key is required.", {
      code: "INVALID_COMPANY_INFO_KEY",
      statusCode: 400,
    });
  }

  let slug = null;
  if (slugRequired) {
    slug = normalizeSlug(input.slug ?? fallback.slug);
    if (!slug) {
      throw new ContentStudioError("A safe public slug is required.", {
        code: "INVALID_COMPANY_INFO_SLUG",
        statusCode: 400,
      });
    }
  }

  const publishAt = normalizeDateTime(input.publish_at ?? fallback.publish_at);
  const expiresAt = normalizeDateTime(input.expires_at ?? fallback.expires_at);
  validatePublishingWindow(publishAt, expiresAt);

  return {
    [keyColumn]: key,
    ...(slugRequired ? { slug } : {}),
    sort_order: normalizeInteger(input.sort_order ?? fallback.sort_order, 0),
    publish_at: publishAt,
    expires_at: expiresAt,
  };
}

function sanitizeDivision(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "division_key", {
    slugRequired: true,
  });
  const name = cleanText(input.name ?? fallback.name, 200);
  if (!name) {
    throw new ContentStudioError("Business division name is required.", {
      code: "INVALID_BUSINESS_DIVISION",
      statusCode: 400,
    });
  }
  const emailRaw = input.contact_email ?? fallback.contact_email;
  const phoneRaw = input.contact_phone ?? fallback.contact_phone;
  const email = normalizeEmail(emailRaw);
  const phone = normalizePhone(phoneRaw);
  if (emailRaw && !email) {
    throw new ContentStudioError("Division contact email is invalid.", {
      code: "INVALID_COMPANY_INFO_EMAIL",
      statusCode: 400,
    });
  }
  if (phoneRaw && !phone) {
    throw new ContentStudioError("Division contact phone is invalid.", {
      code: "INVALID_COMPANY_INFO_PHONE",
      statusCode: 400,
    });
  }
  return {
    ...common,
    name,
    short_description:
      cleanText(input.short_description ?? fallback.short_description, 700) || null,
    body: normalizeJson(
      input.body ?? input.body_json ?? fallback.body ?? fallback.body_json,
      {}
    ),
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
    contact_phone: phone,
    contact_email: email,
  };
}

function sanitizeLocation(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "location_key", {
    slugRequired: true,
  });
  const name = cleanText(input.name ?? fallback.name, 220);
  if (!name) {
    throw new ContentStudioError("Location name is required.", {
      code: "INVALID_PUBLIC_LOCATION",
      statusCode: 400,
    });
  }
  const latitudeRaw = input.latitude ?? fallback.latitude;
  const longitudeRaw = input.longitude ?? fallback.longitude;
  const latitude =
    latitudeRaw === undefined || latitudeRaw === null || latitudeRaw === ""
      ? null
      : Number(latitudeRaw);
  const longitude =
    longitudeRaw === undefined || longitudeRaw === null || longitudeRaw === ""
      ? null
      : Number(longitudeRaw);
  if ((latitude === null) !== (longitude === null)) {
    throw new ContentStudioError("Latitude and longitude must be entered together.", {
      code: "PUBLIC_LOCATION_COORDINATES_INCOMPLETE",
      statusCode: 400,
    });
  }
  if (
    latitude !== null &&
    (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
  ) {
    throw new ContentStudioError("Latitude must be between -90 and 90.", {
      code: "PUBLIC_LOCATION_COORDINATES_INVALID",
      statusCode: 400,
    });
  }
  if (
    longitude !== null &&
    (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
  ) {
    throw new ContentStudioError("Longitude must be between -180 and 180.", {
      code: "PUBLIC_LOCATION_COORDINATES_INVALID",
      statusCode: 400,
    });
  }
  const emailRaw = input.email ?? fallback.email;
  const phoneRaw = input.phone ?? fallback.phone;
  const mapRaw = input.map_url ?? fallback.map_url;
  const email = normalizeEmail(emailRaw);
  const phone = normalizePhone(phoneRaw);
  const mapUrl = safePublicUrl(mapRaw);
  if (emailRaw && !email) {
    throw new ContentStudioError("Location email is invalid.", {
      code: "INVALID_COMPANY_INFO_EMAIL",
      statusCode: 400,
    });
  }
  if (phoneRaw && !phone) {
    throw new ContentStudioError("Location phone is invalid.", {
      code: "INVALID_COMPANY_INFO_PHONE",
      statusCode: 400,
    });
  }
  if (mapRaw && !mapUrl) {
    throw new ContentStudioError(
      "Map URL must be relative or HTTPS without credentials.",
      { code: "INVALID_COMPANY_INFO_URL", statusCode: 400 }
    );
  }
  return {
    ...common,
    division_id: positiveInteger(input.division_id ?? fallback.division_id),
    name,
    location_type:
      cleanText(input.location_type ?? fallback.location_type ?? "office", 100) ||
      "office",
    address_line:
      cleanText(input.address_line ?? fallback.address_line, 500) || null,
    city: cleanText(input.city ?? fallback.city, 120) || null,
    region: cleanText(input.region ?? fallback.region, 120) || null,
    country:
      cleanText(input.country ?? fallback.country ?? "Ghana", 120) || "Ghana",
    latitude,
    longitude,
    phone,
    email,
    business_hours: normalizeJson(
      input.business_hours ??
        input.business_hours_json ??
        fallback.business_hours ??
        fallback.business_hours_json,
      {}
    ),
    map_url: mapUrl,
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
  };
}

function sanitizeStatistic(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "statistic_key");
  const label = cleanText(input.label ?? fallback.label, 180);
  const displayValue = cleanText(
    input.display_value ?? fallback.display_value,
    120
  );
  if (!label || !displayValue) {
    throw new ContentStudioError(
      "Statistic label and display value are required.",
      { code: "INVALID_COMPANY_STATISTIC", statusCode: 400 }
    );
  }
  const numericRaw = input.numeric_value ?? fallback.numeric_value;
  const numericValue =
    numericRaw === undefined || numericRaw === null || numericRaw === ""
      ? null
      : Number(numericRaw);
  if (numericValue !== null && !Number.isFinite(numericValue)) {
    throw new ContentStudioError("Statistic numeric value must be valid.", {
      code: "INVALID_COMPANY_STATISTIC_NUMBER",
      statusCode: 400,
    });
  }
  return {
    ...common,
    label,
    display_value: displayValue,
    numeric_value: numericValue,
    prefix_text:
      cleanText(input.prefix_text ?? fallback.prefix_text, 30) || null,
    suffix_text:
      cleanText(input.suffix_text ?? fallback.suffix_text, 30) || null,
    source_note:
      cleanText(input.source_note ?? fallback.source_note, 500) || null,
    as_of_date: normalizeDateOnly(
      input.as_of_date ?? fallback.as_of_date,
      "Statistic as-of date"
    ),
  };
}

function sanitizeTestimonial(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "testimonial_key");
  const customerName = cleanText(
    input.customer_display_name ?? fallback.customer_display_name,
    180
  );
  const quoteText = cleanText(input.quote_text ?? fallback.quote_text, 5000);
  if (!customerName || !quoteText) {
    throw new ContentStudioError(
      "Customer name and testimonial quote are required.",
      { code: "INVALID_PUBLIC_TESTIMONIAL", statusCode: 400 }
    );
  }
  const ratingRaw = input.rating ?? fallback.rating;
  const rating =
    ratingRaw === undefined || ratingRaw === null || ratingRaw === ""
      ? null
      : Number(ratingRaw);
  if (
    rating !== null &&
    (!Number.isInteger(rating) || rating < 1 || rating > 5)
  ) {
    throw new ContentStudioError(
      "Testimonial rating must be between 1 and 5.",
      { code: "INVALID_TESTIMONIAL_RATING", statusCode: 400 }
    );
  }
  return {
    ...common,
    customer_display_name: customerName,
    customer_title:
      cleanText(input.customer_title ?? fallback.customer_title, 180) || null,
    company_name:
      cleanText(input.company_name ?? fallback.company_name, 180) || null,
    quote_text: quoteText,
    rating,
    portrait_media_asset_id: positiveInteger(
      input.portrait_media_asset_id ?? fallback.portrait_media_asset_id
    ),
  };
}

function sanitizeFaq(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "faq_key");
  const question = cleanText(input.question ?? fallback.question, 700);
  const answer = normalizeJson(
    input.answer ?? input.answer_json ?? fallback.answer ?? fallback.answer_json,
    null
  );
  if (!question || answer === null) {
    throw new ContentStudioError("FAQ question and answer are required.", {
      code: "INVALID_PUBLIC_FAQ",
      statusCode: 400,
    });
  }
  return {
    ...common,
    category_label:
      cleanText(input.category_label ?? fallback.category_label, 150) || null,
    question,
    answer,
  };
}

function sanitizeVacancy(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "vacancy_key", {
    slugRequired: true,
  });
  const title = cleanText(input.title ?? fallback.title, 255);
  if (!title) {
    throw new ContentStudioError("Vacancy title is required.", {
      code: "INVALID_PUBLIC_VACANCY",
      statusCode: 400,
    });
  }
  const [opensAt, closesAt] = normalizeDateTimeWindow(
    input.opens_at ?? fallback.opens_at,
    input.closes_at ?? fallback.closes_at,
    { start: "the opening date", end: "the closing date" }
  );
  const applicationRaw = input.application_url ?? fallback.application_url;
  const applicationUrl = safePublicUrl(applicationRaw);
  if (applicationRaw && !applicationUrl) {
    throw new ContentStudioError(
      "Application URL must be relative or HTTPS without credentials.",
      { code: "INVALID_COMPANY_INFO_URL", statusCode: 400 }
    );
  }
  const count = Number(input.vacancies_count ?? fallback.vacancies_count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new ContentStudioError(
      "Vacancy count must be between 1 and 10,000.",
      { code: "INVALID_VACANCY_COUNT", statusCode: 400 }
    );
  }
  return {
    ...common,
    division_id: positiveInteger(input.division_id ?? fallback.division_id),
    location_id: positiveInteger(input.location_id ?? fallback.location_id),
    title,
    employment_type:
      cleanText(input.employment_type ?? fallback.employment_type, 80) || null,
    summary: cleanText(input.summary ?? fallback.summary, 5000) || null,
    description: normalizeJson(
      input.description ??
        input.description_json ??
        fallback.description ??
        fallback.description_json,
      {}
    ),
    requirements: normalizeJson(
      input.requirements ??
        input.requirements_json ??
        fallback.requirements ??
        fallback.requirements_json,
      {}
    ),
    application_instructions: normalizeJson(
      input.application_instructions ??
        input.application_instructions_json ??
        fallback.application_instructions ??
        fallback.application_instructions_json,
      {}
    ),
    application_url: applicationUrl,
    vacancies_count: count,
    opens_at: opensAt,
    closes_at: closesAt,
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
  };
}

function sanitizeTender(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "tender_key", {
    slugRequired: true,
  });
  const title = cleanText(input.title ?? fallback.title, 255);
  if (!title) {
    throw new ContentStudioError("Tender title is required.", {
      code: "INVALID_PUBLIC_TENDER",
      statusCode: 400,
    });
  }
  const [opensAt, closesAt] = normalizeDateTimeWindow(
    input.opens_at ?? fallback.opens_at,
    input.closes_at ?? fallback.closes_at,
    { start: "the opening date", end: "the closing date" }
  );
  return {
    ...common,
    division_id: positiveInteger(input.division_id ?? fallback.division_id),
    reference_number:
      cleanText(input.reference_number ?? fallback.reference_number, 120) || null,
    title,
    summary: cleanText(input.summary ?? fallback.summary, 5000) || null,
    details: normalizeJson(
      input.details ??
        input.details_json ??
        fallback.details ??
        fallback.details_json,
      {}
    ),
    submission_instructions: normalizeJson(
      input.submission_instructions ??
        input.submission_instructions_json ??
        fallback.submission_instructions ??
        fallback.submission_instructions_json,
      {}
    ),
    opens_at: opensAt,
    closes_at: closesAt,
    document_media_asset_id: positiveInteger(
      input.document_media_asset_id ?? fallback.document_media_asset_id
    ),
  };
}

function sanitizeSnapshot(kind, input = {}, fallback = {}) {
  configFor(kind);
  if (kind === "division") return sanitizeDivision(input, fallback);
  if (kind === "location") return sanitizeLocation(input, fallback);
  if (kind === "statistic") return sanitizeStatistic(input, fallback);
  if (kind === "testimonial") return sanitizeTestimonial(input, fallback);
  if (kind === "faq") return sanitizeFaq(input, fallback);
  if (kind === "vacancy") return sanitizeVacancy(input, fallback);
  return sanitizeTender(input, fallback);
}

module.exports = {
  COMPANY_INFO_KINDS,
  CONFIG,
  configFor,
  normalizeDateOnly,
  normalizeDateTimeWindow,
  normalizeEmail,
  normalizeInteger,
  normalizeJson,
  normalizeKey,
  normalizePhone,
  normalizeSlug,
  safePublicUrl,
  sanitizeDivision,
  sanitizeFaq,
  sanitizeLocation,
  sanitizeSnapshot,
  sanitizeStatistic,
  sanitizeTender,
  sanitizeTestimonial,
  sanitizeVacancy,
};
