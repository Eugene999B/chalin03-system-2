"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  normalizeSlug,
  publicationPredicate,
} = require("./publicContentService");

const BUILT_IN_BUSINESS_SLUGS = Object.freeze(
  new Set(["spare-parts", "mining-operations", "equipment-business"])
);

const RESERVED_PLATFORM_PREFIXES = Object.freeze(
  new Set([
    "api",
    "login",
    "owner-recovery",
    "content-studio",
    "intelligence",
    "staff",
    "products",
    "new-sale",
    "sales-history",
    "installments",
    "debts",
    "change-password",
    "help",
    "notifications",
    "shared-controls",
    "customer-statement",
    "reports",
    "audit-accounting",
    "audit-signoffs",
    "advanced-accounting-intelligence",
    "exports",
    "audit-unlock-requests",
    "low-stock",
    "stock-transfers",
    "expenses",
    "purchases",
    "returns",
    "daily-closing",
    "sms",
    "users-settings",
    "user-permissions",
    "activity-log",
    "backup",
    "security-centre",
    "professional-backups",
    "workers",
    "employment-documents",
    "document-signature-settings",
    "system-operations",
    "backup-restore",
    "maintenance",
    "mining",
    "mining-operations",
    "equipment-hire",
    "equipment-hire-operations",
    "equipment-installment-finance",
    "group-executive-control",
    "fleet-assets",
    "operations-documents-accounting",
  ])
);

function cleanPath(value) {
  const raw = String(value || "").trim();
  if (!/^\/(?!\/)/.test(raw)) return "";
  try {
    const parsed = new URL(raw, "https://chalin.invalid");
    if (parsed.search || parsed.hash) return "";
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return "";
  }
}

function firstPathSegment(pathname) {
  return cleanPath(pathname).replace(/^\/+/, "").split("/")[0] || "";
}

function isReservedPlatformPath(pathname) {
  return RESERVED_PLATFORM_PREFIXES.has(firstPathSegment(pathname));
}

function detailRoute(pathname) {
  const path = cleanPath(pathname);
  if (!path || isReservedPlatformPath(path)) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) return null;

  const [prefix, rawSlug, section] = segments;
  const slug = normalizeSlug(rawSlug, 200);
  if (!slug) return null;

  if (prefix === "businesses" && segments.length <= 3) {
    return { kind: "business", slug, section: section || null };
  }
  if (segments.length !== 2) return null;

  const mapping = {
    pages: "page",
    news: "news",
    projects: "project",
    equipment: "equipment",
    careers: "vacancy",
    tenders: "tender",
    forms: "form",
  };
  return mapping[prefix] ? { kind: mapping[prefix], slug, section: null } : null;
}

async function exists(connection, sql, values) {
  const [rows] = await connection.query(sql, values);
  return Boolean(rows[0]);
}

async function findPublishedRouteOwner(pathname, connection = pool) {
  const path = cleanPath(pathname);
  if (!path) return null;
  if (isReservedPlatformPath(path)) {
    return {
      kind: "reserved_platform",
      slug: firstPathSegment(path),
      path,
    };
  }

  const route = detailRoute(path);
  if (!route) return null;

  try {
    if (route.kind === "business" && BUILT_IN_BUSINESS_SLUGS.has(route.slug)) {
      return { kind: "built_in_business", slug: route.slug, path };
    }

    const definitions = {
      page: {
        table: "public_pages",
        alias: "p",
        extra: "",
      },
      news: {
        table: "public_news_articles",
        alias: "a",
        extra: "",
      },
      project: {
        table: "public_projects",
        alias: "p",
        extra: "",
      },
      equipment: {
        table: "public_equipment_catalogue",
        alias: "e",
        extra: "",
      },
      business: {
        table: "public_business_divisions",
        alias: "d",
        extra: "",
      },
      vacancy: {
        table: "public_job_vacancies",
        alias: "v",
        extra:
          "AND (v.opens_at IS NULL OR v.opens_at <= UTC_TIMESTAMP()) AND (v.closes_at IS NULL OR v.closes_at > UTC_TIMESTAMP())",
      },
      tender: {
        table: "public_tenders",
        alias: "t",
        extra:
          "AND (t.opens_at IS NULL OR t.opens_at <= UTC_TIMESTAMP()) AND (t.closes_at IS NULL OR t.closes_at > UTC_TIMESTAMP())",
      },
      form: {
        table: "public_forms",
        alias: "f",
        extra: "",
      },
    };
    const definition = definitions[route.kind];
    if (!definition) return null;

    const occupied = await exists(
      connection,
      `SELECT ${definition.alias}.id
         FROM ${definition.table} ${definition.alias}
        WHERE ${definition.alias}.slug = ?
          AND ${publicationPredicate(definition.alias)}
          ${definition.extra}
        LIMIT 1`,
      [route.slug]
    );
    return occupied ? { kind: route.kind, slug: route.slug, path } : null;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function assertRedirectSourceUnoccupied(pathname, connection = pool) {
  const owner = await findPublishedRouteOwner(pathname, connection);
  if (!owner) return true;

  throw new ContentStudioError(
    `Redirect source ${owner.path} is already owned by a CHALIN ONE ${owner.kind.replaceAll("_", " ")} route.`,
    {
      code:
        owner.kind === "reserved_platform"
          ? "PUBLIC_REDIRECT_PLATFORM_ROUTE_RESERVED"
          : "PUBLIC_REDIRECT_PUBLISHED_ROUTE_COLLISION",
      statusCode: 409,
      details: [owner.kind, owner.slug],
    }
  );
}

module.exports = {
  BUILT_IN_BUSINESS_SLUGS,
  RESERVED_PLATFORM_PREFIXES,
  assertRedirectSourceUnoccupied,
  cleanPath,
  detailRoute,
  findPublishedRouteOwner,
  firstPathSegment,
  isReservedPlatformPath,
};
