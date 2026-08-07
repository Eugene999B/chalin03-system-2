"use strict";

const {
  ContentStudioError,
  booleanValue,
  cleanText,
  normalizeDateTime,
  positiveInteger,
  validatePublishingWindow,
} = require("./contentStudioPageService");

const PORTFOLIO_KINDS = Object.freeze(["leadership", "project", "equipment"]);
const PUBLICATION_STATUSES = Object.freeze([
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "expired",
  "archived",
]);
const PROJECT_STATUSES = Object.freeze([
  "planned",
  "active",
  "paused",
  "completed",
  "cancelled",
]);
const EQUIPMENT_AVAILABILITY = Object.freeze([
  "available",
  "reserved",
  "hired",
  "sold",
  "maintenance",
  "unavailable",
  "coming_soon",
]);
const EQUIPMENT_REFERENCE_TYPES = Object.freeze([
  "fleet_asset",
  "equipment_catalogue",
  "installment_equipment",
  "external",
]);
const PROJECT_MEDIA_ROLES = Object.freeze([
  "hero",
  "gallery",
  "site",
  "before",
  "after",
  "video",
]);
const MAX_GALLERY_ITEMS = 60;

const CONFIG = Object.freeze({
  leadership: Object.freeze({
    entityType: "leadership_profile",
    table: "public_leadership_profiles",
    keyColumn: "profile_key",
    label: "Leadership profile",
    searchSql: "(e.full_name LIKE ? OR e.position_title LIKE ?)",
    orderSql: "e.sort_order, e.full_name, e.id",
  }),
  project: Object.freeze({
    entityType: "project",
    table: "public_projects",
    keyColumn: "project_key",
    label: "Project",
    searchSql: "(e.title LIKE ? OR e.location_text LIKE ?)",
    orderSql: "e.sort_order, e.start_date DESC, e.id DESC",
  }),
  equipment: Object.freeze({
    entityType: "equipment",
    table: "public_equipment_catalogue",
    keyColumn: "equipment_key",
    label: "Equipment item",
    searchSql:
      "(e.name LIKE ? OR e.manufacturer LIKE ? OR e.model LIKE ? OR e.equipment_category LIKE ?)",
    orderSql: "e.sort_order, e.name, e.id",
  }),
});

function configFor(kind) {
  const normalized = cleanText(kind, 30).toLowerCase();
  const config = CONFIG[normalized];
  if (!config) {
    throw new ContentStudioError("Choose a supported Content Studio manager.", {
      code: "UNSUPPORTED_PORTFOLIO_KIND",
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

function normalizeStatus(value, allowed, fallback) {
  const normalized = cleanText(value, 50)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeMoney(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new ContentStudioError("Price must be a valid non-negative amount.", {
      code: "INVALID_EQUIPMENT_PRICE",
      statusCode: 400,
    });
  }
  return Number(number.toFixed(2));
}

function normalizeDateOnly(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ContentStudioError(`${label} is not a valid calendar date.`, {
        code: "INVALID_PORTFOLIO_DATE",
        statusCode: 400,
      });
    }
    return value.toISOString().slice(0, 10);
  }
  const raw = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ContentStudioError(`${label} must use YYYY-MM-DD format.`, {
      code: "INVALID_PORTFOLIO_DATE",
      statusCode: 400,
    });
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new ContentStudioError(`${label} is not a valid calendar date.`, {
      code: "INVALID_PORTFOLIO_DATE",
      statusCode: 400,
    });
  }
  return raw;
}

function safeHttpsUrl(value) {
  const raw = cleanText(value, 700);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString().slice(0, 700);
  } catch {
    return null;
  }
}

function sanitizeSocialLinks(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedKeys = [
    "website",
    "linkedin",
    "facebook",
    "instagram",
    "x",
    "youtube",
    "email",
    "phone",
  ];
  const output = {};

  for (const key of allowedKeys) {
    const raw = cleanText(input[key], 700);
    if (!raw) continue;

    let safeValue = null;
    if (key === "email") {
      safeValue = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(raw)
        ? raw
        : null;
    } else if (key === "phone") {
      safeValue = /^tel:\+?[0-9]{7,15}$/i.test(raw) ? raw : null;
    } else {
      safeValue = safeHttpsUrl(raw);
    }

    if (!safeValue) {
      throw new ContentStudioError(`Leadership ${key} link is not safe.`, {
        code: "INVALID_LEADERSHIP_LINK",
        statusCode: 400,
      });
    }
    output[key] = safeValue;
  }
  return output;
}

