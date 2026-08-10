"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { pool } = require("../config/db");
const {
  addMessage,
  archiveConversation,
  createConversation,
} = require("../services/aiConversationService");
const {
  loadScopedUserMemory,
} = require("../services/aiConversationMemoryService");

const ACCEPTANCE_DATABASE_PATTERN = /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i;

async function assertAcceptanceDatabase() {
  const [[row]] = await pool.query("SELECT DATABASE() AS database_name");
  const database = String(row?.database_name || "");
  assert.match(
    database,
    ACCEPTANCE_DATABASE_PATTERN,
    "memory acceptance may run only in the isolated CHALIN ONE acceptance database"
  );
  return database;
}

test("governed conversation memory is user, persona, status and exact-scope isolated", async (t) => {
  await assertAcceptanceDatabase();
  const marker = crypto.randomUUID().slice(0, 8);
  const sameScope = {
    workspace_code: "spare_parts",
    branch_id: null,
    mining_site_id: null,
    hire_location_id: null,
  };
  const otherScope = {
    workspace_code: "mining",
    branch_id: null,
    mining_site_id: null,
    hire_location_id: null,
  };
  const createdIds = [];

  t.after(async () => {
    if (!createdIds.length) return;
    const placeholders = createdIds.map(() => "?").join(", ");
    await pool.query(
      `DELETE FROM ai_conversations WHERE id IN (${placeholders})`,
      createdIds
    );
  });

  const prior = await createConversation({
    persona: "copilot",
    userId: 1,
    scope: sameScope,
    title: `Memory prior ${marker}`,
  });
  createdIds.push(prior.id);
  await addMessage({
    conversationId: prior.id,
    role: "user",
    content: `Atlas ${marker}: review the excavator finance case after the August payment.`,
    safetyStatus: "allowed",
    createdBy: 1,
  });
  await addMessage({
    conversationId: prior.id,
    role: "assistant",
    content: `ASSISTANT-HALLUCINATION-${marker}: this must never become conversation memory.`,
    safetyStatus: "allowed",
    createdBy: 1,
  });

  const archived = await createConversation({
    persona: "copilot",
    userId: 1,
    scope: sameScope,
    title: `Memory archived ${marker}`,
  });
  createdIds.push(archived.id);
  await addMessage({
    conversationId: archived.id,
    role: "user",
    content: `Atlas ${marker}: archived instruction that must not be recalled.`,
    safetyStatus: "allowed",
    createdBy: 1,
  });
  await archiveConversation({
    conversationKey: archived.key,
    userId: 1,
  });

  const otherWorkspace = await createConversation({
    persona: "copilot",
    userId: 1,
    scope: otherScope,
    title: `Memory other scope ${marker}`,
  });
  createdIds.push(otherWorkspace.id);
  await addMessage({
    conversationId: otherWorkspace.id,
    role: "user",
    content: `Atlas ${marker}: Mining-only context that must not cross into Spare Parts.`,
    safetyStatus: "allowed",
    createdBy: 1,
  });

  const otherUser = await createConversation({
    persona: "copilot",
    userId: 2,
    scope: sameScope,
    title: `Memory other user ${marker}`,
  });
  createdIds.push(otherUser.id);
  await addMessage({
    conversationId: otherUser.id,
    role: "user",
    content: `Atlas ${marker}: another user's private context.`,
    safetyStatus: "allowed",
    createdBy: 2,
  });

  const current = await createConversation({
    persona: "copilot",
    userId: 1,
    scope: sameScope,
    title: `Memory current ${marker}`,
  });
  createdIds.push(current.id);
  await addMessage({
    conversationId: current.id,
    role: "user",
    content: `Atlas ${marker}: current conversation text must not be returned as prior memory.`,
    safetyStatus: "allowed",
    createdBy: 1,
  });

  const memories = await loadScopedUserMemory({
    userId: 1,
    persona: "copilot",
    scope: sameScope,
    currentConversationId: current.id,
    query: `Atlas ${marker} excavator finance decision`,
    limit: 4,
  });

  assert.equal(memories.length, 1);
  assert.match(memories[0].content, /review the excavator finance case after the August payment/);
  assert.equal(memories[0].conversation_key, prior.key);
  assert.equal(memories[0].verified_fact, false);
  assert.equal(memories[0].authority, "continuity_only");

  const serialized = JSON.stringify(memories);
  assert.doesNotMatch(serialized, new RegExp(`ASSISTANT-HALLUCINATION-${marker}`));
  assert.doesNotMatch(serialized, /archived instruction that must not be recalled/);
  assert.doesNotMatch(serialized, /Mining-only context/);
  assert.doesNotMatch(serialized, /another user's private context/);
  assert.doesNotMatch(serialized, /current conversation text/);

  const wrongPersona = await loadScopedUserMemory({
    userId: 1,
    persona: "executive",
    scope: sameScope,
    currentConversationId: current.id,
    query: `Atlas ${marker}`,
  });
  assert.deepEqual(wrongPersona, []);
});

test.after(async () => {
  await pool.end();
});
