"use strict";

const { pool } = require("../config/db");
const {
  mapMedia,
  mediaColumns,
  publicationPredicate,
  publicMediaJoin,
  schemaNotReadyError,
} = require("./publicContentService");

function clampTestimonialLimit(value, fallback = 12, maximum = 50) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function validRating(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5
    ? number
    : null;
}

async function listPublicTestimonials({ limit } = {}) {
  const safeLimit = clampTestimonialLimit(limit);

  try {
    const [rows] = await pool.query(
      `SELECT
         t.testimonial_key,
         t.customer_display_name,
         t.customer_title,
         t.company_name,
         t.quote_text,
         t.rating,
         ${mediaColumns("portrait", "portrait")}
       FROM public_testimonials t
       ${publicMediaJoin("portrait", "t.portrait_media_asset_id")}
       WHERE ${publicationPredicate("t")}
       ORDER BY t.sort_order, t.published_at DESC, t.id DESC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map((row) => ({
      key: row.testimonial_key,
      customer_name: row.customer_display_name,
      customer_title: row.customer_title || "",
      company_name: row.company_name || "",
      quote: row.quote_text,
      rating: validRating(row.rating),
      portrait: mapMedia(row, "portrait"),
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  clampTestimonialLimit,
  listPublicTestimonials,
  validRating,
};