function sanitizeFeatures(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ContentStudioError("Equipment features must be a list.", {
      code: "INVALID_EQUIPMENT_FEATURES",
      statusCode: 400,
    });
  }
  return [
    ...new Set(
      value
        .slice(0, 100)
        .map((item) => cleanText(item, 300))
        .filter(Boolean)
    ),
  ];
}

function sanitizeSpecifications(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentStudioError("Equipment specifications must be an object.", {
      code: "INVALID_EQUIPMENT_SPECIFICATIONS",
      statusCode: 400,
    });
  }
  return value;
}

function sanitizeProjectGallery(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ContentStudioError("Project gallery must be a list of media items.", {
      code: "INVALID_PROJECT_GALLERY",
      statusCode: 400,
    });
  }
  if (value.length > MAX_GALLERY_ITEMS) {
    throw new ContentStudioError(
      `A project may contain no more than ${MAX_GALLERY_ITEMS} gallery items.`,
      { code: "PROJECT_GALLERY_TOO_LARGE", statusCode: 413 }
    );
  }

  const seen = new Set();
  return value.map((item, index) => {
    const mediaAssetId = positiveInteger(item?.media_asset_id ?? item?.id);
    const rawRole = item?.media_role ?? item?.role;
    const mediaRole = rawRole
      ? normalizeStatus(rawRole, PROJECT_MEDIA_ROLES, null)
      : "gallery";

    if (rawRole && !mediaRole) {
      throw new ContentStudioError("Choose a supported project media role.", {
        code: "INVALID_PROJECT_MEDIA_ROLE",
        statusCode: 400,
      });
    }
    if (!mediaAssetId) {
      throw new ContentStudioError(
        "Every project gallery item requires a media asset.",
        { code: "PROJECT_GALLERY_MEDIA_REQUIRED", statusCode: 400 }
      );
    }

    const identity = `${mediaAssetId}:${mediaRole}`;
    if (seen.has(identity)) {
      throw new ContentStudioError(
        "Duplicate project gallery media is not allowed.",
        { code: "DUPLICATE_PROJECT_GALLERY_MEDIA", statusCode: 409 }
      );
    }
    seen.add(identity);

    return {
      media_asset_id: mediaAssetId,
      media_role: mediaRole,
      caption: cleanText(item?.caption, 500) || null,
      sort_order: normalizeInteger(item?.sort_order, index),
    };
  });
}

function commonSnapshot(input, fallback, keyName) {
  const key = normalizeKey(input[keyName] ?? input.key ?? fallback[keyName]);
  const slug = normalizeSlug(input.slug ?? fallback.slug);
  if (!key || !slug) {
    throw new ContentStudioError(
      "A safe internal key and public slug are required.",
      { code: "INVALID_PORTFOLIO_IDENTITY", statusCode: 400 }
    );
  }

  const publishAt = normalizeDateTime(input.publish_at ?? fallback.publish_at);
  const expiresAt = normalizeDateTime(input.expires_at ?? fallback.expires_at);
  validatePublishingWindow(publishAt, expiresAt);

  return {
    [keyName]: key,
    slug,
    publish_at: publishAt,
    expires_at: expiresAt,
    sort_order: normalizeInteger(input.sort_order ?? fallback.sort_order, 0),
  };
}

function sanitizeLeadership(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "profile_key");
  const fullName = cleanText(input.full_name ?? fallback.full_name, 200);
  const positionTitle = cleanText(
    input.position_title ?? fallback.position_title,
    200
  );

  if (!fullName || !positionTitle) {
    throw new ContentStudioError("Leadership name and position are required.", {
      code: "INVALID_LEADERSHIP_PROFILE",
      statusCode: 400,
    });
  }

  return {
    ...common,
    full_name: fullName,
    position_title: positionTitle,
    professional_summary:
      cleanText(
        input.professional_summary ?? fallback.professional_summary,
        4000
      ) || null,
    biography:
      input.biography ??
      input.biography_json ??
      fallback.biography ??
      fallback.biography_json ??
      {},
    portrait_media_asset_id: positiveInteger(
      input.portrait_media_asset_id ?? fallback.portrait_media_asset_id
    ),
    signature_media_asset_id: positiveInteger(
      input.signature_media_asset_id ?? fallback.signature_media_asset_id
    ),
    social_links: sanitizeSocialLinks(
      input.social_links ??
        input.social_links_json ??
        fallback.social_links ??
        fallback.social_links_json
    ),
  };
}

