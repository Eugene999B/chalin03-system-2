"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isLiveEffectiveRoleRequest,
  roleKnowledgeForPrompt,
  renderRoleKnowledgeForPrompt,
} = require("../services/aiRoleKnowledgeService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");

const USER_EXAMPLE =
  "hi, can you tell me whats the role of the user auditor in spare parts";

test("Spare Parts auditor question resolves to the exact current role template", () => {
  const role = roleKnowledgeForPrompt(USER_EXAMPLE);
  assert.ok(role);
  assert.equal(role.workspace_key, "spare_parts");
  assert.equal(role.role_key, "auditor");
  assert.equal(role.role_template_read_only, true);
  assert.deepEqual(role.write_authority_permissions, []);

  for (const permission of [
    "workspace.view",
    "audit.view",
    "audit.export",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "spare_parts.read",
    "spare_parts.audit",
    "installments.view",
    "installments.export",
    "exports.download",
  ]) {
    assert.ok(
      role.granted_permissions.includes(permission),
      `${permission} must remain part of the Spare Parts auditor template`
    );
  }
});

test("Spare Parts auditor answer makes critical missing write powers explicit", () => {
  const role = roleKnowledgeForPrompt(USER_EXAMPLE);
  for (const permission of [
    "spare_parts.sell",
    "spare_parts.manage",
    "installments.manage",
    "installments.collect",
    "installments.remind",
    "installments.settings",
    "payroll.manage",
    "payroll.prepare",
    "payroll.approve",
    "payroll.pay",
    "users.manage",
    "workspace.admin",
  ]) {
    assert.ok(
      role.absent_write_authority_permissions.includes(permission),
      `${permission} must be identified as not granted to the Spare Parts auditor template`
    );
  }

  const rendered = renderRoleKnowledgeForPrompt(USER_EXAMPLE);
  assert.match(rendered, /Verified CHALIN role-authority source/);
  assert.match(rendered, /Read-only role template: yes/);
  assert.match(rendered, /spare_parts\.sell/);
  assert.match(rendered, /spare_parts\.manage/);
  assert.match(rendered, /installments\.collect/);
  assert.match(rendered, /payroll\.pay/);
  assert.match(rendered, /Do not say 'typically', 'usually'/);
});

test("named role template stays product knowledge and receives role authority context", () => {
  assert.equal(isChalinProductKnowledgeTurn(USER_EXAMPLE), true);
  assert.equal(isLikelyLiveRecordRequest(USER_EXAMPLE), false);

  const instruction = productKnowledgeInstruction(USER_EXAMPLE);
  assert.match(instruction, /Role template: Auditor \(auditor\)/);
  assert.match(instruction, /Exact workspace-role grants:/);
  assert.match(instruction, /spare_parts\.read/);
  assert.match(instruction, /Explicit write\/operational authority granted by this role template: none/);
  assert.match(instruction, /generic industry responsibilities/);
});

test("specific or logged-in effective access stays out of the static public role lane", () => {
  const prompts = [
    "what are my permissions in spare parts right now?",
    "what role does the current user have in spare parts?",
    "what permissions does user #42 have in spare parts?",
    "what access does account @kwame have in spare parts?",
    "what can I do with this login right now in spare parts?",
  ];

  for (const prompt of prompts) {
    assert.equal(isLiveEffectiveRoleRequest(prompt), true, prompt);
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
    assert.equal(roleKnowledgeForPrompt(prompt), null, prompt);
  }
});

test("role authority derivation works across configured workspaces without inventing unknown roles", () => {
  const mining = roleKnowledgeForPrompt("what is the role of the site supervisor in mining?");
  assert.equal(mining?.workspace_key, "mining");
  assert.equal(mining?.role_key, "site_supervisor");
  assert.ok(mining?.granted_permissions.includes("mining.daily_logs.approve"));

  const hire = roleKnowledgeForPrompt("what can the dispatcher role do in equipment hire?");
  assert.equal(hire?.workspace_key, "equipment_hire");
  assert.equal(hire?.role_key, "dispatcher");
  assert.ok(hire?.granted_permissions.includes("hire.dispatch.manage"));

  assert.equal(
    roleKnowledgeForPrompt("what is the astronaut role in spare parts?"),
    null
  );
});
