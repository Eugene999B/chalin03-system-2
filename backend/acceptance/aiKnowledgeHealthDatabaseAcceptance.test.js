"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  getKnowledgeHealthSnapshot,
} = require("../services/aiKnowledgeHealthService");

test(
  "knowledge health executes read-only against the approved AI foundation schema",
  { timeout: 30000 },
  async () => {
    try {
      const snapshot = await getKnowledgeHealthSnapshot({
        workspaceCode: "equipment_hire",
        windowDays: 30,
        connection: pool,
      });

      assert.equal(snapshot.scope.workspace_code, "equipment_hire");
      assert.equal(snapshot.scope.mode, "workspace");
      assert.ok(["healthy", "needs_attention"].includes(snapshot.status));
      assert.ok(Number.isInteger(snapshot.inventory.total_sources));
      assert.ok(Number.isInteger(snapshot.approvals.pending));
      assert.ok(Number.isInteger(snapshot.retrieval.searches));
      assert.ok(Array.isArray(snapshot.gap_candidates));
      assert.ok(Array.isArray(snapshot.correction_review_queue));
      assert.ok(Array.isArray(snapshot.source_health));
      assert.ok(Array.isArray(snapshot.recommendations));
      assert.equal(snapshot.safety.correction_text_exposed, false);
      assert.equal(snapshot.safety.conversation_text_exposed, false);
      assert.equal(snapshot.safety.credentials_exposed, false);
      assert.equal(snapshot.safety.live_business_rows_exposed, false);
    } finally {
      await pool.end();
    }
  }
);