function sanitizeProject(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "project_key");
  const title = cleanText(input.title ?? fallback.title, 255);
  if (!title) {
    throw new ContentStudioError("Project title is required.", {
      code: "INVALID_PROJECT",
      statusCode: 400,
    });
  }

  const startDate = normalizeDateOnly(
    input.start_date ?? fallback.start_date,
    "Project start date"
  );
  const endDate = normalizeDateOnly(
    input.end_date ?? fallback.end_date,
    "Project end date"
  );
  if (startDate && endDate && endDate < startDate) {
    throw new ContentStudioError(
      "Project end date cannot be before the start date.",
      { code: "INVALID_PROJECT_DATE_RANGE", statusCode: 400 }
    );
  }

  const rawOperationalStatus =
    input.operational_status ?? fallback.operational_status;
  const operationalStatus = rawOperationalStatus
    ? normalizeStatus(rawOperationalStatus, PROJECT_STATUSES, null)
    : "planned";
  if (rawOperationalStatus && !operationalStatus) {
    throw new ContentStudioError(
      "Choose a supported project operational status.",
      { code: "INVALID_PROJECT_STATUS", statusCode: 400 }
    );
  }

  return {
    ...common,
    division_id: positiveInteger(input.division_id ?? fallback.division_id),
    title,
    summary: cleanText(input.summary ?? fallback.summary, 5000) || null,
    body:
      input.body ??
      input.body_json ??
      fallback.body ??
      fallback.body_json ??
      {},
    location_text:
      cleanText(input.location_text ?? fallback.location_text, 255) || null,
    operational_status: operationalStatus,
    start_date: startDate,
    end_date: endDate,
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
    gallery: sanitizeProjectGallery(input.gallery ?? fallback.gallery),
  };
}

