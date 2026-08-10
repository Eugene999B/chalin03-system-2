"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTEXT_PROFILES,
  getContextProfile,
  resolveContextProfile,
} = require("../services/aiContextProfileService");

function reqFor(user, headers = {}) {
  return {
    user,
    headers,
    requestId: "context-test",
  };
}

function staff(workspaceCode, workspaceRole = "manager") {
  return {
    id: 41,
    role: "manager",
    workspace_code: workspaceCode,
    workspace_role: workspaceRole,
    branch_id: workspaceCode === "spare_parts" ? 1 : null,
    effective_permissions: [
      "ai.use",
      "ai.read",
      "ai.conversations.manage",
    ],
  };
}

test("context profile inventory is fixed to approved read-only business surfaces", () => {
  const keys = Object.keys(CONTEXT_PROFILES);
  assert.equal(keys.length, 13);
  assert.equal(keys.includes("spare_parts.inventory"), true);
  assert.equal(keys.includes("mining.stock_fuel"), true);
  assert.equal(keys.includes("equipment_hire.fleet"), true);
  assert.equal(keys.includes("equipment_finance.arrears"), true);

  for (const profile of Object.values(CONTEXT_PROFILES)) {
    assert.match(profile.preload_tool, /^[a-z][a-z0-9_.-]+$/);
    assert.ok(["internal", "confidential"].includes(profile.classification));
  }
  assert.equal(
    getContextProfile("equipment_finance.portfolio").classification,
    "confidential"
  );
});

test("unknown context keys fail closed instead of accepting client tool names", () => {
  assert.throws(
    () => getContextProfile("spare_parts.drop_database"),
    (error) => error.code === "AI_CONTEXT_PROFILE_NOT_FOUND"
  );
  assert.throws(
    () => getContextProfile("../spare_parts.inventory"),
    (error) => error.code === "AI_CONTEXT_PROFILE_NOT_FOUND"
  );
});

test("Spare Parts context must match the signed-in workspace", () => {
  const valid = resolveContextProfile({
    contextKey: "spare_parts.inventory",
    req: reqFor(staff("spare_parts")),
    persona: "copilot",
  });
  assert.equal(valid.workspace_code, "spare_parts");
  assert.equal(valid.scope.branch_id, 1);

  assert.throws(
    () =>
      resolveContextProfile({
        contextKey: "spare_parts.inventory",
        req: reqFor(staff("mining"), { "x-chalin03-context-id": "2" }),
        persona: "copilot",
      }),
    (error) => error.code === "AI_CONTEXT_WORKSPACE_MISMATCH"
  );
});

test("Mining context keeps the selected mining site in server-resolved scope", () => {
  const profile = resolveContextProfile({
    contextKey: "mining.operations",
    req: reqFor(staff("mining"), { "x-chalin03-context-id": "17" }),
    persona: "copilot",
  });
  assert.equal(profile.scope.mining_site_id, 17);
  assert.equal(profile.scope.branch_id, null);
});

test("Equipment Hire and Installment Finance profiles enforce separate division roles", () => {
  const hire = resolveContextProfile({
    contextKey: "equipment_hire.fleet",
    req: reqFor(staff("equipment_hire", "hire_officer"), {
      "x-chalin03-context-id": "3",
    }),
    persona: "copilot",
  });
  assert.equal(hire.equipment_division, "hire");

  const finance = resolveContextProfile({
    contextKey: "equipment_finance.arrears",
    req: reqFor(staff("equipment_hire", "finance_manager")),
    persona: "copilot",
  });
  assert.equal(finance.equipment_division, "finance");
  assert.equal(finance.classification, "confidential");

  assert.throws(
    () =>
      resolveContextProfile({
        contextKey: "equipment_finance.arrears",
        req: reqFor(staff("equipment_hire", "hire_officer")),
        persona: "copilot",
      }),
    (error) => error.code === "AI_CONTEXT_EQUIPMENT_DIVISION_DENIED"
  );
});

test("public Guide cannot enter private operational context profiles", () => {
  assert.throws(
    () =>
      resolveContextProfile({
        contextKey: "spare_parts.operations",
        req: reqFor(staff("spare_parts")),
        persona: "guide",
      }),
    (error) => error.code === "AI_CONTEXT_PERSONA_INVALID"
  );
});
