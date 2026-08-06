"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const { normalizeKey, normalizeSlug } = require("./contentStudioNewsroomSchema");

function normalizeSortOrder(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

async function listNewsCategories({ includeInactive = false } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM public_news_articles a
               WHERE a.category_id = c.id
                 AND a.publication_status <> 'archived') AS active_article_count
       FROM public_news_categories c
       ${includeInactive ? "" : "WHERE c.is_active = 1"}
       ORDER BY c.sort_order, c.name, c.id`
    );
    return rows.map((row) => ({
      ...row,
      active_article_count: Number(row.active_article_count || 0),
      is_active: Boolean(Number(row.is_active)),
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function createNewsCategory({ input = {}, user, req }) {
  const categoryKey = normalizeKey(input.category_key ?? input.key);
  const slug = normalizeSlug(input.slug);
  const name = cleanText(input.name, 180);
  if (!categoryKey || !slug || !name) {
    throw new ContentStudioError(
      "Category key, public slug and name are required.",
      { code: "INVALID_NEWS_CATEGORY", statusCode: 400 }
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO public_news_categories (
         category_key, slug, name, description, sort_order,
         is_active, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        categoryKey,
        slug,
        name,
        cleanText(input.description, 500) || null,
        normalizeSortOrder(input.sort_order),
        user?.id || null,
        user?.id || null,
      ]
    );
    const categoryId = Number(result.insertId);
    await insertContentAudit(connection, {
      entityType: "news_category",
      entityId: categoryId,
      actionKey: "news_category_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { category_key: categoryKey, slug, name },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_NEWS_CATEGORY_CREATED",
      details: `CHALIN ONE news category ${categoryKey} created`,
      entityType: "public_news_category",
      entityId: categoryId,
      actionType: "PUBLIC_NEWS_CATEGORY_CREATED",
      metadata: { category_key: categoryKey },
    });
    await connection.commit();
    return listNewsCategories({ includeInactive: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(
        "A news category with this key or slug already exists.",
        { code: "NEWS_CATEGORY_DUPLICATE", statusCode: 409 }
      );
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function updateNewsCategory({ categoryId, input = {}, user, req }) {
  const id = positiveInteger(categoryId);
  if (!id) {
    throw new ContentStudioError("Invalid news category ID.", {
      code: "INVALID_NEWS_CATEGORY_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM public_news_categories WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const category = rows[0];
    if (!category) {
      throw new ContentStudioError("News category not found.", {
        code: "NEWS_CATEGORY_NOT_FOUND",
        statusCode: 404,
      });
    }
    const categoryKey =
      input.category_key || input.key
        ? normalizeKey(input.category_key ?? input.key)
        : category.category_key;
    const slug = input.slug ? normalizeSlug(input.slug) : category.slug;
    const name = cleanText(input.name, 180) || category.name;
    if (!categoryKey || !slug) {
      throw new ContentStudioError("News category identity is invalid.", {
        code: "INVALID_NEWS_CATEGORY",
        statusCode: 400,
      });
    }
    await connection.query(
      `UPDATE public_news_categories
       SET category_key = ?, slug = ?, name = ?, description = ?,
           sort_order = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        categoryKey,
        slug,
        name,
        input.description === undefined
          ? category.description
          : cleanText(input.description, 500) || null,
        normalizeSortOrder(input.sort_order, Number(category.sort_order || 0)),
        user?.id || null,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: "news_category",
      entityId: id,
      actionKey: "news_category_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        category_key: category.category_key,
        slug: category.slug,
        name: category.name,
      },
      after: { category_key: categoryKey, slug, name },
    });
    await connection.commit();
    return listNewsCategories({ includeInactive: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(
        "A news category with this key or slug already exists.",
        { code: "NEWS_CATEGORY_DUPLICATE", statusCode: 409 }
      );
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveNewsCategory({ categoryId, reason, user, req }) {
  const id = positiveInteger(categoryId);
  if (!id) {
    throw new ContentStudioError("Invalid news category ID.", {
      code: "INVALID_NEWS_CATEGORY_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM public_news_categories WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const category = rows[0];
    if (!category || !Number(category.is_active)) {
      throw new ContentStudioError("News category not found.", {
        code: "NEWS_CATEGORY_NOT_FOUND",
        statusCode: 404,
      });
    }
    const [activeRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM public_news_articles
       WHERE category_id = ? AND publication_status <> 'archived'`,
      [id]
    );
    const [versionRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM public_content_versions
       WHERE entity_type = 'news_article'
         AND version_status IN ('draft','in_review','approved','published')
         AND JSON_CONTAINS(snapshot_json, JSON_OBJECT('category_id', ?))`,
      [id]
    );
    if (
      Number(activeRows[0]?.total || 0) > 0 ||
      Number(versionRows[0]?.total || 0) > 0
    ) {
      throw new ContentStudioError(
        "Move active and draft news articles to another category before archiving this category.",
        { code: "NEWS_CATEGORY_IN_USE", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE public_news_categories
       SET is_active = 0, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "news_category",
      entityId: id,
      actionKey: "news_category_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { is_active: true },
      after: { is_active: false },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await connection.commit();
    return listNewsCategories({ includeInactive: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  archiveNewsCategory,
  createNewsCategory,
  listNewsCategories,
  normalizeSortOrder,
  updateNewsCategory,
};
