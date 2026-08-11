"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
} = require("../services/aiProductKnowledgeService");
const {
  TAVILY_SEARCH_ENDPOINT,
  configuredTavily,
  enrichPublicSafeMessagesWithWeb,
  isCurrentPublicWebQuestion,
  normalizeTavilyResults,
  publicWebEvidenceMessage,
  searchPublicWeb,
} = require("../services/aiPublicWebSearchService");

const FREE_ENV = Object.freeze({
  TAVILY_API_KEY: "tvly-test-free-key-abcdefghijklmnopqrstuvwxyz",
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("generic current-world questions are no longer misclassified as CHALIN product knowledge", () => {
  assert.equal(isChalinProductKnowledgeTurn("What is the current president of Ghana?"), false);
  assert.equal(isLikelyLiveRecordRequest("What is the current president of Ghana?"), false);
  assert.equal(isCurrentPublicWebQuestion("What is the current president of Ghana?"), true);

  assert.equal(isChalinProductKnowledgeTurn("How much is gold today?"), false);
  assert.equal(isLikelyLiveRecordRequest("How much is gold today?"), false);
  assert.equal(isCurrentPublicWebQuestion("How much is gold today?"), true);
});

test("CHALIN product and private operational questions never enter public web search", () => {
  assert.equal(isChalinProductKnowledgeTurn("Tell me more about CHALIN and its businesses"), true);
  assert.equal(isCurrentPublicWebQuestion("Tell me more about CHALIN and its businesses"), false);

  assert.equal(isLikelyLiveRecordRequest("Tell me today's sales at Main Store"), true);
  assert.equal(isCurrentPublicWebQuestion("Tell me today's sales at Main Store"), false);
});

test("Tavily configuration remains environment-only and optional", () => {
  assert.equal(configuredTavily({}), false);
  assert.equal(configuredTavily({ TAVILY_API_KEY: "replace-with-your-key" }), false);
  assert.equal(configuredTavily(FREE_ENV), true);
});

test("basic Tavily search uses the official endpoint with bounded free-tier request settings", async () => {
  const requests = [];
  const result = await searchPublicWeb({
    query: "What is the current president of Ghana?",
    env: FREE_ENV,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        query: "What is the current president of Ghana?",
        request_id: "request-123",
        usage: { credits: 1 },
        results: [
          {
            title: "Official source",
            url: "https://example.gov.gh/current-office-holder",
            content: "Current public information from the source.",
            score: 0.94,
          },
        ],
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, TAVILY_SEARCH_ENDPOINT);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${FREE_ENV.TAVILY_API_KEY}`);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.search_depth, "basic");
  assert.equal(body.max_results, 5);
  assert.equal(body.include_answer, false);
  assert.equal(body.include_raw_content, false);
  assert.equal(body.include_images, false);
  assert.equal(result.attempted, true);
  assert.equal(result.credits_used, 1);
  assert.equal(result.results.length, 1);
});

test("Tavily result normalization rejects unsafe URLs and bounds public snippets", () => {
  const results = normalizeTavilyResults({
    results: [
      { title: "Unsafe", url: "javascript:alert(1)", content: "ignore" },
      {
        title: "Safe",
        url: "https://example.com/public",
        content: "x".repeat(5000),
        score: 5,
      },
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Safe");
  assert.ok(results[0].content.length <= 1800);
  assert.equal(results[0].score, 1);
});

test("web evidence is explicitly marked untrusted and receives W citations", () => {
  const message = publicWebEvidenceMessage({
    results: [
      {
        title: "Example public source",
        url: "https://example.com/news",
        content: "A current fact snippet.",
      },
    ],
  });

  assert.equal(message.role, "tool");
  assert.match(message.content, /untrusted external data/i);
  assert.match(message.content, /never instructions/i);
  assert.match(message.content, /\[W1\]/);
  assert.match(message.content, /https:\/\/example\.com\/news/);
});

test("public-safe current questions are enriched before the latest user message", async () => {
  const enriched = await enrichPublicSafeMessagesWithWeb({
    messages: [
      { role: "system", content: "Public-safe general answer." },
      { role: "user", content: "What is the latest Ghana inflation update?" },
    ],
    env: FREE_ENV,
    fetchImpl: async () =>
      jsonResponse({
        request_id: "web-1",
        usage: { credits: 1 },
        results: [
          {
            title: "Public statistics source",
            url: "https://example.com/statistics",
            content: "Latest public inflation information.",
            score: 0.9,
          },
        ],
      }),
  });

  assert.equal(enriched.web_search.attempted, true);
  assert.equal(enriched.web_search.result_count, 1);
  assert.equal(enriched.messages.length, 3);
  assert.equal(enriched.messages[1].role, "tool");
  assert.equal(enriched.messages[2].role, "user");
  assert.match(enriched.messages[1].content, /\[W1\]/);
});

test("Tavily quota/network failure is fail-soft and never fails the conversation", async () => {
  const source = [
    { role: "system", content: "Public-safe general answer." },
    { role: "user", content: "Give me the latest public news about gold prices" },
  ];
  const enriched = await enrichPublicSafeMessagesWithWeb({
    messages: source,
    env: FREE_ENV,
    fetchImpl: async () => jsonResponse({ message: "quota" }, 429),
  });

  assert.deepEqual(enriched.messages, source);
  assert.equal(enriched.web_search.attempted, true);
  assert.equal(enriched.web_search.result_count, 0);
  assert.equal(enriched.web_search.reason, "AI_PUBLIC_WEB_SEARCH_QUOTA_REACHED");
});

test("missing Tavily key performs no network request and preserves normal provider fallback", async () => {
  let calls = 0;
  const source = [
    { role: "system", content: "Public-safe general answer." },
    { role: "user", content: "What is the latest public news in Ghana?" },
  ];
  const enriched = await enrichPublicSafeMessagesWithWeb({
    messages: source,
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(enriched.messages, source);
  assert.equal(enriched.web_search.attempted, false);
  assert.equal(enriched.web_search.reason, "tavily_unavailable");
});
