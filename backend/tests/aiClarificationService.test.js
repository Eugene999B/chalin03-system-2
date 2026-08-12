"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildClarificationRequest,
  isDocumentRequest,
  requestedFormat,
} = require("../services/aiClarificationService");

const routesSource = fs.readFileSync(
  path.resolve(__dirname, "../routes/aiRoutes.js"),
  "utf8"
);

test("under-specified sales document asks for format and period instead of failing", () => {
  const result = buildClarificationRequest({
    prompt: "can you generate a document on sales for me",
  });
  assert.ok(result);
  assert.equal(result.kind, "document_generation");
  assert.deepEqual(result.missing_fields, ["format", "period"]);
  assert.match(result.answer, /PDF, Word, Excel, or CSV/);
  assert.match(result.answer, /today, yesterday, this week, this month, or custom dates/);
  assert.match(result.answer, /current authorized workspace\/store/);
  assert.equal(result.requires_provider, false);
  assert.equal(result.source_of_truth, false);
  assert.equal(result.execution_authority, false);
});

test("document requests with period but no format ask only for format", () => {
  const result = buildClarificationRequest({
    prompt: "prepare a sales report for today",
  });
  assert.ok(result);
  assert.deepEqual(result.missing_fields, ["format"]);
  assert.match(result.answer, /Which format do you want/);
  assert.doesNotMatch(result.answer, /what period should I use/i);
});

test("document requests with format but no period ask only for period", () => {
  const result = buildClarificationRequest({
    prompt: "generate a PDF sales report",
  });
  assert.ok(result);
  assert.deepEqual(result.missing_fields, ["period"]);
  assert.equal(result.requested_format, "pdf");
  assert.match(result.answer, /What period should I use/);
});

test("complete document requests proceed to governed reasoning and evidence", () => {
  assert.equal(
    buildClarificationRequest({ prompt: "generate a PDF of today's sales" }),
    null
  );
  assert.equal(
    buildClarificationRequest({ prompt: "make an Excel stock report for this week" }),
    null
  );
});

test("ordinary explanations are never mistaken for document actions", () => {
  assert.equal(isDocumentRequest("what is a sales report"), false);
  assert.equal(buildClarificationRequest({ prompt: "explain sales reports" }), null);
  assert.equal(requestedFormat("PDF for today"), "pdf");
});

test("route clarification happens before contextual preload and provider orchestration", () => {
  const clarificationIndex = routesSource.indexOf(
    "const clarification = buildClarificationRequest({ prompt: message });"
  );
  const clarificationTurnIndex = routesSource.indexOf("await runClarificationTurn({");
  const contextIndex = routesSource.indexOf("createContextualAiProvider({", clarificationIndex);
  const providerIndex = routesSource.indexOf("await runAiConversationTurn({", clarificationIndex);

  assert.ok(clarificationIndex >= 0);
  assert.ok(clarificationTurnIndex > clarificationIndex);
  assert.ok(contextIndex > clarificationTurnIndex);
  assert.ok(providerIndex > clarificationTurnIndex);
  assert.match(routesSource, /return withConversationRollover\(clarified, rollover\)/);
});
