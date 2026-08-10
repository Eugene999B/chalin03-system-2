"use strict";

const MAX_EVIDENCE_ITEMS = 5;
const MAX_EXCERPT_LENGTH = 520;
const LOCAL_MODEL_KEY = "chalin-local-governed-v1";

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function evidenceFromMessages(messages = []) {
  const text = messages
    .filter((message) => ["system", "user"].includes(message?.role))
    .map((message) => String(message?.content || ""))
    .join("\n\n");
  const pattern = /\[(E\d+)\]\s+([^\n]+)\n([\s\S]*?)(?=\n\n\[E\d+\]|$)/g;
  const seen = new Set();
  const evidence = [];
  let match;

  while ((match = pattern.exec(text)) && evidence.length < MAX_EVIDENCE_ITEMS) {
    const citation = match[1];
    if (seen.has(citation)) continue;
    const heading = clean(match[2], 360);
    const excerpt = clean(match[3], MAX_EXCERPT_LENGTH);
    if (!excerpt) continue;
    seen.add(citation);
    evidence.push({ citation, heading, excerpt });
  }

  return evidence;
}

function composeEvidenceAnswer(messages = []) {
  const evidence = evidenceFromMessages(messages);
  if (evidence.length === 0) {
    return "I do not have enough approved CHALIN evidence to answer that reliably in zero-cost local mode. Please use the governed enquiry path or try a question covered by published or approved system information.";
  }

  const lines = evidence.map(
    (item) => `- ${item.excerpt}${item.excerpt.endsWith(".") ? "" : "."} [${item.citation}]`
  );
  return [
    "Based on the CHALIN evidence available to this conversation:",
    "",
    ...lines,
    "",
    "Zero-cost local mode summarizes approved evidence only. It does not invent missing facts or claim access to information that was not supplied by CHALIN.",
  ].join("\n");
}

class LocalGovernedProvider {
  constructor() {
    this.key = "local";
  }

  async generate({ messages = [] } = {}) {
    const text = composeEvidenceAnswer(messages);
    return {
      text,
      model_key: LOCAL_MODEL_KEY,
      input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
      output_tokens: Math.ceil(text.length / 4),
      cost_micros: 0,
      finish_reason: "stop",
      tool_calls: [],
      provider_store_enabled: false,
    };
  }
}

module.exports = {
  LOCAL_MODEL_KEY,
  LocalGovernedProvider,
  composeEvidenceAnswer,
  evidenceFromMessages,
};
