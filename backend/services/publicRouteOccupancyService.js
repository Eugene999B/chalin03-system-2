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

function detailRoute(pathname) {
  const path = cleanPath(pathname);
  if (!path) return null;
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
  const route = detailRoute(pathname);
  if (!route) return null;

  try {
    if (route.kind === "business" && BUILT_IN_BUSINESS_SLUGS.has(route.slug)) {
      return { kind: "built_in_business", slug: route.slug, path: cleanPath(pathname) };
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
    return occupied
      ? { kind: route.kind, slug: route.slug, path: cleanPath(pathname) }
      : null;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function assertRedirectSourceUnoccupied(pathname, connection = pool) {
  const owner = await findPublishedRouteOwner(pathname, connection);
  if (!owner) return true;

  throw new ContentStudioError(
    `Redirect source ${owner.path} is already owned by a published CHALIN ONE ${owner.kind.replaceAll("_", " ")} route.`,
    {
      code: "PUBLIC_REDIRECT_PUBLISHED_ROUTE_COLLISION",
      statusCode: 409,
      details: [owner.kind, owner.slug],
    }
  );
}

module.exports = {
  BUILT_IN_BUSINESS_SLUGS,
  assertRedirectSourceUnoccupied,
  cleanPath,
  detailRoute,
  findPublishedRouteOwner,
};