function sanitizeEquipment(input = {}, fallback = {}) {
  const common = commonSnapshot(input, fallback, "equipment_key");
  const name = cleanText(input.name ?? fallback.name, 220);
  if (!name) {
    throw new ContentStudioError("Equipment name is required.", {
      code: "INVALID_PUBLIC_EQUIPMENT",
      statusCode: 400,
    });
  }

  const yearValue = input.model_year ?? fallback.model_year;
  let modelYear = null;
  if (yearValue !== undefined && yearValue !== null && yearValue !== "") {
    modelYear = Number(yearValue);
    if (!Number.isInteger(modelYear) || modelYear < 1900 || modelYear > 2100) {
      throw new ContentStudioError(
        "Equipment model year must be between 1900 and 2100.",
        { code: "INVALID_EQUIPMENT_MODEL_YEAR", statusCode: 400 }
      );
    }
  }

  const referenceTypeRaw =
    input.internal_reference_type ?? fallback.internal_reference_type;
  const referenceType = referenceTypeRaw
    ? normalizeStatus(referenceTypeRaw, EQUIPMENT_REFERENCE_TYPES, null)
    : null;
  if (referenceTypeRaw && !referenceType) {
    throw new ContentStudioError(
      "Choose a supported internal equipment reference type.",
      { code: "INVALID_EQUIPMENT_REFERENCE_TYPE", statusCode: 400 }
    );
  }

  const referenceId = positiveInteger(
    input.internal_reference_id ?? fallback.internal_reference_id
  );
  if (referenceType && referenceType !== "external" && !referenceId) {
    throw new ContentStudioError(
      "Choose the internal equipment record linked to this public item.",
      { code: "EQUIPMENT_REFERENCE_ID_REQUIRED", statusCode: 400 }
    );
  }
  if (!referenceType && referenceId) {
    throw new ContentStudioError(
      "Choose an internal reference type before entering its record ID.",
      { code: "EQUIPMENT_REFERENCE_TYPE_REQUIRED", statusCode: 400 }
    );
  }
  if (referenceType === "external" && referenceId) {
    throw new ContentStudioError(
      "External equipment must not point to an internal record ID.",
      { code: "EXTERNAL_EQUIPMENT_REFERENCE_INVALID", statusCode: 400 }
    );
  }

  const displayPrice = normalizeMoney(
    input.display_price ?? fallback.display_price
  );
  const showPrice = booleanValue(
    input.show_price,
    booleanValue(fallback.show_price)
  );
  if (showPrice && displayPrice === null) {
    throw new ContentStudioError(
      "Enter a price before enabling public price display.",
      { code: "EQUIPMENT_PUBLIC_PRICE_REQUIRED", statusCode: 400 }
    );
  }

  const currencyCode = cleanText(
    input.currency_code ?? fallback.currency_code ?? "GHS",
    3
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ContentStudioError(
      "Equipment currency must use a three-letter code.",
      { code: "INVALID_EQUIPMENT_CURRENCY", statusCode: 400 }
    );
  }

  const rawAvailabilityStatus =
    input.availability_status ?? fallback.availability_status;
  const availabilityStatus = rawAvailabilityStatus
    ? normalizeStatus(rawAvailabilityStatus, EQUIPMENT_AVAILABILITY, null)
    : "coming_soon";
  if (rawAvailabilityStatus && !availabilityStatus) {
    throw new ContentStudioError(
      "Choose a supported equipment availability status.",
      { code: "INVALID_EQUIPMENT_AVAILABILITY", statusCode: 400 }
    );
  }

  return {
    ...common,
    division_id: positiveInteger(input.division_id ?? fallback.division_id),
    internal_reference_type: referenceType,
    internal_reference_id: referenceId,
    name,
    manufacturer:
      cleanText(input.manufacturer ?? fallback.manufacturer, 150) || null,
    model: cleanText(input.model ?? fallback.model, 150) || null,
    model_year: modelYear,
    equipment_category:
      cleanText(
        input.equipment_category ?? fallback.equipment_category,
        120
      ) || null,
    condition_label:
      cleanText(input.condition_label ?? fallback.condition_label, 80) || null,
    availability_status: availabilityStatus,
    short_description:
      cleanText(
        input.short_description ?? fallback.short_description,
        5000
      ) || null,
    specifications: sanitizeSpecifications(
      input.specifications ??
        input.specifications_json ??
        fallback.specifications ??
        fallback.specifications_json
    ),
    features: sanitizeFeatures(
      input.features ??
        input.features_json ??
        fallback.features ??
        fallback.features_json
    ),
    currency_code: currencyCode,
    display_price: displayPrice,
    show_price: showPrice,
    hire_available: booleanValue(
      input.hire_available,
      booleanValue(fallback.hire_available)
    ),
    finance_available: booleanValue(
      input.finance_available,
      booleanValue(fallback.finance_available)
    ),
    featured_media_asset_id: positiveInteger(
      input.featured_media_asset_id ?? fallback.featured_media_asset_id
    ),
  };
}

function sanitizeSnapshot(kind, input = {}, fallback = {}) {
  configFor(kind);
  if (kind === "leadership") return sanitizeLeadership(input, fallback);
  if (kind === "project") return sanitizeProject(input, fallback);
  return sanitizeEquipment(input, fallback);
}

module.exports = {
  CONFIG,
  EQUIPMENT_AVAILABILITY,
  EQUIPMENT_REFERENCE_TYPES,
  MAX_GALLERY_ITEMS,
  PORTFOLIO_KINDS,
  PROJECT_MEDIA_ROLES,
  PROJECT_STATUSES,
  PUBLICATION_STATUSES,
  configFor,
  normalizeDateOnly,
  normalizeInteger,
  normalizeKey,
  normalizeMoney,
  normalizeSlug,
  normalizeStatus,
  safeHttpsUrl,
  sanitizeEquipment,
  sanitizeFeatures,
  sanitizeLeadership,
  sanitizeProject,
  sanitizeProjectGallery,
  sanitizeSnapshot,
  sanitizeSocialLinks,
  sanitizeSpecifications,
};
