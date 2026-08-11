"use strict";

const { pool } = require("../config/db");
const {
  getSystemKnowledgeManifest,
} = require("./aiSystemKnowledgeManifestService");

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;
const MAX_SOURCE_HEALTH = 100;
const MAX_GAP_CANDIDATES = 20;

class AiKnowledgeHealthError extends Error {
  constructor(message, { code = "AI_KNOWLEDGE_HEALTH_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiKnowledgeHealthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maximum = 255) {
  return String(value ?? "").trim().slice(0, maximum) || null;
}

function safeWindowDays(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(number, MAX_WINDOW_DAYS);
}

function cutoffDate(windowDays) {
  return new Date(Date.now() - safeWindowDays(windowDays) * 24 * 60 * 60 * 1000);
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiKnowledgeHealthError(
      "The CHALIN ONE AI knowledge-health schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function sourceScope(workspaceCode, alias = "s") {
  const workspace = clean(workspaceCode, 50)?.toLowerCase() || null;
  if (!workspace) return Object.freeze({ sql: "1 = 1", params: [] });
  return Object.freeze({
    sql: `(${alias}.visibility = 'public' OR ${alias}.owner_workspace_code = ?)`,
    params: [workspace],
  });
}

function workspaceScope(workspaceCode, column) {
  const workspace = clean(workspaceCode, 50)?.toLowerCase() || null;
  if (!workspace) return Object.freeze({ sql: "1 = 1", params: [] });
  return Object.freeze({ sql: `${column} = ?`, params: [workspace] });
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(part, total) {
  const denominator = number(total);
  if (denominator <= 0) return null;
  return Number(((number(part) / denominator) * 100).toFixed(2));
}

function normalizeGapQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function sourceHealthState(row = {}) {
  if (row.source_status === "archived") return "archived";
  if (row.source_status === "draft") return "draft";
  if (number(row.current_published_count) > 0) return "current";
  if (number(row.future_published_count) > 0) return "future";
  if (number(row.expired_published_count) > 0) return "expired";
  return "unpublished";
}

function sourceHealthRow(row = {}) {
  return Object.freeze({
    source_id: number(row.id),
    source_key: clean(row.source_key, 120),
    title: clean(row.title, 255),
    source_type: clean(row.source_type, 40),
    visibility: clean(row.visibility, 40),
    owner_workspace_code: clean(row.owner_workspace_code, 50),
    source_status: clean(row.source_status, 40),
    health_state: sourceHealthState(row),
    latest_version_number: number(row.latest_version_number) || null,
    latest_published_version_number:
      number(row.latest_published_version_number) || null,
    current_published_count: number(row.current_published_count),
    future_published_count: number(row.future_published_count),
    expired_published_count: number(row.expired_published_count),
    updated_at: row.updated_at || null,
  });
}

function deterministicRecommendations({ inventory, approvals, retrieval, feedback } = {}) {
  const recommendations = [];
  if (number(inventory?.current_sources) === 0) {
    recommendations.push(
      "Publish at least one currently effective governed knowledge source before relying on organizational knowledge answers."
    );
  }
  if (number(inventory?.expired_sources) > 0) {
    recommendations.push(
      "Review expired knowledge sources and either publish a replacement version or archive sources that are no longer authoritative."
    );
  }
  if (number(inventory?.unpublished_active_sources) > 0) {
    recommendations.push(
      "Complete review and publication for active sources that still have no current published version."
    );
  }
  if (number(approvals?.pending) > 0) {
    recommendations.push(
      "Clear pending knowledge approvals so reviewed material can become retrievable organizational knowledge."
    );
  }
  if (number(retrieval?.zero_hit_searches) > 0) {
    recommendations.push(
      "Review repeated zero-result knowledge searches; they are direct candidates for new FAQs, procedures or expert-pack content."
    );
  }
  if (number(feedback?.new_correction_feedback) > 0) {
    recommendations.push(
      "Review unresolved incorrect-answer/correction feedback before promoting any repeated answer pattern into organizational knowledge."
    );
  }
  return Object.freeze(recommendations.slice(0, 8));
}

async function getKnowledgeHealthSnapshot({
  workspaceCode = null,
  windowDays = DEFAULT_WINDOW_DAYS,
  connection = pool,
} = {}) {
  const days = safeWindowDays(windowDays);
  const cutoff = cutoffDate(days);
  const sourceFilter = sourceScope(workspaceCode, "s");
  const invocationFilter = workspaceScope(workspaceCode, "i.workspace_code");
  const conversationFilter = workspaceScope(workspaceCode, "c.workspace_code");

  try {
    const [inventoryRows] = await connection.query(
      `SELECT
         COUNT(*) AS total_sources,
         SUM(s.source_status = 'active') AS active_sources,
         SUM(s.source_status = 'draft') AS draft_sources,
         SUM(s.source_status = 'archived') AS archived_sources,
         SUM(EXISTS(
           SELECT 1 FROM ai_knowledge_versions v
           WHERE v.source_id = s.id
             AND v.version_status = 'published'
             AND (v.effective_from IS NULL OR v.effective_from <= UTC_TIMESTAMP())
             AND (v.expires_at IS NULL OR v.expires_at > UTC_TIMESTAMP())
         )) AS current_sources,
         SUM(s.source_status = 'active' AND NOT EXISTS(
           SELECT 1 FROM ai_knowledge_versions v
           WHERE v.source_id = s.id
             AND v.version_status = 'published'
             AND (v.effective_from IS NULL OR v.effective_from <= UTC_TIMESTAMP())
             AND (v.expires_at IS NULL OR v.expires_at > UTC_TIMESTAMP())
         )) AS unpublished_active_sources,
         SUM(EXISTS(
           SELECT 1 FROM ai_knowledge_versions v
           WHERE v.source_id = s.id
             AND v.version_status = 'published'
             AND v.expires_at IS NOT NULL
             AND v.expires_at <= UTC_TIMESTAMP()
         ) AND NOT EXISTS(
           SELECT 1 FROM ai_knowledge_versions v2
           WHERE v2.source_id = s.id
             AND v2.version_status = 'published'
             AND (v2.effective_from IS NULL OR v2.effective_from <= UTC_TIMESTAMP())
             AND (v2.expires_at IS NULL OR v2.expires_at > UTC_TIMESTAMP())
         )) AS expired_sources,
         SUM(EXISTS(
           SELECT 1 FROM ai_knowledge_versions v
           WHERE v.source_id = s.id
             AND v.version_status = 'published'
             AND v.expires_at > UTC_TIMESTAMP()
             AND v.expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY)
         )) AS expiring_within_30_days
       FROM ai_knowledge_sources s
       WHERE ${sourceFilter.sql}`,
      sourceFilter.params
    );

    const [approvalRows] = await connection.query(
      `SELECT
         COUNT(*) AS total,
         SUM(a.approval_status = 'pending') AS pending,
         SUM(a.approval_status = 'approved') AS approved,
         SUM(a.approval_status = 'rejected') AS rejected
       FROM ai_knowledge_approvals a
       JOIN ai_knowledge_sources s ON s.id = a.source_id
       WHERE ${sourceFilter.sql}`,
      sourceFilter.params
    );

    const [retrievalRows] = await connection.query(
      `SELECT
         COUNT(*) AS searches,
         SUM(i.evidence_count > 0) AS hit_searches,
         SUM(i.evidence_count = 0) AS zero_hit_searches
       FROM ai_tool_invocations i
       WHERE i.tool_key = 'knowledge.search'
         AND i.invocation_status = 'succeeded'
         AND i.created_at >= ?
         AND ${invocationFilter.sql}`,
      [cutoff, ...invocationFilter.params]
    );

    const [feedbackRows] = await connection.query(
      `SELECT
         COUNT(*) AS flagged_feedback,
         SUM(f.review_status = 'new') AS new_flagged_feedback,
         SUM(f.review_status = 'new' AND f.correction_text IS NOT NULL AND TRIM(f.correction_text) <> '') AS new_correction_feedback
       FROM ai_feedback f
       JOIN ai_conversations c ON c.id = f.conversation_id
       WHERE f.created_at >= ?
         AND (f.rating IN ('incorrect', 'not_helpful') OR (f.correction_text IS NOT NULL AND TRIM(f.correction_text) <> ''))
         AND ${conversationFilter.sql}`,
      [cutoff, ...conversationFilter.params]
    );

    const [gapRows] = await connection.query(
      `SELECT
         LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(i.input_summary_json, '$.query')))) AS normalized_query,
         MAX(JSON_UNQUOTE(JSON_EXTRACT(i.input_summary_json, '$.query'))) AS example_query,
         COUNT(*) AS miss_count,
         MAX(i.created_at) AS last_seen_at,
         MAX(i.workspace_code) AS workspace_code
       FROM ai_tool_invocations i
       WHERE i.tool_key = 'knowledge.search'
         AND i.invocation_status = 'succeeded'
         AND i.evidence_count = 0
         AND i.created_at >= ?
         AND JSON_UNQUOTE(JSON_EXTRACT(i.input_summary_json, '$.query')) IS NOT NULL
         AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(i.input_summary_json, '$.query'))) <> ''
         AND ${invocationFilter.sql}
       GROUP BY LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(i.input_summary_json, '$.query'))))
       ORDER BY miss_count DESC, last_seen_at DESC
       LIMIT ${MAX_GAP_CANDIDATES}`,
      [cutoff, ...invocationFilter.params]
    );

    const [correctionRows] = await connection.query(
      `SELECT
         f.feedback_key,
         f.rating,
         f.review_status,
         c.workspace_code,
         c.persona,
         (f.correction_text IS NOT NULL AND TRIM(f.correction_text) <> '') AS has_correction,
         f.created_at
       FROM ai_feedback f
       JOIN ai_conversations c ON c.id = f.conversation_id
       WHERE f.created_at >= ?
         AND f.review_status = 'new'
         AND (f.rating IN ('incorrect', 'not_helpful') OR (f.correction_text IS NOT NULL AND TRIM(f.correction_text) <> ''))
         AND ${conversationFilter.sql}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ${MAX_GAP_CANDIDATES}`,
      [cutoff, ...conversationFilter.params]
    );

    const [sourceRows] = await connection.query(
      `SELECT
         s.id, s.source_key, s.title, s.source_type, s.visibility,
         s.owner_workspace_code, s.source_status, s.updated_at,
         MAX(v.version_number) AS latest_version_number,
         MAX(CASE WHEN v.version_status = 'published' THEN v.version_number END) AS latest_published_version_number,
         SUM(v.version_status = 'published'
             AND (v.effective_from IS NULL OR v.effective_from <= UTC_TIMESTAMP())
             AND (v.expires_at IS NULL OR v.expires_at > UTC_TIMESTAMP())) AS current_published_count,
         SUM(v.version_status = 'published'
             AND v.effective_from IS NOT NULL
             AND v.effective_from > UTC_TIMESTAMP()) AS future_published_count,
         SUM(v.version_status = 'published'
             AND v.expires_at IS NOT NULL
             AND v.expires_at <= UTC_TIMESTAMP()) AS expired_published_count
       FROM ai_knowledge_sources s
       LEFT JOIN ai_knowledge_versions v ON v.source_id = s.id
       WHERE ${sourceFilter.sql}
       GROUP BY s.id, s.source_key, s.title, s.source_type, s.visibility,
                s.owner_workspace_code, s.source_status, s.updated_at
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT ${MAX_SOURCE_HEALTH}`,
      sourceFilter.params
    );

    const inventoryRaw = inventoryRows[0] || {};
    const approvalsRaw = approvalRows[0] || {};
    const retrievalRaw = retrievalRows[0] || {};
    const feedbackRaw = feedbackRows[0] || {};

    const inventory = Object.freeze({
      total_sources: number(inventoryRaw.total_sources),
      active_sources: number(inventoryRaw.active_sources),
      draft_sources: number(inventoryRaw.draft_sources),
      archived_sources: number(inventoryRaw.archived_sources),
      current_sources: number(inventoryRaw.current_sources),
      unpublished_active_sources: number(inventoryRaw.unpublished_active_sources),
      expired_sources: number(inventoryRaw.expired_sources),
      expiring_within_30_days: number(inventoryRaw.expiring_within_30_days),
    });
    const approvals = Object.freeze({
      total: number(approvalsRaw.total),
      pending: number(approvalsRaw.pending),
      approved: number(approvalsRaw.approved),
      rejected: number(approvalsRaw.rejected),
    });
    const retrieval = Object.freeze({
      window_days: days,
      searches: number(retrievalRaw.searches),
      hit_searches: number(retrievalRaw.hit_searches),
      zero_hit_searches: number(retrievalRaw.zero_hit_searches),
      hit_rate_percent: percentage(
        retrievalRaw.hit_searches,
        retrievalRaw.searches
      ),
    });
    const feedback = Object.freeze({
      window_days: days,
      flagged_feedback: number(feedbackRaw.flagged_feedback),
      new_flagged_feedback: number(feedbackRaw.new_flagged_feedback),
      new_correction_feedback: number(feedbackRaw.new_correction_feedback),
    });

    const gapCandidates = Object.freeze(
      gapRows.map((row) =>
        Object.freeze({
          kind: "zero_result_search",
          query: normalizeGapQuery(row.example_query || row.normalized_query),
          miss_count: number(row.miss_count),
          workspace_code: clean(row.workspace_code, 50),
          last_seen_at: row.last_seen_at || null,
        })
      )
    );
    const correctionQueue = Object.freeze(
      correctionRows.map((row) =>
        Object.freeze({
          kind: "answer_correction_review",
          feedback_key: clean(row.feedback_key, 64),
          rating: clean(row.rating, 30),
          review_status: clean(row.review_status, 30),
          workspace_code: clean(row.workspace_code, 50),
          persona: clean(row.persona, 20),
          has_correction: Boolean(number(row.has_correction)),
          created_at: row.created_at || null,
        })
      )
    );
    const sourceHealth = Object.freeze(sourceRows.map(sourceHealthRow));
    const manifest = getSystemKnowledgeManifest();
    const recommendations = deterministicRecommendations({
      inventory,
      approvals,
      retrieval,
      feedback,
    });

    const needsAttention =
      inventory.expired_sources > 0 ||
      inventory.unpublished_active_sources > 0 ||
      approvals.pending > 0 ||
      retrieval.zero_hit_searches > 0 ||
      feedback.new_correction_feedback > 0;

    return Object.freeze({
      generated_at: new Date().toISOString(),
      scope: Object.freeze({
        workspace_code: clean(workspaceCode, 50),
        mode: workspaceCode ? "workspace" : "enterprise",
      }),
      status: needsAttention ? "needs_attention" : "healthy",
      registry: Object.freeze({
        system_manifest_version: manifest.version,
        deployed_workspaces: Object.freeze([...(manifest.workspaces || [])]),
        registered_ai_tool_count: (manifest.registered_ai_tool_keys || []).length,
        known_application_route_count: (manifest.known_application_routes || []).length,
        governed_source_count: inventory.total_sources,
        current_governed_source_count: inventory.current_sources,
      }),
      inventory,
      approvals,
      retrieval,
      feedback,
      gap_candidates: gapCandidates,
      correction_review_queue: correctionQueue,
      source_health: sourceHealth,
      recommendations,
      safety: Object.freeze({
        correction_text_exposed: false,
        conversation_text_exposed: false,
        credentials_exposed: false,
        live_business_rows_exposed: false,
        knowledge_gap_detection_is_read_only: true,
      }),
    });
  } catch (error) {
    if (error instanceof AiKnowledgeHealthError) throw error;
    throw schemaError(error);
  }
}

module.exports = {
  AiKnowledgeHealthError,
  DEFAULT_WINDOW_DAYS,
  MAX_GAP_CANDIDATES,
  MAX_SOURCE_HEALTH,
  MAX_WINDOW_DAYS,
  cutoffDate,
  deterministicRecommendations,
  getKnowledgeHealthSnapshot,
  normalizeGapQuery,
  percentage,
  safeWindowDays,
  schemaError,
  sourceHealthRow,
  sourceHealthState,
  sourceScope,
  workspaceScope,
};
