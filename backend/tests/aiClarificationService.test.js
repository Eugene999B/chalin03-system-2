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

test("exact reported misspelled current-date question is answered by the server without a provider", () => {
  const result = buildClarificationRequest({
    prompt: "WHAT IS TODYAS DATE",
    now: new Date("2026-08-14T13:28:00.000Z"),
    timeZone: "Africa/Accra",
  });

  assert.ok(result);
  assert.equal(result.kind, "current_date");
  assert.equal(result.answer, "Today is Friday, August 14, 2026.");
  assert.equal(result.date_key, "2026-08-14");
  assert.equal(result.time_zone, "Africa/Accra");
  assert.deepEqual(result.missing_fields, []);
  assert.equal(result.requires_provider, false);
  assert.equal(result.server_owned_clock, true);
  assert.equal(result.source_of_truth, true);
  assert.equal(result.execution_authority, false);
});

test("common current-date wording variants use the same deterministic utility", () => {
  const prompts = [
    "what is today's date?",
    "what is todays date",
    "what date is it today?",
    "what date is it?",
    "today's date please",
    "what day is it today?",
  ];

  for (const prompt of prompts) {
    const result = buildClarificationRequest({
      prompt,
      now: new Date("2026-08-14T13:28:00.000Z"),
      timeZone: "Africa/Accra",
    });
    assert.equal(result?.kind, "current_date", prompt);
    assert.equal(result?.answer, "Today is Friday, August 14, 2026.", prompt);
    assert.equal(result?.requires_provider, false, prompt);
  }
});

test("current-date utility is timezone-aware instead of trusting the server locale", () => {
  const result = buildClarificationRequest({
    prompt: "what date is it",
    now: new Date("2026-08-14T23:30:00.000Z"),
    timeZone: "Pacific/Kiritimati",
  });

  assert.equal(result?.date_key, "2026-08-15");
  assert.equal(result?.answer, "Today is Saturday, August 15, 2026.");
});

test("date utility does not hijack operational questions that happen to mention today or dates", () => {
  const prompts = [
    "what are today's sales",
    "show me today's purchases",
    "generate a PDF of today's sales",
    "what date did the customer buy this item",
    "show the date range for sales",
  ];

  for (const prompt of prompts) {
    assert.equal(buildClarificationRequest({ prompt }), null, prompt);
  }
});

test("under-specified sales document asks only for format and safely defaults the period", () => {
  const result = buildClarificationRequest({
    prompt: "can you generate a document on sales for me",
  });
  assert.ok(result);
  assert.equal(result.kind, "document_generation");
  assert.deepEqual(result.missing_fields, ["format"]);
  assert.match(result.answer, /PDF, Word, Excel, or CSV/);
  assert.match(result.answer, /bounded recent view/i);
  assert.match(result.answer, /exact dates/i);
  assert.match(result.answer, /current authorized workspace\/store/);
  assert.equal(result.period_default, "recent_bounded");
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
  assert.doesNotMatch(result.answer, /bounded recent view/i);
  assert.equal(result.period_default, null);
});

test("document requests with format but no period proceed using the governed bounded default", () => {
  assert.equal(
    buildClarificationRequest({
      prompt: "generate a PDF sales report",
    }),
    null
  );
  assert.equal(requestedFormat("generate a PDF sales report"), "pdf");
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

test("server-first clarification and deterministic utility dispatch happen before contextual preload and provider orchestration", () => {
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
