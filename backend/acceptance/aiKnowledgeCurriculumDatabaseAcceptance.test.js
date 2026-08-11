"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  getKnowledgeCurriculum,
} = require("../services/aiKnowledgeCurriculumService");

test(
  "knowledge curriculum derives read-only expert-pack priorities from the approved AI schema",
  { timeout: 30000 },
  async () => {
    try {
      const curriculum = await getKnowledgeCurriculum({
        workspaceCode: "equipment_hire",
        windowDays: 30,
        connection: pool,
      });

      assert.equal(curriculum.scope.workspace_code, "equipment_hire");
      assert.equal(curriculum.scope.mode, "workspace");
      assert.ok(Number.isInteger(curriculum.curriculum_item_count));
      assert.ok(Array.isArray(curriculum.expert_packs));
      assert.ok(Array.isArray(curriculum.curriculum));
      assert.ok(
        curriculum.expert_packs.some(
          (pack) => pack.key === "equipment_hire"
        )
      );
      assert.ok(
        curriculum.expert_packs.some(
          (pack) => pack.key === "equipment_installment_finance"
        )
      );
      assert.equal(curriculum.governance.gap_detection_can_create_drafts, false);
      assert.equal(curriculum.governance.gap_detection_can_publish, false);
      assert.equal(curriculum.governance.correction_requires_review, true);
      assert.equal(
        curriculum.governance.organizational_truth_requires_governed_publication,
        true
      );
      assert.equal(
        curriculum.curriculum.some((item) => item.auto_publish === true),
        false
      );
      assert.doesNotMatch(
        JSON.stringify(curriculum),
        /correction_text\s*:/i
      );
    } finally {
      await pool.end();
    }
  }
);
