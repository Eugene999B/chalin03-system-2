"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getKnowledgeHealthSnapshot,
  normalizeGapQuery,
  percentage,
  safeWindowDays,
  sourceHealthState,
} = require("../services/aiKnowledgeHealthService");
const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  registerFoundationAiTools,
} = require("../ai-tools/foundationTools");

function fixtureConnection() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/COUNT\(\*\) AS total_sources/i.test(sql)) {
        return [[{
          total_sources: 4,
          active_sources: 3,
          draft_sources: 1,
          archived_sources: 0,
          current_sources: 2,
          unpublished_active_sources: 1,
          expired_sources: 1,
          expiring_within_30_days: 1,
        }]];
      }
      if (/FROM ai_knowledge_approvals/i.test(sql)) {
        return [[{ total: 3, pending: 1, approved: 2, rejected: 0 }]];
      }
      if (/COUNT\(\*\) AS searches/i.test(sql)) {
        return [[{ searches: 8, hit_searches: 6, zero_hit_searches: 2 }]];
      }
      if (/COUNT\(\*\) AS flagged_feedback/i.test(sql)) {
        return [[{
          flagged_feedback: 3,
          new_flagged_feedback: 2,
          new_correction_feedback: 1,
        }]];
      }
      if (/AS normalized_query/i.test(sql)) {
        return [[
          {
            normalized_query: "payroll termination procedure",
            example_query: "Payroll termination procedure",
            miss_count: 3,
            last_seen_at: "2026-08-11 09:00:00",
            workspace_code: "spare_parts",
          },
        ]];
      }
      if (/SELECT\s+f\.feedback_key/i.test(sql)) {
        return [[
          {
            feedback_key: "feedback_test",
            rating: "incorrect",
            review_status: "new",
            workspace_code: "spare_parts",
            persona: "copilot",
            has_correction: 1,
            created_at: "2026-08-11 08:00:00",
            correction_text: "THIS MUST NEVER BE RETURNED",
          },
        ]];
      }
      if (/latest_version_number/i.test(sql)) {
        return [[
          {
            id: 1,
            source_key: "payroll_policy",
            title: "Payroll policy",
            source_type: "policy",
            visibility: "workspace",
            owner_workspace_code: "spare_parts",
            source_status: "active",
            latest_version_number: 2,
            latest_published_version_number: 2,
            current_published_count: 1,
            future_published_count: 0,
            expired_published_count: 1,
            updated_at: "2026-08-10 12:00:00",
          },
          {
            id: 2,
            source_key: "old_returns_process",
            title: "Old returns process",
            source_type: "procedure",
            visibility: "workspace",
            owner_workspace_code: "spare_parts",
            source_status: "active",
            latest_version_number: 1,
            latest_published_version_number: 1,
            current_published_count: 0,
            future_published_count: 0,
            expired_published_count: 1,
            updated_at: "2026-07-01 12:00:00",
          },
        ]];
      }
      throw new Error(`Unexpected knowledge-health SQL: ${sql}`);
    },
  };
}

test("knowledge health unifies registry, freshness, retrieval gaps and correction-review signals", async () => {
  const connection = fixtureConnection();
  const snapshot = await getKnowledgeHealthSnapshot({
    workspaceCode: "spare_parts",
    windowDays: 30,
    connection,
  });

  assert.equal(snapshot.scope.workspace_code, "spare_parts");
  assert.equal(snapshot.scope.mode, "workspace");
  assert.equal(snapshot.status, "needs_attention");
  assert.equal(snapshot.inventory.current_sources, 2);
  assert.equal(snapshot.inventory.expired_sources, 1);
  assert.equal(snapshot.approvals.pending, 1);
  assert.equal(snapshot.retrieval.searches, 8);
  assert.equal(snapshot.retrieval.zero_hit_searches, 2);
  assert.equal(snapshot.retrieval.hit_rate_percent, 75);
  assert.equal(snapshot.gap_candidates[0].query, "Payroll termination procedure");
  assert.equal(snapshot.gap_candidates[0].miss_count, 3);
  assert.equal(snapshot.correction_review_queue[0].has_correction, true);
  assert.equal(snapshot.source_health[0].health_state, "current");
  assert.equal(snapshot.source_health[1].health_state, "expired");
  assert.ok(snapshot.registry.registered_ai_tool_count >= 1);
  assert.ok(snapshot.recommendations.length >= 3);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /THIS MUST NEVER BE RETURNED/);
  assert.equal(snapshot.safety.correction_text_exposed, false);
  assert.equal(snapshot.safety.conversation_text_exposed, false);
  assert.equal(
    connection.calls.some((call) => call.params.includes("spare_parts")),
    true
  );
});

test("knowledge-health helpers keep windows, percentages and freshness deterministic", () => {
  assert.equal(safeWindowDays(undefined), 30);
  assert.equal(safeWindowDays(999), 180);
  assert.equal(percentage(3, 4), 75);
  assert.equal(percentage(0, 0), null);
  assert.equal(normalizeGapQuery("  How   does payroll work?  "), "How does payroll work?");
  assert.equal(sourceHealthState({ source_status: "draft" }), "draft");
  assert.equal(
    sourceHealthState({ source_status: "active", future_published_count: 1 }),
    "future"
  );
  assert.equal(
    sourceHealthState({ source_status: "active", expired_published_count: 1 }),
    "expired"
  );
});

test("foundation registry exposes knowledge.health as a read-only governed tool", () => {
  const registry = new AiToolRegistry();
  registerFoundationAiTools(registry);
  const tool = registry.list().find((item) => item.key === "knowledge.health");
  assert.ok(tool);
  assert.equal(tool.risk_level, 1);
  assert.equal(tool.evidence_required, true);
  assert.deepEqual(tool.required_permissions, ["ai.use", "ai.knowledge.view"]);
  assert.deepEqual(tool.allowed_workspaces, []);
});

test("knowledge health route is fixed before the dynamic source route", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../routes/aiKnowledgeRoutes.js"),
    "utf8"
  );
  const healthIndex = source.indexOf('"/health"');
  const dynamicIndex = source.indexOf('"/:sourceId"');
  assert.ok(healthIndex >= 0);
  assert.ok(dynamicIndex >= 0);
  assert.ok(healthIndex < dynamicIndex);
  assert.match(source, /requireAiPermission\("ai\.knowledge\.view"\)/);
});
