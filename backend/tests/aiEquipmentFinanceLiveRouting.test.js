"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
} = require("../services/aiProductKnowledgeService");

test("current Finance performance metrics route away from static product knowledge", () => {
  for (const prompt of [
    "Why is Installment Finance performance poor today?",
    "What is the Finance portfolio balance today?",
    "How are Installment Finance arrears looking right now?",
  ]) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});
