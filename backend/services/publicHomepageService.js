"use strict";

const { pool } = require("../config/db");
const {
  getPublicPageBySlug,
  publicationPredicate,
  schemaNotReadyError,
} = require("./publicContentService");

async function getPublicHomepage() {
  try {
    const [rows] = await pool.query(
      `SELECT p.slug
         FROM public_pages p
        WHERE p.is_homepage = 1
          AND ${publicationPredicate("p")}
        ORDER BY p.published_at DESC, p.id DESC
        LIMIT 1`
    );

    const slug = rows[0]?.slug || null;
    return slug ? getPublicPageBySlug(slug) : null;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  getPublicHomepage,
};
