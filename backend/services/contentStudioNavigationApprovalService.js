"use strict";

const { pool } = require("../config/db");
const {
  cleanText,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");

function clampLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 100) : 30;
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

async function listNavigationApprovals(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const filters = [
    "a.entity_type = 'navigation_item'",
    "a.approval_status = 'pending'",
  ];
  const values = [];
  const assignedTo = positiveInteger(options.assignedTo);
  if (assignedTo) {
    filters.push("a.assigned_to = ?");
    values.push(assignedTo);
  }
  const search = cleanText(options.search, 120);
  if (search) {
    filters.push("(n.label LIKE ? OR n.navigation_key LIKE ? OR n.url LIKE ?)");
    const like = `%${search}%`;
    values.push(like, like, like);
  }

  try {
    const [rows] = await pool.query(
      `SELECT
         a.id,
         a.entity_type,
         a.entity_id,
         a.content_version_id,
         a.request_type,
         a.approval_status,
         a.requested_by,
         a.assigned_to,
         a.request_note,
         a.requested_at,
         a.expires_at,
         cv.version_number,
         cv.version_status,
         cv.change_summary,
         cv.snapshot_json,
         n.navigation_key,
         n.label,
         n.navigation_location,
         requester.full_name AS requested_by_name,
         assignee.full_name AS assigned_to_name
       FROM public_content_approvals a
       JOIN public_content_versions cv ON cv.id = a.content_version_id
       JOIN public_navigation_items n ON n.id = a.entity_id
       LEFT JOIN users requester ON requester.id = a.requested_by
       LEFT JOIN users assignee ON assignee.id = a.assigned_to
       WHERE ${filters.join(" AND ")}
       ORDER BY a.requested_at, a.id
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    const items = rows.map((row) => ({
      ...row,
      snapshot: parseJson(row.snapshot_json, {}),
      snapshot_json: undefined,
    }));
    return {
      items,
      total: items.length,
      limit,
      offset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  listNavigationApprovals,
};
